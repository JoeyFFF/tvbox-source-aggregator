// 直播源频道级合并（方案 D+）
// 流程：下载各源 m3u/txt → 解析为频道条目 → 规范化频道名 → 按频道合并 urls → 排序 → 组装 TVBoxLiveGroup[]

import type {
  TVBoxLiveGroup,
  TVBoxLiveChannel,
  ChannelSpeedMap,
} from './types';
import { TVBOX_UA, BROWSER_UA } from './config';
import { cleanPlaybackUrl, type LiveMirrorGroup } from './live-mirrors';
import { chooseFailureTag, isLongTermFailed, isPermanentProbeFailure, stripFailurePrefix } from './channel-health';
import {
  compileLiveUrlBlacklist,
  filterLiveUrlBlacklist,
  type LiveUrlBlacklistRuleSet,
} from './live-url-blacklist';
import {
  addLiveGroupPrefix,
  applyLiveGroupRenames,
  buildLiveGroupSnapshot,
  compileLiveGroupRenames,
  createLiveGroupRuleMatcher,
  filterLiveGroupDecision,
  orderLiveGroupNames,
  sortLiveGroupChannels,
  type LiveGroupDecision,
  type LiveGroupMatcher,
  type LiveGroupRuleSet,
  type LiveGroupSnapshot,
} from './live-group-rules';
import {
  DEFAULT_BUILTIN_RULES,
  compileBuiltinRules,
  provinceOfGroup,
  type CompiledBuiltinRules,
} from './live-group-defaults';

// ─── 输入条目 ──────────────────────────────────────────

export interface LiveSourceInput {
  name: string;     // 源显示名
  url: string;      // m3u/txt 文件地址
  ua?: string;
  header?: Record<string, string>;
  speedMs?: number; // 源级速度（用于粗粒度排序）
}

// ─── 解析后的频道条目 ──────────────────────────────────

interface ChannelEntry {
  group: string;
  name: string;
  logo?: string;
  url: string;
  source: string;       // 源 name，用作 $ 后缀
  sourceSpeedMs?: number;
}

// ─── 频道名规范化 ──────────────────────────────────────

const TRAD_SIMP_MAP: Record<string, string> = {
  '電': '电', '視': '视', '臺': '台', '頻': '频', '道': '道',
  '綜': '综', '藝': '艺', '體': '体', '育': '育', '劇': '剧',
  '經': '经', '華': '华', '東': '东', '西': '西', '國': '国',
  '際': '际', '亞': '亚', '歐': '欧', '財': '财', '鳳': '凤',
  '衛': '卫', '廣': '广',
};

const SUFFIX_PATTERNS = [
  /\s*\[?hd\]?$/i,
  /\s*\[?uhd\]?$/i,
  /\s*\[?fhd\]?$/i,
  /\s*高清$/,
  /\s*超清$/,
  /\s*蓝光$/,
  /\s*藍光$/,
  /\s*4k$/i,
  /\s*1080p?$/i,
  /\s*720p?$/i,
];

function normalizeChannelName(raw: string): string {
  let s = raw.trim();
  // 繁→简
  let out = '';
  for (const ch of s) out += TRAD_SIMP_MAP[ch] || ch;
  s = out;
  // 去后缀
  for (const p of SUFFIX_PATTERNS) s = s.replace(p, '');
  // 压空白
  s = s.replace(/\s+/g, '').trim();
  return s || raw.trim(); // 规范化空则退回原名
}

// ─── 直播分组归一化（内置规则由 live-group-defaults 提供） ───

const LOCAL_PROVINCE_ORDER = [
  '北京', '上海', '天津', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江',
  '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南',
  '广东', '广西', '海南', '四川', '贵州', '云南', '西藏', '陕西', '甘肃',
  '青海', '宁夏', '新疆', '内蒙古',
];

const DEFAULT_COMPILED_BUILTIN = compileBuiltinRules(DEFAULT_BUILTIN_RULES);

function radioGroupHit(group: string, builtin: CompiledBuiltinRules): boolean {
  if (!builtin.config.radio.enabled) return false;
  const s = String(group || '');
  if (builtin.radioGroupExcludeRe?.test(s)) return false;
  return !!builtin.radioGroupRe?.test(s);
}

