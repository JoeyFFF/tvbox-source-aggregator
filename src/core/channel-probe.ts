// 频道级 URL 测速（方案 D+，仅 Node/Docker 跑）
// 独立模块：不阻塞主聚合，失败不影响聚合产出

import type { Storage } from '../storage/interface';
import type { TVBoxLiveGroup, ChannelSpeedMap, ChannelProbeStatus, ChannelFailReason } from './types';
import {
  KV_CHANNEL_SPEED_MAP,
  KV_CHANNEL_PROBE_STATUS,
  KV_CHANNEL_PROBE_ENABLED,
  KV_CHANNEL_MERGED_TREE,
  CHANNEL_PROBE_CONCURRENCY,
  CHANNEL_PROBE_TIMEOUT_MS,
  CHANNEL_SPEED_TTL_MS,
  TVBOX_UA,
} from './config';
import { extractAllUrls } from './live-merger';
import { cleanPlaybackUrl } from './live-mirrors';
import { applyProbeResult, isLongTermFailed, isPermanentProbeFailure, shouldProbeEntry } from './channel-health';

// ─── 开关/状态 ─────────────────────────────────────────

export async function isProbeEnabled(storage: Storage): Promise<boolean> {
  const v = await storage.get(KV_CHANNEL_PROBE_ENABLED);
  return v === 'true';
}

export async function setProbeEnabled(storage: Storage, enabled: boolean): Promise<void> {
  await storage.put(KV_CHANNEL_PROBE_ENABLED, enabled ? 'true' : 'false');
}

export async function loadStatus(storage: Storage): Promise<ChannelProbeStatus> {
  const raw = await storage.get(KV_CHANNEL_PROBE_STATUS);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fallthrough */
    }
  }
  return {
    state: 'idle',
    totalUrls: 0,
    probed: 0,
    success: 0,
    failed: 0,
    totalChannels: 0,
    coverage: 0,
  };
}

async function saveStatus(storage: Storage, status: ChannelProbeStatus): Promise<void> {
  await storage.put(KV_CHANNEL_PROBE_STATUS, JSON.stringify(status));
}

// ─── 测速缓存 ──────────────────────────────────────────

export async function loadSpeedMap(storage: Storage): Promise<ChannelSpeedMap> {
  const raw = await storage.get(KV_CHANNEL_SPEED_MAP);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveSpeedMap(storage: Storage, map: ChannelSpeedMap): Promise<void> {
  await storage.put(KV_CHANNEL_SPEED_MAP, JSON.stringify(map));
}

/** 清理 7 天前的测速缓存；当前频道树中仍在使用的失败历史保留，避免丢失长期判定。 */
export function pruneExpired(map: ChannelSpeedMap, activeUrls?: Set<string>): ChannelSpeedMap {
  const now = Date.now();
  const out: ChannelSpeedMap = {};
  for (const [url, entry] of Object.entries(map)) {
    const ts = Date.parse(entry.probedAt);
    const active = !activeUrls || activeUrls.has(url);
    if ((isFinite(ts) && now - ts < CHANNEL_SPEED_TTL_MS) || (active && entry.kind === 'fail')) {
      out[url] = entry;
    }
  }
  return out;
}

// ─── 单 URL 测试 ───────────────────────────────────────

interface ProbeResult {
  url: string;
  speedMs: number;
  kind: 'm3u8' | 'ts' | 'tcp' | 'fail';
  reason?: ChannelFailReason;
}

function httpFailureReason(status: number): ChannelFailReason {
  if (status === 401) return 'http-401';
  if (status === 403) return 'http-403';
  if (status === 404) return 'http-404';
  if (status === 408) return 'http-408';
  if (status === 410) return 'http-410';
  if (status === 429) return 'http-429';
  if (status >= 500) return 'http-5xx';
  if (status >= 400) return 'http-4xx';
  return 'unknown';
}

function fetchFailureReason(err: unknown, timedOut: boolean): ChannelFailReason {
  if (timedOut) return 'timeout';
  const e = err as { name?: string; code?: string; cause?: { code?: string }; message?: string } | undefined;
  const code = String(e?.cause?.code || e?.code || '');
  const message = String(e?.message || '');
  if (code === 'ENOTFOUND' || /getaddrinfo ENOTFOUND/i.test(message)) return 'dns-not-found';
  if (code === 'EAI_AGAIN' || /getaddrinfo EAI_AGAIN/i.test(message)) return 'dns-temporary';
  if (code === 'ERR_INVALID_URL' || /Invalid URL/i.test(message)) return 'invalid-url';
  if (code === 'ECONNREFUSED') return 'connection-refused';
  if (
    code === 'ECONNRESET'
    || code === 'EPIPE'
    || code === 'UND_ERR_SOCKET'
    || /other side closed|socket hang up|connection reset/i.test(message)
  ) return 'connection-reset';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || /timed out|timeout/i.test(message)) return 'timeout';
  if (e?.name === 'AbortError') return 'timeout';
  return 'network';
}

