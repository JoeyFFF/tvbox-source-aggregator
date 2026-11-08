// 频道级 URL 测速（方案 D+，仅 Node/Docker 跑）
// 独立模块：不阻塞主聚合，失败不影响聚合产出

import type { Storage } from '../storage/interface';
import type { TVBoxLiveGroup, ChannelSpeedMap, ChannelProbeStatus } from './types';
import {
  KV_CHANNEL_SPEED_MAP,
  KV_CHANNEL_PROBE_STATUS,
  KV_CHANNEL_PROBE_ENABLED,
  KV_CHANNEL_MERGED_TREE,
  CHANNEL_PROBE_CONCURRENCY,
  CHANNEL_PROBE_TIMEOUT_MS,
  CHANNEL_PROBE_SAMPLES,
  CHANNEL_PROBE_BUDGET_MS,
  CHANNEL_SPEED_TTL_MS,
  CHANNEL_DEAD_FAILS,
  TVBOX_UA,
} from './config';
import { extractAllUrls } from './live-merger';
import { removeRecoveredUrls } from './live-deadlist';

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

/** 清理 7 天前的测速缓存 */
export function pruneExpired(map: ChannelSpeedMap): ChannelSpeedMap {
  const now = Date.now();
  const out: ChannelSpeedMap = {};
  for (const [url, entry] of Object.entries(map)) {
    const ts = Date.parse(entry.probedAt);
    if (isFinite(ts) && now - ts < CHANNEL_SPEED_TTL_MS) {
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
  samples: number;
}

async function probeOnce(url: string): Promise<{ speedMs: number; kind: 'm3u8' | 'ts' | 'tcp' | 'fail'; timedOut: boolean }> {
  const isM3U8 = /\.m3u8(\?|$)/i.test(url);
  const isTs = /\.(ts|flv|mp4)(\?|$)/i.test(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHANNEL_PROBE_TIMEOUT_MS);
  const start = Date.now();

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': TVBOX_UA },
    });
    const ttfb = Date.now() - start;

    if (!resp.ok) {
      clearTimeout(timer);
      return { speedMs: 0, kind: 'fail', timedOut: false };
    }

    const reader = resp.body?.getReader();
    if (!reader) {
      clearTimeout(timer);
      return { speedMs: ttfb, kind: 'tcp', timedOut: false };
    }

    try {
      const { value } = await reader.read();
      clearTimeout(timer);
      if (!value) {
        return { speedMs: ttfb, kind: 'tcp', timedOut: false };
      }

      if (isM3U8) {
        const head = new TextDecoder().decode(value.slice(0, Math.min(1024, value.length)));
        if (head.includes('#EXTM3U')) {
          return { speedMs: ttfb, kind: 'm3u8', timedOut: false };
        }
        return { speedMs: 0, kind: 'fail', timedOut: false };
      }

      if (isTs) {
        // 检查 sync byte 0x47（4KB 内任何位置）
        const end = Math.min(4096, value.length);
        for (let i = 0; i < end; i += 188) {
          if (value[i] === 0x47) {
            return { speedMs: ttfb, kind: 'ts', timedOut: false };
          }
        }
        // 没找到 sync byte 也不一定失败（可能是 HTTP-FLV 等），用 tcp 标记
        return { speedMs: ttfb, kind: 'tcp', timedOut: false };
      }

      return { speedMs: ttfb, kind: 'tcp', timedOut: false };
    } finally {
      reader.cancel().catch(() => {});
    }
  } catch (e: unknown) {
    clearTimeout(timer);
    const timedOut = e instanceof Error && e.name === 'AbortError';
    return { speedMs: 0, kind: 'fail', timedOut };
  }
}

/**
 * 多次采样取中位数：单次 TTFB 抖动很大（DNS/首包/CDN 调度），
 * 用中位数排序才能让「真正快」的源稳定排第一。
 *
 * 失败重试策略：只有「快速失败」（连接被拒/404）才重试，
 * 超时已经等满 5 秒，再试一次纯属浪费——死链占大头，这一步能省一半时间。
 */
async function probeSingle(url: string): Promise<ProbeResult> {
  const ok: Array<{ speedMs: number; kind: 'm3u8' | 'ts' | 'tcp' }> = [];

  for (let i = 0; i < CHANNEL_PROBE_SAMPLES; i++) {
    const r = await probeOnce(url);
    if (r.kind === 'fail') {
      if (r.timedOut) break;
      const retry = await probeOnce(url);
      if (retry.kind === 'fail') break;
      ok.push({ speedMs: retry.speedMs, kind: retry.kind });
    } else {
      ok.push({ speedMs: r.speedMs, kind: r.kind });
    }
  }

  if (ok.length === 0) return { url, speedMs: 0, kind: 'fail', samples: 0 };

  const speeds = ok.map((r) => r.speedMs).sort((a, b) => a - b);
  const median = speeds[Math.floor(speeds.length / 2)];
  // 保留最具体的判定（m3u8 > ts > tcp）
  const best = ok.find((r) => r.kind === 'm3u8') || ok.find((r) => r.kind === 'ts') || ok[0];

  return { url, speedMs: median, kind: best.kind, samples: ok.length };
}