function radioChannelHit(name: string, builtin: CompiledBuiltinRules): boolean {
  if (!builtin.config.radio.enabled) return false;
  const s = String(name || '');
  if (builtin.radioChannelExcludeRe?.test(s)) return false;
  return !!builtin.radioChannelRe?.test(s);
}

function isProvinceLevelChannel(province: string, name: string, builtin: CompiledBuiltinRules): boolean {
  const s = String(name || '').replace(/^\[失效\]\s*/, '');
  if (s.includes('卫视')) return true;
  if (builtin.localProvinceBrandRe?.test(s)) return true;
  const aliases = builtin.localAliases[province] || [province];
  return aliases.some((a) => s.startsWith(a));
}

function builtinTarget(target: string, prefix?: string): LiveGroupDecision {
  if (target === '__filter__' || target === '__drop__') return { group: null };
  return { group: target, prefix };
}

/** 内置分组规则；管理端规则未命中时使用。 */
export function resolveLiveGroupBuiltIn(
  group: string,
  name: string,
  builtin: CompiledBuiltinRules = DEFAULT_COMPILED_BUILTIN,
): LiveGroupDecision {
  const province = provinceOfGroup(group, builtin);
  if (province) {
    const suffix = String(group).slice(province.length);
    if (builtin.localAreaSuffixes.includes(suffix)) {
      return builtinTarget(builtin.config.local.target, province);
    }
    if (builtin.localMunicipalities.has(province)) {
      return builtinTarget(builtin.config.local.provinceLevelTarget);
    }
    return isProvinceLevelChannel(province, name, builtin)
      ? builtinTarget(builtin.config.local.provinceLevelTarget)
      : builtinTarget(builtin.config.local.target, province);
  }

  const dom = builtin.config.domestic;
  if (dom.enabled) {
    const s = String(name || '');
    const foreign = !!builtin.domesticForeignRe?.test(s);
    if (!foreign) {
      const groupHit = !!builtin.domesticGroupRe?.test(String(group || ''))
        || builtin.domesticGroupExact.has(String(group || ''));
      const channelHit = !!builtin.domesticChannelRe?.test(s)
        || !!builtin.domesticSatelliteRe?.test(s)
        || !!builtin.domesticLocalRe?.test(s)
        || !!builtin.domesticGenericRe?.test(s);
      if (groupHit || channelHit) return builtinTarget(dom.target);
    }
  }

  const watch = builtin.config.watch;
  if (watch.enabled && (builtin.watchGroups.has(String(group || '')) || !!builtin.watchGroupRe?.test(String(group || '')))) {
    return builtinTarget(watch.target);
  }
  const rotation = builtin.config.rotation;
  if (rotation.enabled && (builtin.rotationGroups.has(String(group || '')) || !!builtin.rotationGroupRe?.test(String(group || '')))) {
    return builtinTarget(rotation.target);
  }
  return { group };
}

/**
 * 把直播频道映射到统一分组。返回 group=null 表示该频道应被过滤（电台）。
 * matcher 来自管理端规则，优先于内置规则；只在 merged 模式使用。
 */
export function resolveLiveGroup(
  group: string,
  name: string,
  matcher?: LiveGroupMatcher,
  builtin: CompiledBuiltinRules = DEFAULT_COMPILED_BUILTIN,
  useBuiltin = true,
): LiveGroupDecision {
  if (useBuiltin && (radioGroupHit(group, builtin) || radioChannelHit(name, builtin))) return { group: null };
  const hit = matcher?.(group, name);
  if (hit) return hit;
  if (!useBuiltin) return { group };
  return resolveLiveGroupBuiltIn(group, name, builtin);
}

/** 兼容旧调用：只返回目标组名。 */
export function mapLiveGroup(group: string, name: string): string | null {
  return resolveLiveGroup(group, name).group;
}

