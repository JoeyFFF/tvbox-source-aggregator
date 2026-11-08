// 频道排序：分类内频道顺序的自定义 + 央视分组智能排序
//
// 设计取舍：
//   1. 只动「组内频道顺序」，不动分组本身（分组顺序另有 group-order 模块）；
//   2. 智能排序只作用于央视分组，其它分组（卫视/地方台等）一律不碰；
//   3. 排序结果落盘后每次聚合都会套用；频道名变化时未知项自动追加到末尾，
//      不会因为源里新增一台就把用户的手工顺序打乱。

import type { Storage } from '../storage/interface';
import type { TVBoxLiveGroup, TVBoxLiveChannel } from './types';
import { KV_LIVE_CHANNEL_ORDER } from './config';

/** { 分组名: [频道名, ...] } + 跨分组移动 { 频道名: 目标分组 } */
export interface ChannelOrderConfig {
  groups: Record<string, string[]>;
  moves: Record<string, string>;
}

const CCTV_GROUP = '央视';
const FALLBACK_GROUP = '其他';

export async function loadChannelOrder(storage: Storage): Promise<ChannelOrderConfig> {
  const raw = await storage.get(KV_LIVE_CHANNEL_ORDER);
  if (!raw) return { groups: {}, moves: {} };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const groups = (parsed.groups && typeof parsed.groups === 'object') ? parsed.groups : {};
      const moves = (parsed.moves && typeof parsed.moves === 'object') ? parsed.moves : {};
      return { groups, moves };
    }
  } catch {
    /* ignore */
  }
  return { groups: {}, moves: {} };
}

export async function saveChannelOrder(storage: Storage, config: ChannelOrderConfig): Promise<void> {
  await storage.put(KV_LIVE_CHANNEL_ORDER, JSON.stringify({
    groups: config.groups || {},
    moves: config.moves || {},
  }));
}

/**
 * 按已保存的顺序重排各组频道。
 * 未在名单里的频道（源里新增的）保持原相对顺序追加到末尾。
 */
export function applyChannelOrder(
  groups: TVBoxLiveGroup[],
  config: ChannelOrderConfig,
): TVBoxLiveGroup[] {
  const saved = config.groups || {};
  const moves = config.moves || {};

  // 1) 先做跨分组移动（智能排序把非央视频道挪到「其他」）
  let working = groups;
  const moveNames = Object.keys(moves);
  if (moveNames.length > 0) {
    const moving: Record<string, TVBoxLiveChannel[]> = {};
    working = working.map((g) => {
      const keep: TVBoxLiveChannel[] = [];
      for (const ch of g.channels) {
        const target = moves[ch.name];
        if (target && target !== g.group) {
          (moving[target] ||= []).push(ch);
        } else {
          keep.push(ch);
        }
      }
      return { ...g, channels: keep };
    });

    for (const [target, channels] of Object.entries(moving)) {
      const existing = working.find((g) => g.group === target);
      if (existing) existing.channels = [...existing.channels, ...channels];
      else working.push({ group: target, channels });
    }
    working = working.filter((g) => g.channels.length > 0);
  }

  // 2) 再按保存的顺序重排组内频道
  return working.map((group) => {
    const order = saved[group.group];
    if (!Array.isArray(order) || order.length === 0) return group;

    const index = new Map<string, number>();
    order.forEach((name, i) => index.set(name, i));

    const known: TVBoxLiveChannel[] = [];
    const rest: TVBoxLiveChannel[] = [];
    for (const ch of group.channels) {
      if (index.has(ch.name)) known.push(ch);
      else rest.push(ch);
    }
    known.sort((a, b) => (index.get(a.name)! - index.get(b.name)!));

    return { ...group, channels: [...known, ...rest] };
  });
}

// ─── 央视智能排序 ──────────────────────────────────────

/**
 * 层级：
 *   1 = CCTV-N 主频道（含 +/4K/地区版变体）
 *   2 = 央视国际/新媒体（CCTV+、CCTV-NEWS、CCTV★移动传媒、CGTN 系列）
 *   3 = 央视数字付费频道（风云系列、第一剧场等）
 *   0 = 无法识别 → 移出央视分组
 */
interface CctvRank {
  tier: number;
  num: number;
  variant: number; // 0 本体 / 1 + / 2 4K·8K / 3 地区·港澳版
  seq: number;     // 同层级内的次级序号
}

/** 央视数字付费/专业频道（央视风云系列等），归入 tier 3 保留在组内 */
const CCTV_PAY_TV = new Set([
  '兵器科技', '第一剧场', '电视指南', '发现之旅', '风云剧场', '风云音乐', '风云足球',
  '高尔夫网球', '怀旧剧场', '老故事', '女性时尚', '世界地理', '卫生健康', '文化精品',
  '央视高网', '央视台球', '中学生', '央视文体精品', '央视放映室', '央视精品',
  'CCTV央视文体精品', 'CCTV放映室',
]);

const CGTN_ORDER = [
  'CGTN', 'CGTN纪录', 'CGTN法语', 'CGTN西班牙语', 'CGTN阿拉伯语', 'CGTN俄语', 'CGTN Radio', 'CGTN Global Biz',
];