// ─── 并发池 ────────────────────────────────────────────

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
  deadline?: number,
): Promise<{ results: R[]; done: number; budgetExhausted: boolean }> {
  const results: R[] = new Array(items.length);
  let index = 0;
  let done = 0;
  let budgetExhausted = false;

  async function worker() {
    while (index < items.length) {
      if (deadline && Date.now() >= deadline) {
        budgetExhausted = true;
        return;
      }
      const i = index++;
      try {
        results[i] = await fn(items[i], i);
      } catch {
        // 兜底：fn 理论上已内部 try/catch；此路径保险返回显式 fail 对象
        results[i] = { url: String(items[i]), speedMs: 0, kind: 'fail', samples: 0 } as R;
      }
      done++;
      if (onProgress && done % 50 === 0) onProgress(done, items.length);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  if (onProgress) onProgress(done, items.length);
  return { results, done, budgetExhausted };
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

  const urls = extractAllUrls(groups);
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
    // 读旧缓存：不过期就复用，过期的全部重测（旧实现是「测过就永不再测」，导致排序永久固化）
    const cached = await loadSpeedMap(storage);
    const nowMs = Date.now();
    const isStale = (u: string): boolean => {
      const e = cached[u];
      if (!e) return true;
      const t = Date.parse(e.probedAt);
      return !isFinite(t) || nowMs - t > CHANNEL_SPEED_TTL_MS;
    };

    // 待测队列：先测从没测过的，再按上次测速时间由旧到新
    const toProbe = urls.filter(isStale).sort((a, b) => {
      const ta = cached[a] ? Date.parse(cached[a].probedAt) || 0 : 0;
      const tb = cached[b] ? Date.parse(cached[b].probedAt) || 0 : 0;
      return ta - tb;
    });
    const freshCount = urls.length - toProbe.length;
    console.log(`[channel-probe] ${toProbe.length} URLs to probe (${freshCount} still fresh, ttl=${Math.round(CHANNEL_SPEED_TTL_MS / 3600000)}h)`);

    // 只保留仍在当前频道树里的 URL（老 URL 自然淘汰）
    const urlSet = new Set(urls);
    const next: ChannelSpeedMap = {};
    for (const [u, e] of Object.entries(cached)) {
      if (urlSet.has(u)) next[u] = e;
    }

    // 本轮恢复可用的 URL（用于自动移出死源黑名单）
    const recovered: string[] = [];

    // 每条结果即时落到 next，并定期落盘 —— 跑 20 分钟的任务不能一崩全丢
    const applyResult = (r: ProbeResult): void => {
      if (!r || !r.url) return;
      const prev = next[r.url];
      if (r.kind === 'fail') {
        failed++;
        // 连续失败累计：达到阈值才算死链（单次抖动不算）
        next[r.url] = {
          speedMs: 0,
          probedAt: new Date().toISOString(),
          kind: 'fail',
          fails: (prev?.fails ?? 0) + 1,
        };
      } else {
        success++;
        recovered.push(r.url);
        next[r.url] = {
          speedMs: r.speedMs,
          probedAt: new Date().toISOString(),
          kind: r.kind,
          fails: 0,
          samples: r.samples,
        };
      }
    };

    const { done, budgetExhausted } = await runWithConcurrency(
      toProbe,
      CHANNEL_PROBE_CONCURRENCY,
      async (url) => {
        const r = await probeSingle(url);
        applyResult(r);
        return r;
      },
      (d, total) => {
        status.probed = d + freshCount; // 含缓存命中
        status.success = success;
        status.failed = failed;
        saveStatus(storage, status).catch(() => {});
        if (d % 300 === 0) {
          saveSpeedMap(storage, next).catch(() => {});
          console.log(`[channel-probe] Progress: ${d}/${total}`);
        }
      },
      startMs + CHANNEL_PROBE_BUDGET_MS,
    );

    await saveSpeedMap(storage, next);

    // 自愈：之前被判死、这次又活了的 URL，移出死源黑名单
    if (recovered.length > 0) {
      const revived = await removeRecoveredUrls(storage, recovered);
      if (revived > 0) console.log(`[channel-probe] ${revived} URLs recovered, removed from dead list`);
    }

    // 覆盖率按「可用缓存」算：成功 + 未过期未重测的
    const okCached = Object.entries(next).filter(
      ([, e]) => e.kind !== 'fail' && nowMs - (Date.parse(e.probedAt) || 0) <= CHANNEL_SPEED_TTL_MS,
    ).length;
    const deadCount = Object.values(next).filter((e) => (e.fails ?? 0) >= CHANNEL_DEAD_FAILS).length;
    const durationMs = Date.now() - startMs;
    const coverage = urls.length > 0 ? Math.round((okCached / urls.length) * 100) : 0;

    const finalStatus: ChannelProbeStatus = {
      state: budgetExhausted ? 'partial' : 'done',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs,
      totalUrls: urls.length,
      probed: done + freshCount,
      success,
      failed,
      totalChannels,
      coverage,
      pending: toProbe.length - done,
      dead: deadCount,
    };
    await saveStatus(storage, finalStatus);

    console.log(
      `[channel-probe] ${budgetExhausted ? 'Budget reached' : 'Done'} in ${(durationMs / 1000).toFixed(1)}s: ` +
      `probed ${done}/${toProbe.length}, ok=${okCached}/${urls.length} (${coverage}%), dead=${deadCount}` +
      (budgetExhausted ? `, ${toProbe.length - done} left for next round` : ''),
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