/** 境内电视台的强归一化：CCTV-1 / CCTV1 / CCTV1 8M 统一，去掉高清/源/线路等后缀。 */
function normalizeDomesticName(raw: string): string {
  let s = String(raw || '').toLowerCase();
  // 繁→简
  let out = '';
  for (const ch of s) out += TRAD_SIMP_MAP[ch] || ch;
  s = out;
  // 去括号注释
  s = s.replace(/\[[^\]]*\]|\([^)]*\)|（[^）]*）/g, '');
  // 去空白和标点
  s = s.replace(/[\s\-_【】\[\]·•.,，:：/]+/g, '');
  // 4K/8K 要在数字正则前判断，避免 CCTV4K 被当成 CCTV4
  if (s.includes('cctv4k')) return 'cctv4k';
  if (s.includes('cctv8k')) return 'cctv8k';
  const cctv = s.match(/cctv[-_ ]?(\d+)([+＋]?)/);
  if (cctv) return `cctv${parseInt(cctv[1], 10)}${cctv[2] ? '+' : ''}`;
  // 去掉质量/源/线路后缀
  s = s.replace(/(高清|超高清|标清|hd|uhd|蓝光|超清|流畅|备用|线路\d*|源\d*|ipv4|ipv6|nptv|移动|电信|联通|\d+m)/gi, '');
  return s;
}

// ─── m3u/txt 解析 ──────────────────────────────────────

/**
 * 解析 m3u 格式
 *   #EXTM3U
 *   #EXTINF:-1 tvg-name="..." tvg-logo="..." group-title="央视",CCTV-1
 *   http://...
 */
function parseM3U(content: string, source: string, sourceSpeedMs?: number): ChannelEntry[] {
  const lines = content.split(/\r?\n/);
  const out: ChannelEntry[] = [];
  let currentName = '';
  let currentGroup = '其他';
  let currentLogo: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      // 解析属性
      const grpM = line.match(/group-title="([^"]+)"/i);
      currentGroup = grpM ? grpM[1] : '其他';
      const logoM = line.match(/tvg-logo="([^"]+)"/i);
      currentLogo = logoM ? logoM[1] : undefined;
      const commaIdx = line.lastIndexOf(',');
      currentName = commaIdx > 0 ? line.slice(commaIdx + 1).trim() : '';
    } else if (line.startsWith('#')) {
      continue; // 其他指令忽略
    } else if (currentName && /^https?:\/\//i.test(line)) {
      out.push({
        group: currentGroup,
        name: currentName,
        logo: currentLogo,
        url: line,
        source,
        sourceSpeedMs,
      });
      currentName = '';
      currentLogo = undefined;
    }
  }
  return out;
}

/**
 * 解析 DIYP/txt 格式
 *   央视,#genre#
 *   CCTV-1,http://url1#http://url2
 *   CCTV-2,http://...
 */
function parseTxt(content: string, source: string, sourceSpeedMs?: number): ChannelEntry[] {
  const lines = content.split(/\r?\n/);
  const out: ChannelEntry[] = [];
  let currentGroup = '其他';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const idx = line.indexOf(',');
    if (idx <= 0) continue;
    const left = line.slice(0, idx).trim();
    const right = line.slice(idx + 1).trim();

    if (right === '#genre#') {
      currentGroup = left || '其他';
      continue;
    }

    // 右侧可能包含多个 URL，用 # 分隔
    const urls = right.split('#').filter((u) => /^https?:\/\//i.test(u.trim()));
    for (const u of urls) {
      out.push({
        group: currentGroup,
        name: left,
        url: u.trim(),
        source,
        sourceSpeedMs,
      });
    }
  }
  return out;
}