async function probeSingle(url: string): Promise<ProbeResult> {
  const isM3U8 = /\.m3u8(\?|$)/i.test(url);
  const isTs = /\.(ts|flv|mp4)(\?|$)/i.test(url);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CHANNEL_PROBE_TIMEOUT_MS);
  const start = Date.now();

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': TVBOX_UA },
    });
    const ttfb = Date.now() - start;

    if (!resp.ok) {
      clearTimeout(timer);
      return { url, speedMs: 0, kind: 'fail', reason: httpFailureReason(resp.status) };
    }

    const reader = resp.body?.getReader();
    if (!reader) {
      clearTimeout(timer);
      return { url, speedMs: ttfb, kind: 'tcp' };
    }

    try {
      const { value } = await reader.read();
      clearTimeout(timer);
      if (!value) {
        return { url, speedMs: ttfb, kind: 'tcp' };
      }

      if (isM3U8) {
        const head = new TextDecoder().decode(value.slice(0, Math.min(1024, value.length)));
        if (head.includes('#EXTM3U')) {
          return { url, speedMs: ttfb, kind: 'm3u8' };
        }
        return { url, speedMs: 0, kind: 'fail', reason: 'invalid-media' };
      }

      if (isTs) {
        // 检查 sync byte 0x47（4KB 内任何位置）
        const end = Math.min(4096, value.length);
        for (let i = 0; i < end; i += 188) {
          if (value[i] === 0x47) {
            return { url, speedMs: ttfb, kind: 'ts' };
          }
        }
        // 没找到 sync byte 也不一定失败（可能是 HTTP-FLV 等），用 tcp 标记
        return { url, speedMs: ttfb, kind: 'tcp' };
      }

      return { url, speedMs: ttfb, kind: 'tcp' };
    } finally {
      reader.cancel().catch(() => {});
    }
  } catch (err) {
    clearTimeout(timer);
    return { url, speedMs: 0, kind: 'fail', reason: fetchFailureReason(err, timedOut) };
  }
}

// ─── 并发池 ────────────────────────────────────────────

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  let done = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i], i);
      } catch {
        // 兜底：fn 理论上已内部 try/catch；此路径保险返回显式 fail 对象
        results[i] = { url: String(items[i]), speedMs: 0, kind: 'fail' } as R;
      }
      done++;
      if (onProgress && done % 50 === 0) onProgress(done, items.length);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  if (onProgress) onProgress(done, items.length);
  return results;
}

// ─── 主入口 ────────────────────────────────────────────

let running = false;

