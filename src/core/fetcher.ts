// 批量 fetch TVBox JSON 配置

import { DEFAULT_FETCH_TIMEOUT_MS, TVBOX_UA, BROWSER_UA } from './config';
import { decodeConfigResponse } from './decoder';
import { isGitHubReleaseSource, prepareGitHubReleaseSource } from './zip-source';
import { jsonrepair } from 'jsonrepair';
import type { TVBoxConfig, SourcedConfig, SourceEntry, SourceFetchResult } from './types';

const MAX_MULTI_REPO_DEPTH = 3; // 多仓最大展开深度

export interface FetchConfigsResult {
  configs: SourcedConfig[];
  fetchResults: SourceFetchResult[];
}

/**
 * 批量获取配置 JSON，并发执行，带超时
 * 自动检测多仓格式（storeHouse / urls），递归展开（最多 3 层）
 * 返回成功获取的配置列表 + 每个源的 fetch 结果（含失败原因）
 */
export interface FetchProxyConfig {
  urls: string[];   // 代理端点列表，如 ["https://tvbox.rio.edu.kg/fetch-proxy", "https://fetch.riowang.win/api/proxy"]
  token?: string;   // 认证 token（CF fetch-proxy 需要）
}

export async function fetchConfigs(
  sources: SourceEntry[],
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  proxyConfig?: FetchProxyConfig,
): Promise<FetchConfigsResult> {
  const configs: SourcedConfig[] = [];
  const fetchResults: SourceFetchResult[] = [];
  const seen = new Set<string>(); // URL 去重，防循环引用

  await expandSources(sources, configs, fetchResults, seen, timeoutMs, 0, proxyConfig);

  console.log(`[fetcher] Fetched ${configs.length} configs from ${sources.length} top-level sources`);
  return { configs, fetchResults };
}

/**
 * 递归展开多仓源
 */
async function expandSources(
  sources: SourceEntry[],
  configs: SourcedConfig[],
  fetchResults: SourceFetchResult[],
  seen: Set<string>,
  timeoutMs: number,
  depth: number,
  proxyConfig?: FetchProxyConfig,
): Promise<void> {
  // 去重
  const uniqueSources = sources.filter(s => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });

  if (uniqueSources.length === 0) return;

  const tag = depth === 0 ? '' : ` (depth ${depth})`;
  console.log(`[fetcher] Fetching ${uniqueSources.length} sources${tag}...`);

  const results = await Promise.allSettled(
    uniqueSources.map((source) => fetchSingleConfig(source, timeoutMs, proxyConfig)),
  );

  const multiRepoChildren: SourceEntry[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const source = uniqueSources[i];
    if (result.status === 'fulfilled' && result.value) {
      const { config: fetchedConfig, fetchResult } = result.value;
      fetchResults.push(fetchResult);

      if (fetchResult.status !== 'ok') {
        // 失败的，已记录到 fetchResults，跳过
        continue;
      }

      if (isMultiRepoConfig(fetchedConfig!)) {
        const children = extractMultiRepoEntries(fetchedConfig!, fetchResult.name);
        console.log(`[fetcher] Multi-repo: ${source.url} → ${children.length} sub-sources`);
        if (depth < MAX_MULTI_REPO_DEPTH) {
          multiRepoChildren.push(...children);
        } else {
          console.log(`[fetcher] Max depth reached, skipping expansion of ${source.url}`);
        }
      } else {
        configs.push({
          sourceUrl: source.url,
          sourceName: source.name,
          config: fetchedConfig!,
          speedMs: fetchResult.speedMs,
        });
      }
    } else if (result.status === 'rejected') {
      console.warn(`[fetcher] Failed: ${source.url}: ${result.reason}`);
      fetchResults.push({
        url: source.url,
        name: source.name,
        status: 'network_error',
        errorMessage: String(result.reason),
      });
    }
  }

  // 递归展开子多仓
  if (multiRepoChildren.length > 0) {
    await expandSources(multiRepoChildren, configs, fetchResults, seen, timeoutMs, depth + 1, proxyConfig);
  }
}

