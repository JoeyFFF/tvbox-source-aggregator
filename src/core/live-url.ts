// 直播 URL 的统一处理：解析「url$源名」、拼装、按测速结果排序
//
// 抽成独立模块的原因：
//   1. `$源名` 的解析原来散落在 parseTxt / parseM3U / extractAllUrls 三处，
//      其中两处没有剥离，导致带后缀的 URL 直接去测速必然失败；
//   2. 排序规则（可用 > 未测 > 失败 > 死链）需要在「按源分开」和「全部合并」
//      两种输出模式下保持一致，写在 live-merger 里会各写一份。

import type { ChannelSpeedEntry, ChannelSpeedMap } from './types';
import { CHANNEL_DEAD_FAILS } from './config';

export interface SplitResult {
  url: string;
  source: string;
}

/**
 * 拆出 `http://xxx$源A` 里的源名。
 * 只认「http(s)://...$名称」形态（名称不含空白和斜杠），避免误伤带 `$` 的正常 URL。
 */
export function splitUrlSource(raw: string, fallbackSource = ''): SplitResult {
  const i = raw.lastIndexOf('$');
  if (i > 0) {
    const head = raw.slice(0, i);
    const tail = raw.slice(i + 1);
    if (/^https?:\/\//i.test(head) && tail && !/[\s/]/.test(tail)) {
      return { url: head, source: tail };
    }
  }
  return { url: raw, source: fallbackSource };
}

/** 只要裸 URL（去掉 `$源名`），用于测速与去重 */
export function bareUrl(raw: string): string {
  return splitUrlSource(raw).url;
}

/** 拼回 TVBox 的 `url$源名` 形态 */
export function joinUrlSource(url: string, source: string): string {
  return source ? `${url}$${source}` : url;
}

/** 排序优先级：0 可用 / 1 未测 / 2 失败一次 / 3 确认死链 */
export const DEAD_RANK = 3;

/**
 * 死链档位：连续失败达到 CHANNEL_DEAD_FAILS 轮。
 * 死链只排到末尾，不删除 —— 误判时可以人工切回来。
 */
export function rankOf(entry: ChannelSpeedEntry | undefined): number {
  if (!entry) return 1;
  if (entry.kind !== 'fail') return 0;
  return (entry.fails ?? 1) >= CHANNEL_DEAD_FAILS ? DEAD_RANK : 2;
}

/** 按测速结果排序：可用按中位延迟升序，其余按档位排序 */
export function compareBySpeed<T extends { url: string; sourceSpeedMs?: number }>(
  a: T,
  b: T,
  speedMap?: ChannelSpeedMap,
): number {
  const ea = speedMap?.[a.url];
  const eb = speedMap?.[b.url];
  const ra = rankOf(ea);
  const rb = rankOf(eb);
  if (ra !== rb) return ra - rb;

  if (ra === 0 && ea && eb) {
    const d = ea.speedMs - eb.speedMs;
    if (d !== 0) return d;
  }

  // 同档位降级：源级 speedMs（没有测速数据时至少保持稳定顺序）
  return (a.sourceSpeedMs ?? Infinity) - (b.sourceSpeedMs ?? Infinity);
}
