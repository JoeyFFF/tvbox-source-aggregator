// 直播 URL 探活历史：区分长期失效与短期不可用。
// 只读写 channel_speed_map 中的兼容字段，不改变实际播放地址。

import type { ChannelFailReason, ChannelSpeedEntry } from './types';
import {
  CHANNEL_FAIL_RETRY_MS,
  CHANNEL_LONG_TERM_FAIL_MS,
  CHANNEL_LONG_TERM_MIN_FAILS,
  CHANNEL_LONG_TERM_RECHECK_MS,
} from './config';

export interface ProbeObservation {
  speedMs: number;
  kind: 'm3u8' | 'ts' | 'tcp' | 'fail';
  reason?: ChannelFailReason;
}

/**
 * 确定性失败：DNS 不存在、404/410、非法 URL，识别后立即过滤。
 * 401/403、其他 4xx、连接重置/拒绝属于“长期观察”，走 3 次/7 天阈值。
 */
export const PERMANENT_FAIL_REASONS: ReadonlySet<ChannelFailReason> = new Set([
  'dns-not-found',
  'http-404',
  'http-410',
  'invalid-url',
]);

export const LONG_TERM_OBSERVE_REASONS: ReadonlySet<ChannelFailReason> = new Set([
  'http-401',
  'http-403',
  'http-4xx',
  'http-408',
  'http-429',
  'http-5xx',
  'connection-reset',
  'connection-refused',
  'dns-temporary',
  'network',
]);

export function isPermanentProbeFailure(entry: ChannelSpeedEntry | undefined): boolean {
  return Boolean(
    entry
    && entry.kind === 'fail'
    && entry.lastFailReason
    && PERMANENT_FAIL_REASONS.has(entry.lastFailReason),
  );
}

/** 频道名前缀缩写；同一 DNS/媒体原因合并为一个短标签。 */
export const FAILURE_TAGS: Readonly<Record<ChannelFailReason, string>> = {
  'dns-not-found': 'dns',
  'dns-temporary': 'dns',
  'http-401': '401',
  'http-403': '403',
  'http-404': '404',
  'http-410': '410',
  'http-408': '408',
  'http-429': '429',
  'http-4xx': '4xx',
  'http-5xx': '5xx',
  timeout: 'timeout',
  'connection-reset': 'reset',
  'connection-refused': 'refused',
  'invalid-url': 'invalid',
  'invalid-media': 'invalid',
  network: 'net',
  unknown: 'fail',
};

const FAILURE_TAG_PRIORITY: Record<string, number> = {
  dns: 0, '404': 1, '410': 2, '401': 3, '403': 4, '408': 5, '429': 6,
  '4xx': 7, '5xx': 8, timeout: 9, reset: 10, refused: 11, invalid: 12,
  net: 13, fail: 14,
};

const FAILED_PREFIX_RE = /^\[(?:失效|dns|401|403|404|408|410|429|4xx|5xx|timeout|reset|refused|invalid|net|fail)\]\s*/i;

export function failureTag(reason: ChannelFailReason | undefined): string | null {
  return reason ? FAILURE_TAGS[reason] || null : null;
}

/** 输出频道的失败前缀，兼容旧的 [失效]。 */
export function isFailedChannelName(name: string): boolean {
  return FAILED_PREFIX_RE.test(String(name || ''));
}

export function stripFailurePrefix(name: string): string {
  return String(name || '').replace(FAILED_PREFIX_RE, '');
}

/** 多线路频道取出现次数最多的失败原因；同票按确定性/可诊断优先级决定。 */
export function chooseFailureTag(entries: Array<ChannelSpeedEntry | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const tag = failureTag(entry?.kind === 'fail' ? entry.lastFailReason : undefined);
    if (tag) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (FAILURE_TAG_PRIORITY[a[0]] ?? 99) - (FAILURE_TAG_PRIORITY[b[0]] ?? 99))[0][0];
}

function parseMs(value: string | undefined): number {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : NaN;
}

/** 失败首次发生时间；旧缓存没有 firstFailAt 时从旧 probedAt 推导。 */
export function failureStart(entry: ChannelSpeedEntry | undefined): string | undefined {
  if (!entry || entry.kind !== 'fail') return undefined;
  return entry.firstFailAt || entry.probedAt;
}

/** 连续失败次数；旧缓存没有计数时至少视为一次失败。 */
export function consecutiveFails(entry: ChannelSpeedEntry | undefined): number {
  if (!entry || entry.kind !== 'fail') return 0;
  return Math.max(1, Number(entry.consecutiveFails) || 1);
}

/**
 * 长期失效：连续失败至少 CHANNEL_LONG_TERM_MIN_FAILS 次，且首次失败已超过
 * CHANNEL_LONG_TERM_FAIL_MS。一次画面探活失败、一次 HTTP 错误或未探过的 URL
 * 都不会进入长期失效。
 */
export function isLongTermFailed(entry: ChannelSpeedEntry | undefined, now = Date.now()): boolean {
  if (!entry || entry.kind !== 'fail') return false;
  if (!entry.lastFailReason || !LONG_TERM_OBSERVE_REASONS.has(entry.lastFailReason)) return false;
  if (consecutiveFails(entry) < CHANNEL_LONG_TERM_MIN_FAILS) return false;
  const first = parseMs(failureStart(entry));
  return Number.isFinite(first) && now - first >= CHANNEL_LONG_TERM_FAIL_MS;
}

/** 是否应在本轮重新探测；成功缓存沿用 7 天，短期失败按 24 小时重试。 */
export function shouldProbeEntry(entry: ChannelSpeedEntry | undefined, now = Date.now()): boolean {
  if (!entry) return true;
  if (entry.kind !== 'fail') return false;
  if (isPermanentProbeFailure(entry)) return false;
  const last = parseMs(entry.probedAt);
  if (!Number.isFinite(last)) return true;
  if (isLongTermFailed(entry, now)) return now - last >= CHANNEL_LONG_TERM_RECHECK_MS;
  return now - last >= CHANNEL_FAIL_RETRY_MS;
}

/** 把一次探活结果合并进历史，成功立即清零连续失败。 */
export function applyProbeResult(
  previous: ChannelSpeedEntry | undefined,
  result: ProbeObservation,
  probedAt = new Date().toISOString(),
): ChannelSpeedEntry {
  if (result.kind !== 'fail') {
    return {
      speedMs: result.speedMs,
      probedAt,
      kind: result.kind,
      lastOkAt: probedAt,
      consecutiveFails: 0,
    };
  }

  const prevFails = previous?.kind === 'fail' ? consecutiveFails(previous) : 0;
  const previousStart = previous?.kind === 'fail' ? failureStart(previous) : undefined;
  return {
    speedMs: 0,
    probedAt,
    kind: 'fail',
    firstFailAt: previousStart || probedAt,
    lastOkAt: previous?.lastOkAt,
    consecutiveFails: prevFails + 1,
    lastFailReason: result.reason || 'unknown',
  };
}