function sanitizeTxtLabel(label: string, fallback: string): string {
  const cleaned = label.replace(/[\r\n]+/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

/**
 * 将 TVBox Native live groups 转为 DIYP/txt 格式：
 *   央视,#genre#
 *   CCTV-1,http://url1$源A#http://url2$源B
 */
export function formatLiveGroupsAsTxt(groups: TVBoxLiveGroup[]): string {
  const lines: string[] = [];

  for (const group of groups) {
    const groupName = sanitizeTxtLabel(group.group || '', '其他');
    lines.push(`${groupName},#genre#`);

    for (const channel of group.channels || []) {
      const urls = (channel.urls || []).filter((url) => url.trim());
      if (urls.length === 0) continue;

      const channelName = sanitizeTxtLabel(channel.name || '', '未命名');
      lines.push(`${channelName},${urls.join('#')}`);
    }
  }

  return lines.join('\n');
}

/** 自动识别 m3u 还是 txt */
export function parseLiveContent(content: string, source: string, sourceSpeedMs?: number): ChannelEntry[] {
  const entries = content.includes('#EXTM3U') || content.includes('#EXTINF')
    ? parseM3U(content, source, sourceSpeedMs)
    : parseTxt(content, source, sourceSpeedMs);
  // 解析后与分组/合并/探活查询前清洗；只去线路说明，不修改查询参数。
  return entries.map(e => ({ ...e, url: cleanPlaybackUrl(e.url) })).filter(e => /^https?:\/\//i.test(e.url));
}

// ─── 下载 m3u/txt ──────────────────────────────────────

async function downloadLive(group: LiveMirrorGroup<LiveSourceInput>, timeoutMs: number): Promise<{ content: string; url: string } | null> {
  const candidates = [group.primary, ...group.fallbacks];
  for (const input of candidates) {
    const uas = [input.ua || TVBOX_UA, BROWSER_UA];
    for (const ua of uas) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(input.url, {
          signal: controller.signal,
          headers: { 'User-Agent': ua, ...(input.header || {}) },
        });
        if (resp.ok) {
          const text = await resp.text();
          // HTTP 200 的错误页不算成功；继续尝试下一个候选地址。
          if (text && text.length > 20 && parseLiveContent(text, input.name).length > 0) {
            return { content: text, url: input.url };
          }
        }
      } catch {
        // 网络失败/超时后继续同一入口的另一UA或镜像。
      } finally {
        clearTimeout(timer);
      }
    }
    console.warn(`[live-merger] Candidate failed: ${input.url}`);
  }
  return null;
}

// ─── 严格过滤：移除含 "type" 字段/字样的危险值 ────────

/**
 * TVBox 通过 `lives.contains("type")` 字符串匹配判断格式
 * 输出 Native 格式时，任何出现 `"type"` 字面量都会被误判为 FongMi 格式
 * 策略：对 group/name 中出现 "type" 字样做替换；URL 单独走 scrubUrlType
 */
function scrubTypeLiteral(s: string): string {
  return s.replace(/type/gi, 'tp');
}

/**
 * URL 中的 type 子串做 RFC 3986 URL-encode（首字符 t/T → %74/%54），
 * 保留原大小写以兼容 case-sensitive 的查询参数校验
 * 主流 HTTP 服务器会自动 URL-decode 还原为原串，功能不受影响
 * 用于 urls[] 元素，避免 TVBox lives.contains("type") 误判
 */
function scrubUrlType(url: string): string {
  return url.replace(/type/gi, (m) => {
    const hex = m.charCodeAt(0).toString(16).toUpperCase();
    return '%' + hex + m.slice(1);
  });
}

// ─── 主合并流程 ────────────────────────────────────────

export interface MergeLivesResult {
  groups: TVBoxLiveGroup[];
  totalChannels: number;
  totalUrls: number;
  sourcesDownloaded: number;
  sourcesFailed: number;
  groupSnapshot?: LiveGroupSnapshot;
}

export async function mergeLivesToNative(
  sources: Array<LiveSourceInput | LiveMirrorGroup<LiveSourceInput>>,
  fetchTimeoutMs: number,
  channelSpeedMap?: ChannelSpeedMap,
  groupRules?: LiveGroupRuleSet,
  liveUrlBlacklist?: LiveUrlBlacklistRuleSet,
): Promise<MergeLivesResult> {
  if (sources.length === 0) {
    return { groups: [], totalChannels: 0, totalUrls: 0, sourcesDownloaded: 0, sourcesFailed: 0 };
  }

  console.log(`[live-merger] Downloading ${sources.length} live source files...`);

  // 逻辑列表之间并发；同一列表候选串行，首个有效响应后即停止。
  const downloadResults = await Promise.allSettled(
    sources.map((s) => {
      const group = 'primary' in s ? s : { primary: s, fallbacks: [] };
      return downloadLive(group, fetchTimeoutMs).then((result) => ({ input: group.primary, content: result?.content ?? null }));
    }),
  );

  let sourcesDownloaded = 0;
  let sourcesFailed = 0;
  let blockedByUrlRules = 0;
  const allEntries: ChannelEntry[] = [];
  const urlBlacklistMatchers = compileLiveUrlBlacklist(liveUrlBlacklist);

  for (const r of downloadResults) {
    if (r.status === 'fulfilled' && r.value.content) {
      sourcesDownloaded++;
      try {
        const parsedEntries = parseLiveContent(r.value.content, r.value.input.name, r.value.input.speedMs);
        const entries = filterLiveUrlBlacklist(parsedEntries, urlBlacklistMatchers);
        blockedByUrlRules += parsedEntries.length - entries.length;
        allEntries.push(...entries);
      } catch (err) {
        console.warn(`[live-merger] Parse failed for ${r.value.input.name}: ${err}`);
      }
    } else {
      sourcesFailed++;
    }
  }

  console.log(
    `[live-merger] Downloaded ${sourcesDownloaded}/${sources.length} sources, ` +
    `parsed ${allEntries.length} channel entries, ` +
    `blocked ${blockedByUrlRules} by live URL blacklist`,
  );

  const builtin = compileBuiltinRules(groupRules?.builtin || DEFAULT_BUILTIN_RULES);
  const useBuiltin = groupRules?.useBuiltin !== false;
  const provinceOf = (group: string) => provinceOfGroup(group, builtin);
  const ruleMatcher = groupRules && groupRules.rules.length > 0
    ? createLiveGroupRuleMatcher(groupRules, provinceOf)
    : undefined;
  const compiledRenames = compileLiveGroupRenames(groupRules?.renames);
  const targetFilter = new Set(groupRules?.filterTargets || []);
  const resolveForOutput = (group: string, name: string) =>
    filterLiveGroupDecision(resolveLiveGroup(group, name, ruleMatcher, builtin, useBuiltin), targetFilter);
  const groupSnapshot = buildLiveGroupSnapshot(allEntries, resolveForOutput);

  // 确定性失败（DNS 不存在、404/410、非法 URL）和长期失败直接删除；
  // 短期失败仍保留，由 allFailed 标记失败原因前缀。
  const isFilteredFailure = (e: ChannelEntry) => {
    const entry = channelSpeedMap?.[e.url];
    return isPermanentProbeFailure(entry) || isLongTermFailed(entry);
  };
  const outputEntries = allEntries.filter((e) => !isFilteredFailure(e));
  const filteredFailedUrls = allEntries.length - outputEntries.length;
  if (filteredFailedUrls > 0) {
    console.log(`[live-merger] Filtered ${filteredFailedUrls} permanently/long-term failed URL(s)`);
  }

  // 按目标组与规范化显示名合并 urls，保留自定义前缀的频道身份
  // key: [group, domesticPrefix, normalizedName] → { group, rawName, logo, urls: Map<url, ChannelEntry> }
  interface AggChannel {
    group: string;        // 使用第一次出现的 group 名
    rawName: string;      // 使用第一次出现的 raw name（最常用的）
    logo?: string;
    urls: Map<string, ChannelEntry>; // url → entry（含源名、速度）
  }
  const channelMap = new Map<string, AggChannel>();

  for (const e of outputEntries) {
    const decision = resolveForOutput(e.group || '其他', e.name);
    const mappedGroup = decision.group;
    if (!mappedGroup) continue; // 电台频道或管理端规则过滤
    const prefix = decision.prefix !== undefined
      ? decision.prefix
      : (mappedGroup === '地方台' ? (provinceOf(e.group || '其他') || '') : '');
    const renamedName = applyLiveGroupRenames(e.name, compiledRenames);
    const displayRawName = addLiveGroupPrefix(e.group || '其他', renamedName, decision, provinceOf);
    const normName = mappedGroup === '境内电视台'
      ? normalizeDomesticName(renamedName)
      : normalizeChannelName(displayRawName);
    if (!normName) continue;
    const channelKey = JSON.stringify([mappedGroup, mappedGroup === '境内电视台' ? prefix : '', normName]);

    let agg = channelMap.get(channelKey);
    if (!agg) {
      agg = {
        group: mappedGroup,
        rawName: displayRawName,
        logo: e.logo,
        urls: new Map(),
      };
      channelMap.set(channelKey, agg);
    }
    if (!agg.urls.has(e.url)) {
      agg.urls.set(e.url, e);
    }
    if (!agg.logo && e.logo) agg.logo = e.logo;
  }

  // 按 group 组织
  const groupMap = new Map<string, TVBoxLiveChannel[]>();
  let totalUrls = 0;
  let emittedChannels = 0;

  for (const [, agg] of channelMap) {
    // 对 urls 排序
    const urlList = Array.from(agg.urls.values());
    if (urlList.length === 0) continue;

    // 探活结果：只有所有 URL 都有明确 fail 结果时才标记失败原因前缀；
    // 未探过的 URL 不能当作失败，避免误标。
    const speedMap = channelSpeedMap || {};
    const allProbed = urlList.every((e) => speedMap[e.url] != null);
    const allFailed = allProbed && urlList.every((e) => speedMap[e.url]?.kind === 'fail');
    const baseName = stripFailurePrefix(String(agg.rawName || ''));
    const failureTag = allFailed ? chooseFailureTag(urlList.map((e) => speedMap[e.url])) : null;
    const displayName = allFailed
      ? `[${failureTag || '失效'}] ${baseName}`
      : baseName;

    urlList.sort((a, b) => {
      // 优先用 URL 级测速缓存
      const sa = channelSpeedMap?.[a.url];
      const sb = channelSpeedMap?.[b.url];
      const fa = sa && sa.kind !== 'fail' ? sa.speedMs : undefined;
      const fb = sb && sb.kind !== 'fail' ? sb.speedMs : undefined;

      if (fa != null && fb != null) return fa - fb;
      if (fa != null) return -1;
      if (fb != null) return 1;

      // 失败的 URL 排到末尾
      const failA = sa?.kind === 'fail';
      const failB = sb?.kind === 'fail';
      if (failA && !failB) return 1;
      if (!failA && failB) return -1;

      // 降级：源级 speedMs
      const ssA = a.sourceSpeedMs ?? Infinity;
      const ssB = b.sourceSpeedMs ?? Infinity;
      return ssA - ssB;
    });

    // 拼 $ 源名（URL 预防性 encode 避免 type 泄漏）
    const urlStrs = urlList.map((e) => `${scrubUrlType(e.url)}$${scrubTypeLiteral(e.source)}`);
    totalUrls += urlStrs.length;

    const channel: TVBoxLiveChannel = {
      name: scrubTypeLiteral(displayName),
      urls: urlStrs,
    };
    // TVBoxLiveChannel 定义只有 name/urls，logo 不加（避免意外引入 type 风险字段）

    const groupKey = scrubTypeLiteral(agg.group || '其他');
    let list = groupMap.get(groupKey);
    if (!list) {
      list = [];
      groupMap.set(groupKey, list);
    }
    list.push(channel);
    emittedChannels++;
  }

  // 组装 groups；地方台按省份顺序排列，方便按省浏览
  const groups: TVBoxLiveGroup[] = [];
  for (const [group, channels] of groupMap) {
    if (group === '地方台' && groupRules?.channelSort !== 'name') {
      channels.sort((a, b) => {
        const pa = stripFailurePrefix(a.name).split('·')[0];
        const pb = stripFailurePrefix(b.name).split('·')[0];
        const ia = LOCAL_PROVINCE_ORDER.indexOf(pa);
        const ib = LOCAL_PROVINCE_ORDER.indexOf(pb);
        const ra = ia < 0 ? 999 : ia;
        const rb = ib < 0 ? 999 : ib;
        if (ra !== rb) return ra - rb;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
    }
    groups.push({ group, channels });
  }

  // 排序：组顺序按 groupOrder，组内频道按 channelSort / failedLast（规则集可选，refresh 生效）
  if (groupRules && (groupRules.groupOrder?.length || groupRules.channelSort === 'name' || groupRules.failedLast)) {
    for (const g of groups) {
      if (groupRules.channelSort === 'name' || groupRules.failedLast) {
        g.channels = sortLiveGroupChannels(g.channels, groupRules);
      }
    }
    if (groupRules.groupOrder?.length) {
      const byName = new Map(groups.map((g) => [g.group, g]));
      const ordered = orderLiveGroupNames(groups.map((g) => g.group), groupRules.groupOrder)
        .map((name) => byName.get(name))
        .filter((g): g is TVBoxLiveGroup => Boolean(g));
      groups.length = 0;
      groups.push(...ordered);
    }
  }

  // 最终安全校验（双保险第二道）：
  //   1) 先移除 "type" 字段名（若意外进入）
  //   2) 再扫描 value 内 type 子串，统一 URL-encode 替换为 %74ype
  let finalJson = JSON.stringify(groups);
  let cleanedGroups: TVBoxLiveGroup[] = groups;

  if (/"type"\s*:/i.test(finalJson)) {
    console.warn('[live-merger] WARNING: "type" field leaked into output, stripping...');
    finalJson = finalJson
      .replace(/,\s*"type"\s*:\s*("[^"]*"|[\d.]+|null|true|false)/gi, '')
      .replace(/"type"\s*:\s*("[^"]*"|[\d.]+|null|true|false)\s*,?/gi, '');
    cleanedGroups = JSON.parse(finalJson);
  }

  // value 内 type 子串兜底：排除字段名（"xxx":）位置，其他全部 encode
  if (/type/i.test(finalJson)) {
    console.warn('[live-merger] WARNING: "type" substring in value, encoding to %74ype...');
    finalJson = finalJson.replace(/type/gi, (m) => {
      const hex = m.charCodeAt(0).toString(16).toUpperCase();
      return '%' + hex + m.slice(1);
    });
    cleanedGroups = JSON.parse(finalJson);
    return {
      groups: cleanedGroups,
      totalChannels: emittedChannels,
      totalUrls,
      sourcesDownloaded,
      sourcesFailed,
      groupSnapshot,
    };
  }

  if (cleanedGroups !== groups) {
    return {
      groups: cleanedGroups,
      totalChannels: emittedChannels,
      totalUrls,
      sourcesDownloaded,
      sourcesFailed,
      groupSnapshot,
    };
  }

  console.log(
    `[live-merger] Merged ${channelMap.size} channels / ${totalUrls} URLs across ${groups.length} groups`,
  );

  return {
    groups,
    totalChannels: emittedChannels,
    totalUrls,
    sourcesDownloaded,
    sourcesFailed,
    groupSnapshot,
  };
}

/**
 * 按源分类模式：每个源独立解析，用「源名」前缀拼接 group 名，不做跨源去重
 */
export async function separatedMergeLives(
  sources: Array<LiveSourceInput | LiveMirrorGroup<LiveSourceInput>>,
  fetchTimeoutMs: number,
  liveUrlBlacklist?: LiveUrlBlacklistRuleSet,
  channelSpeedMap?: ChannelSpeedMap,
): Promise<MergeLivesResult> {
  if (sources.length === 0) {
    return { groups: [], totalChannels: 0, totalUrls: 0, sourcesDownloaded: 0, sourcesFailed: 0 };
  }

  console.log(`[live-merger] Separated mode: downloading ${sources.length} live source files...`);

  // 与合并模式一致：分离模式的同组候选也串行回退、只汇入一次。
  const downloadResults = await Promise.allSettled(
    sources.map((s) => {
      const group = 'primary' in s ? s : { primary: s, fallbacks: [] };
      return downloadLive(group, fetchTimeoutMs).then((result) => ({ input: group.primary, content: result?.content ?? null }));
    }),
  );

  let sourcesDownloaded = 0;
  let sourcesFailed = 0;
  let blockedByUrlRules = 0;
  let filteredFailedUrls = 0;
  const allGroups: TVBoxLiveGroup[] = [];
  let totalChannels = 0;
  let totalUrls = 0;
  const urlBlacklistMatchers = compileLiveUrlBlacklist(liveUrlBlacklist);

  for (const r of downloadResults) {
    if (r.status !== 'fulfilled' || !r.value.content) {
      sourcesFailed++;
      continue;
    }
    sourcesDownloaded++;
    const { input, content } = r.value;
    const sourceName = input.name || 'source';

    try {
      const parsedEntries = parseLiveContent(content, sourceName, input.speedMs);
      const allowed = filterLiveUrlBlacklist(parsedEntries, urlBlacklistMatchers);
      blockedByUrlRules += parsedEntries.length - allowed.length;
      const entries = allowed.filter((e) => {
        const entry = channelSpeedMap?.[e.url];
        return !isPermanentProbeFailure(entry) && !isLongTermFailed(entry);
      });
      filteredFailedUrls += allowed.length - entries.length;
      if (entries.length === 0) continue;

      // 按 group 分组（源内去重）
      const groupMap = new Map<string, Map<string, string[]>>();
      for (const e of entries) {
        const grp = e.group || '其他';
        if (!groupMap.has(grp)) groupMap.set(grp, new Map());
        const channels = groupMap.get(grp)!;
        if (!channels.has(e.name)) channels.set(e.name, []);
        const urls = channels.get(e.name)!;
        if (!urls.includes(e.url)) urls.push(e.url);
      }

      // 用「源名」前缀拼接 group 名
      for (const [grp, channels] of groupMap) {
        const prefixedGroup = `「${sourceName}」${grp}`;
        const chs: TVBoxLiveChannel[] = [];
        for (const [name, urls] of channels) {
          chs.push({ name, urls });
          totalUrls += urls.length;
        }
        totalChannels += chs.length;
        allGroups.push({ group: prefixedGroup, channels: chs });
      }
    } catch (err) {
      console.warn(`[live-merger] Separated parse failed for ${sourceName}: ${err}`);
    }
  }

  console.log(
    `[live-merger] Separated done: ${sourcesDownloaded}/${sources.length} sources, ` +
    `${allGroups.length} groups, ${totalChannels} channels, blocked ${blockedByUrlRules} by live URL blacklist, ` +
    `filtered ${filteredFailedUrls} permanently/long-term failed URL(s)`,
  );

  return { groups: allGroups, totalChannels, totalUrls, sourcesDownloaded, sourcesFailed };
}

/**
 * 从合并后的 groups 提取所有 (url, sourceSpeedMs) 对供 channel-probe 测速
 * URL 是 `$源名` 剥离后的裸 URL
 */
export function extractAllUrls(groups: TVBoxLiveGroup[]): string[] {
  const set = new Set<string>();
  for (const g of groups) {
    for (const ch of g.channels) {
      for (const u of ch.urls) {
        const bare = cleanPlaybackUrl(u);
        if (bare) set.add(bare);
      }
    }
  }
  return Array.from(set);
}

/**
 * 轻量级实时解析：给定一组 m3u/txt URL，下载并解析为 TVBoxLiveGroup[]
 * 用于 /live-config 端点在 FongMi 格式下实时转换
 */
export async function fetchAndParseLiveUrls(
  urls: Array<{ name: string; url: string; header?: Record<string, string> }>,
  timeoutMs = 8000,
  liveUrlBlacklist?: LiveUrlBlacklistRuleSet,
): Promise<TVBoxLiveGroup[]> {
  if (urls.length === 0) return [];
  const urlBlacklistMatchers = compileLiveUrlBlacklist(liveUrlBlacklist);

  const results = await Promise.allSettled(
    urls.map(async (input) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(input.url, {
          signal: controller.signal,
          headers: { 'User-Agent': TVBOX_UA, ...(input.header || {}) },
        });
        clearTimeout(timer);
        if (!resp.ok) return null;
        const text = await resp.text();
        if (!text || text.length < 20) return null;
        return { content: text, name: input.name };
      } catch {
        clearTimeout(timer);
        return null;
      }
    }),
  );

  const allEntries: Array<{ group: string; name: string; url: string }> = [];
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const entries = filterLiveUrlBlacklist(parseLiveContent(r.value.content, r.value.name), urlBlacklistMatchers);
    allEntries.push(...entries);
  }

  // 按 group + name 合并 urls
  const groupMap = new Map<string, Map<string, string[]>>();
  for (const e of allEntries) {
    const grp = e.group || '其他';
    if (!groupMap.has(grp)) groupMap.set(grp, new Map());
    const channels = groupMap.get(grp)!;
    if (!channels.has(e.name)) channels.set(e.name, []);
    const urls = channels.get(e.name)!;
    if (!urls.includes(e.url)) urls.push(e.url);
  }

  const groups: TVBoxLiveGroup[] = [];
  for (const [group, channels] of groupMap) {
    const chs: TVBoxLiveChannel[] = [];
    for (const [name, urls] of channels) {
      chs.push({ name, urls });
    }
    groups.push({ group, channels: chs });
  }
  return groups;
}