export function parseCctvRank(rawName: string): CctvRank | null {
  const name = rawName.replace(/\s+/g, '').replace(/[【】\[\]（）()]/g, '');
  if (!name) return null;

  // 已失效/异常条目
  if (/失效|测试|预告/.test(name)) return null;

  // CCTV + 纯数字（1~2 位）
  const m = name.match(/^CCTV[-_]?(\d{1,2})(.*)$/i);
  if (m) {
    const num = parseInt(m[1], 10);
    if (!(num >= 1 && num <= 20)) return null;
    const rest = (m[2] || '').replace(/^[-_\s]+/, '');

    // 数字后面只能是「已知变体」或什么都不跟，否则视为伪 CCTV 频道
    // （CCTV9576 / CCTV20241 这类是私人转播源的乱命名，不能当成 CCTV95 / CCTV20）
    let variant: number;
    if (rest === '') variant = 0;
    else if (rest.startsWith('+')) variant = 1;                 // CCTV5+ / CCTV5+体育
    else if (/^K/i.test(rest) || /4K|8K/i.test(rest)) variant = 2; // CCTV4K / CCTV16-4K
    else if (/港澳|美洲|欧洲|America|Europe|亚太/i.test(rest)) variant = 3; // CCTV4美洲 / CCTV1港澳版
    else if (/^(高清|超清|体育|综合|财经|综艺|中文国际|军事|农业|纪录|科教|社会与法|新闻|少儿|音乐|电影|电视剧|戏曲)/.test(rest)) variant = 0;
    else return null;

    return { tier: 1, num, variant, seq: 0 };
  }

  // 央视国际/新媒体
  if (/^CCTV\+/i.test(name)) {
    const tail = name.slice(5);
    const n = parseInt(tail.replace(/\D/g, ''), 10);
    return { tier: 2, num: 0, variant: 0, seq: 10 + (isFinite(n) ? n : 0) };
  }
  if (/^CCTV-NEWS$/i.test(name) || /^CCTVNEWS$/i.test(name)) {
    return { tier: 2, num: 0, variant: 0, seq: 20 };
  }
  if (/^CCTV[★*]/.test(name)) {
    return { tier: 2, num: 0, variant: 0, seq: 30 };
  }
  if (/^CGTN/i.test(name)) {
    const idx = CGTN_ORDER.indexOf(name.replace(/\s+/g, ''));
    return { tier: 2, num: 0, variant: 0, seq: 40 + (idx >= 0 ? idx : 9) };
  }

  // 央视数字付费/专业频道
  if (CCTV_PAY_TV.has(rawName.trim()) || CCTV_PAY_TV.has(name) || /^央视/.test(name)) {
    return { tier: 3, num: 0, variant: 0, seq: 0 };
  }

  return null;
}

function compareRank(a: CctvRank, b: CctvRank): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.num !== b.num) return a.num - b.num;
  if (a.variant !== b.variant) return a.variant - b.variant;
  return a.seq - b.seq;
}

export interface SmartSortResult {
  groups: TVBoxLiveGroup[];
  order: string[];                          // 央视组新顺序
  moves: Record<string, string>;            // 被移出的频道 → 目标分组
  movedOut: string[];
  keptCount: number;
}

/**
 * 央视分组智能排序：
 *   - CCTV1 → CCTV17 数字顺序，+ 号变体紧跟本体（CCTV5 → CCTV5+）
 *   - 央视国际/新媒体、数字付费频道排在主频道之后
 *   - 无法识别的（编号异常、失效条目）移出到「其他」分组末尾
 */
export function smartSortCctv(groups: TVBoxLiveGroup[]): SmartSortResult {
  const cctv = groups.find((g) => g.group === CCTV_GROUP);
  if (!cctv) return { groups, order: [], moves: {}, movedOut: [], keptCount: 0 };

  const kept: Array<{ ch: TVBoxLiveChannel; rank: CctvRank; idx: number }> = [];
  const moved: TVBoxLiveChannel[] = [];

  cctv.channels.forEach((ch, idx) => {
    const rank = parseCctvRank(ch.name);
    if (rank) kept.push({ ch, rank, idx });
    else moved.push(ch);
  });

  kept.sort((a, b) => compareRank(a.rank, b.rank) || a.idx - b.idx);
  const sortedChannels = kept.map((k) => k.ch);

  const result: TVBoxLiveGroup[] = [];
  for (const g of groups) {
    if (g.group === CCTV_GROUP) {
      result.push({ ...g, channels: sortedChannels });
    } else {
      result.push(g);
    }
  }

  if (moved.length > 0) {
    const target = result.find((g) => g.group === FALLBACK_GROUP);
    if (target) {
      target.channels = [...target.channels, ...moved];
    } else {
      result.push({ group: FALLBACK_GROUP, channels: moved });
    }
  }

  const moves: Record<string, string> = {};
  for (const ch of moved) moves[ch.name] = FALLBACK_GROUP;

  return {
    groups: result,
    order: sortedChannels.map((c) => c.name),
    moves,
    movedOut: moved.map((c) => c.name),
    keptCount: sortedChannels.length,
  };
}