export async function runChannelProbe(storage: Storage): Promise<ChannelProbeStatus> {
  if (running) {
    console.log('[channel-probe] Already running, skipping');
    return loadStatus(storage);
  }

  if (!(await isProbeEnabled(storage))) {
    console.log('[channel-probe] Disabled by user, skipping');
    return loadStatus(storage);
  }

  // 读取上次合并的频道树
  const treeRaw = await storage.get(KV_CHANNEL_MERGED_TREE);
  if (!treeRaw) {
    console.log('[channel-probe] No merged tree available, skipping (run main aggregation first)');
    const status: ChannelProbeStatus = {
      state: 'error',
      totalUrls: 0,
      probed: 0,
      success: 0,
      failed: 0,
      totalChannels: 0,
      coverage: 0,
      error: 'No merged channel tree (run main aggregation first)',
    };
    await saveStatus(storage, status);
    return status;
  }

  let groups: TVBoxLiveGroup[];
  try {
    groups = JSON.parse(treeRaw);
  } catch (err) {
    const status: ChannelProbeStatus = {
      state: 'error',
      totalUrls: 0,
      probed: 0,
      success: 0,
      failed: 0,
      totalChannels: 0,
      coverage: 0,
      error: `Parse merged tree failed: ${err}`,
    };
    await saveStatus(storage, status);
    return status;
  }

  const urls = extractAllUrls(groups).map(cleanPlaybackUrl);
  const totalChannels = groups.reduce((n, g) => n + g.channels.length, 0);

  if (urls.length === 0) {
    const status: ChannelProbeStatus = {
      state: 'done',
      totalUrls: 0,
      probed: 0,
      success: 0,
      failed: 0,
      totalChannels,
      coverage: 0,
      finishedAt: new Date().toISOString(),
      durationMs: 0,
    };
    await saveStatus(storage, status);
    return status;
  }

  running = true;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  let success = 0;
  let failed = 0;

  const status: ChannelProbeStatus = {
    state: 'running',
    startedAt,
    totalUrls: urls.length,
    probed: 0,
    success: 0,
    failed: 0,
    totalChannels,
    coverage: 0,
  };
  await saveStatus(storage, status);

  console.log(`[channel-probe] Started: ${urls.length} URLs, ${totalChannels} channels, concurrency=${CHANNEL_PROBE_CONCURRENCY}`);

  try {
    // 成功缓存沿用 7 天；失败条目按 24 小时重试，长期失败每 7 天复核。
    const probeNow = Date.now();
    const oldMap = pruneExpired(await loadSpeedMap(storage), new Set(urls));
    const fresh: ChannelSpeedMap = { ...oldMap };
    const toProbe = urls.filter((u) => shouldProbeEntry(fresh[u], probeNow));
    const toProbeSet = new Set(toProbe);
    let cachedSuccess = 0;
    let cachedFail = 0;
    for (const u of urls) {
      if (toProbeSet.has(u)) continue;
      if (fresh[u]?.kind === 'fail') cachedFail++;
      else cachedSuccess++;
    }
    console.log(
      `[channel-probe] ${toProbe.length} URLs to probe ` +
      `(${cachedSuccess} cached success, ${cachedFail} cached fail)`,
    );

    const results = await runWithConcurrency(
      toProbe,
      CHANNEL_PROBE_CONCURRENCY,
      (url) => probeSingle(url),
      (done, total) => {
        status.probed = done + (urls.length - toProbe.length); // 含缓存命中
        saveStatus(storage, status).catch(() => {});
        if (done % 200 === 0) {
          console.log(`[channel-probe] Progress: ${done}/${total}`);
        }
      },
    );

    const now = new Date().toISOString();
    for (const r of results) {
      fresh[r.url] = applyProbeResult(fresh[r.url], r, now);
      if (r.kind === 'fail') failed++;
      else success++;
    }

    // 缓存命中也要计入真实成功/失败，不能把旧失败伪装成 success。
    success += cachedSuccess;
    failed += cachedFail;

    const permanentFailedUrls = urls.filter((u) => isPermanentProbeFailure(fresh[u])).length;
    const longTermFailedUrls = urls.filter(
      (u) => !isPermanentProbeFailure(fresh[u]) && isLongTermFailed(fresh[u]),
    ).length;
    const shortTermFailedUrls = urls.filter(
      (u) => fresh[u]?.kind === 'fail'
        && !isPermanentProbeFailure(fresh[u])
        && !isLongTermFailed(fresh[u]),
    ).length;

    await saveSpeedMap(storage, fresh);

    const durationMs = Date.now() - startMs;
    const coverage = urls.length > 0 ? Math.round((success / urls.length) * 100) : 0;

    const finalStatus: ChannelProbeStatus = {
      state: 'done',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs,
      totalUrls: urls.length,
      probed: urls.length,
      success,
      failed,
      totalChannels,
      coverage,
      permanentFailedUrls,
      longTermFailedUrls,
      shortTermFailedUrls,
    };
    await saveStatus(storage, finalStatus);

    console.log(
      `[channel-probe] Done in ${(durationMs / 1000).toFixed(1)}s: ` +
      `${success} success, ${failed} failed, ${permanentFailedUrls} permanent, ` +
      `${longTermFailedUrls} long-term, ${shortTermFailedUrls} short-term, coverage=${coverage}%`,
    );

    return finalStatus;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const errStatus: ChannelProbeStatus = {
      state: 'error',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      totalUrls: urls.length,
      probed: status.probed,
      success,
      failed,
      totalChannels,
      coverage: 0,
      error: msg,
    };
    await saveStatus(storage, errStatus);
    console.error(`[channel-probe] Error: ${msg}`);
    return errStatus;
  } finally {
    running = false;
  }
}

export function isRunning(): boolean {
  return running;
}