interface SingleFetchResult {
  config: TVBoxConfig | null;
  fetchResult: SourceFetchResult;
}

/**
 * 获取单个配置 JSON，返回结构化结果（成功或失败原因）
 */
async function fetchSingleConfig(
  source: SourceEntry,
  timeoutMs: number,
  proxyConfig?: FetchProxyConfig,
): Promise<SingleFetchResult> {
  // GitHub Release ZIP 源：/refresh 时解析 latest release、下载并展开 ZIP。
  // 相对路径已经改成 {{BASE_URL}}/zip/<key>/...，由 Node 路由提供 JAR/资源。
  if (isGitHubReleaseSource(source.url)) {
    const startedAt = Date.now();
    try {
      const prepared = await prepareGitHubReleaseSource(source.url);
      const config = parseConfigJson(prepared.text);
      if (!config) {
        return {
          config: null,
          fetchResult: { url: source.url, name: source.name, status: 'parse_error', errorMessage: 'Invalid JSON in release ZIP' },
        };
      }
      return {
        config,
        fetchResult: { url: source.url, name: source.name, status: 'ok', speedMs: Date.now() - startedAt },
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const status = msg.includes('abort')
        ? 'timeout'
        : /No TVBox config|Invalid JSON in release ZIP/.test(msg)
          ? 'parse_error'
          : 'network_error';
      return {
        config: null,
        fetchResult: { url: source.url, name: source.name, status, errorMessage: msg },
      };
    }
  }

  // 双 UA 回退：先用 okhttp（TVBox 原生），解析失败换浏览器 UA 重试
  const result = await fetchWithUA(source, timeoutMs, TVBOX_UA);
  if (result.config) return result;

  // okhttp 失败 → 浏览器 UA 重试（部分源只接受浏览器 UA）
  if (result.fetchResult.status === 'parse_error' || result.fetchResult.status === 'decode_error') {
    console.log(`[fetcher] Retrying ${source.url} with browser UA`);
    const browserResult = await fetchWithUA(source, timeoutMs, BROWSER_UA);
    if (browserResult.config) return browserResult;
  }

  // 直连失败（timeout/network_error/http_error）→ 通过边缘代理重试
  if (proxyConfig?.urls.length && isProxyRetriable(result.fetchResult.status)) {
    for (const proxyUrl of proxyConfig.urls) {
      console.log(`[fetcher] Retrying ${source.url} via proxy ${proxyUrl.substring(0, 40)}...`);
      const proxyResult = await fetchViaProxy(source, timeoutMs, proxyUrl, proxyConfig.token);
      if (proxyResult.config) return proxyResult;
    }
  }

  return result;
}

function isProxyRetriable(status: string): boolean {
  return status === 'timeout' || status === 'network_error' || status === 'http_error';
}

async function fetchViaProxy(
  source: SourceEntry,
  timeoutMs: number,
  proxyUrl: string,
  token?: string,
): Promise<SingleFetchResult> {
  const url = `${proxyUrl}?url=${encodeURIComponent(source.url)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const startTime = Date.now();
    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'X-Proxy-UA': TVBOX_UA,
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(url, { signal: controller.signal, headers });

    if (!response.ok) {
      return {
        config: null,
        fetchResult: { url: source.url, name: source.name, status: 'http_error', errorMessage: `Proxy: HTTP ${response.status}` },
      };
    }

    const buffer = await response.arrayBuffer();
    const decoded = await decodeConfigResponse(buffer, source.configKey);
    if (!decoded) {
      return {
        config: null,
        fetchResult: { url: source.url, name: source.name, status: 'decode_error', errorMessage: 'Proxy: Undecodable' },
      };
    }

    const config = parseConfigJson(decoded);
    if (!config) {
      return {
        config: null,
        fetchResult: { url: source.url, name: source.name, status: 'parse_error', errorMessage: 'Proxy: Invalid JSON' },
      };
    }

    const speedMs = Date.now() - startTime;
    console.log(`[fetcher] Proxy success for ${source.url} (${speedMs}ms)`);
    return {
      config,
      fetchResult: { url: source.url, name: source.name, status: 'ok', speedMs },
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      config: null,
      fetchResult: { url: source.url, name: source.name, status: 'network_error', errorMessage: `Proxy: ${msg}` },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithUA(
  source: SourceEntry,
  timeoutMs: number,
  userAgent: string,
): Promise<SingleFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const startTime = Date.now();
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': userAgent,
      },
    });

    if (!response.ok) {
      console.warn(`[fetcher] ${source.url} returned ${response.status}`);
      return {
        config: null,
        fetchResult: { url: source.url, name: source.name, status: 'http_error', errorMessage: `HTTP ${response.status}` },
      };
    }

    const buffer = await response.arrayBuffer();
    const decoded = await decodeConfigResponse(buffer, source.configKey);
    if (!decoded) {
      console.warn(`[fetcher] ${source.url} returned undecodable content`);
      return {
        config: null,
        fetchResult: { url: source.url, name: source.name, status: 'decode_error', errorMessage: 'Undecodable content' },
      };
    }

    const config = parseConfigJson(decoded);
    if (!config) {
      console.warn(`[fetcher] ${source.url} returned invalid JSON after decoding`);
      return {
        config: null,
        fetchResult: { url: source.url, name: source.name, status: 'parse_error', errorMessage: 'Invalid JSON' },
      };
    }

    const speedMs = Date.now() - startTime;
    return {
      config,
      fetchResult: { url: source.url, name: source.name, status: 'ok', speedMs },
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('abort')) {
      console.warn(`[fetcher] ${source.url} timed out (${timeoutMs}ms)`);
      return {
        config: null,
        fetchResult: { url: source.url, name: source.name, status: 'timeout', errorMessage: `Timeout (${timeoutMs}ms)` },
      };
    }
    return {
      config: null,
      fetchResult: { url: source.url, name: source.name, status: 'network_error', errorMessage: msg },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 解析配置 JSON，容错处理
 * 有些配置可能有 BOM 头、注释或其他非标准格式
 */
export function parseConfigJson(text: string): TVBoxConfig | null {
  // 去掉 BOM
  let cleaned = text.replace(/^\uFEFF/, '');

  // 去掉首尾空白
  cleaned = cleaned.trim();

  // 有些配置可能被包在 callback 函数里
  const jsonpMatch = cleaned.match(/^\w+\(([\s\S]+)\)$/);
  if (jsonpMatch) {
    cleaned = jsonpMatch[1];
  }

  // 尝试直接解析
  let parsed = tryParseJson(cleaned);

  // 如果失败，尝试去掉行尾注释后再解析（只去掉不在字符串内的 // 注释）
  let stripped = cleaned;
  if (!parsed) {
    stripped = stripJsonComments(cleaned);
    parsed = tryParseJson(stripped);
  }

  // 仍然失败：按 4567 的 convertResult 做最后一级清洗。
  // 4567 在 Jackson 解析前会去掉 # 注释行、把裸 CR/LF 替换成空格；
  // 这能修复字符串内部含裸换行的配置（严格 JSON 不允许）。
  // 只在前面都失败时执行，避免改动合法配置的字符串内容。
  if (!parsed) {
    parsed = tryParseJson(repairJsonText(stripped));
  }

  // 客户端（TVBox/AList-TvBox 的 Gson）比严格 JSON 宽松：
  // 允许注释、未加引号的键、尾逗号、裸控制字符，并且会截取首 { 到末 }。
  // 用 jsonrepair 对齐这个能力，只在前面全部失败时执行。
  if (!parsed) {
    const candidates = [trimJsonObject(stripped), stripped];
    for (const candidate of candidates) {
      try {
        parsed = tryParseJson(jsonrepair(candidate));
        if (parsed) break;
      } catch {
        // 继续尝试下一个候选
      }
    }
  }

  if (!parsed) return null;

  // 宽松校验：只要是对象就接受（有些配置只有 spider + sites，有些只有 lives）
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  return parsed as TVBoxConfig;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 最后一级 JSON 修复，对齐 4567 的 SubscriptionService.convertResult：
 * - 去掉 # 开头的注释行；
 * - 把裸 CR/LF 替换成空格（JSON 结构里本来就是空白；字符串里的裸换行
 *   在严格 JSON 中非法，4567 也是用空格替换后交给 Jackson）；
 * - 去掉 JSON 前面的非 JSON 文本。
 * 只在严格解析和去 // 注释后都失败时使用，避免改动合法配置的字符串内容。
 */
function repairJsonText(text: string): string {
  let repaired = text.replace(/^\s*#.*$/gm, '');
  repaired = repaired.replace(/\r\n?|\n/g, ' ');

  const firstBrace = repaired.indexOf('{');
  const firstBracket = repaired.indexOf('[');
  const candidates = [firstBrace, firstBracket].filter((index) => index >= 0);
  if (candidates.length > 0) {
    const start = Math.min(...candidates);
    if (start > 0) repaired = repaired.slice(start);
  }

  return repaired;
}

/**
 * 截取首 { / [ 到末 } / ]，对齐 4567 客户端的 ApiConfig.trimJsonObject。
 * 有些源在 JSON 后面又拼了 HTML/广告，严格 JSON.parse 会因 trailing data 失败。
 */
function trimJsonObject(text: string): string {
  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  const starts = [firstObj, firstArr].filter((index) => index >= 0);
  if (starts.length === 0) return text;

  const start = Math.min(...starts);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  return end > start ? text.slice(start, end + 1) : text.slice(start);
}

/**
 * 检测是否为多仓格式（索引 JSON 而非单仓 TVBoxConfig）
 * 支持两种格式：
 * - storeHouse: {"storeHouse": [{"sourceName": "...", "sourceUrl": "..."}]}
 * - urls: {"urls": [{"name": "...", "url": "..."}]}（需排除有 sites 的单仓）
 */
export function isMultiRepoConfig(config: TVBoxConfig): boolean {
  const raw = config as Record<string, unknown>;
  if (Array.isArray(raw.storeHouse)) return true;
  if (Array.isArray(raw.urls) && !config.sites) return true;
  return false;
}

/**
 * 从多仓 JSON 中提取子源 URL 列表
 */
export function extractMultiRepoEntries(config: TVBoxConfig, parentName: string): SourceEntry[] {
  const raw = config as Record<string, unknown>;
  const entries: SourceEntry[] = [];

  if (Array.isArray(raw.storeHouse)) {
    for (const item of raw.storeHouse as Record<string, unknown>[]) {
      const url = item?.sourceUrl;
      if (typeof url === 'string' && url.trim()) {
        entries.push({
          name: typeof item.sourceName === 'string' ? item.sourceName : parentName,
          url: url.trim(),
        });
      }
    }
  } else if (Array.isArray(raw.urls)) {
    for (const item of raw.urls as Record<string, unknown>[]) {
      const url = item?.url;
      if (typeof url === 'string' && url.trim()) {
        entries.push({
          name: typeof item.name === 'string' ? item.name : parentName,
          url: url.trim(),
        });
      }
    }
  }

  return entries;
}

/**
 * 安全地去掉 JSON 中的单行注释
 * 只处理不在字符串引号内的 // 注释
 */
function stripJsonComments(text: string): string {
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      result += ch;
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      result += ch;
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (!inString && ch === '/' && text[i + 1] === '/') {
      // 跳到行尾
      const newline = text.indexOf('\n', i);
      if (newline === -1) break;
      i = newline - 1; // for 循环会 +1
      continue;
    }

    result += ch;
  }

  return result;
}
