// 直播频道过滤：目前只有「购物台」一项
//
// 关键词要精确：真实源里「精选」会命中 13 个音乐合辑，
// 所以只用「购物」「好享购」「快乐购」这类明确指向电视购物的词。

import type { Storage } from '../storage/interface';
import { KV_LIVE_SHOPPING_FILTER } from './config';

export interface ShoppingFilterConfig {
  enabled: boolean;
  keywords: string[];
}

export const DEFAULT_SHOPPING_KEYWORDS = [
  '购物',
  '好享购',
  '快乐购',
  '优购物',
  '家有购物',
  '风尚购物',
  '央广购物',
  '环球购物',
  '中视购物',
  '居家购物',
  '电视购物',
  '购物频道',
  // 推广/乞讨类频道（实测源里有「支持作者」这种）
  '支持作者',
  '打赏',
  '赞助',
  '加群',
  '公众号',
];

export function defaultShoppingFilter(): ShoppingFilterConfig {
  return { enabled: true, keywords: [...DEFAULT_SHOPPING_KEYWORDS] };
}

export async function loadShoppingFilter(storage: Storage): Promise<ShoppingFilterConfig> {
  const raw = await storage.get(KV_LIVE_SHOPPING_FILTER);
  if (!raw) return defaultShoppingFilter();
  try {
    const parsed = JSON.parse(raw);
    const keywords = Array.isArray(parsed.keywords) && parsed.keywords.length > 0
      ? parsed.keywords.filter((x: unknown): x is string => typeof x === 'string' && !!x.trim()).map((x: string) => x.trim())
      : [...DEFAULT_SHOPPING_KEYWORDS];
    return { enabled: parsed.enabled !== false, keywords };
  } catch {
    return defaultShoppingFilter();
  }
}

export async function saveShoppingFilter(storage: Storage, cfg: ShoppingFilterConfig): Promise<void> {
  await storage.put(KV_LIVE_SHOPPING_FILTER, JSON.stringify({
    enabled: !!cfg.enabled,
    keywords: cfg.keywords && cfg.keywords.length > 0 ? cfg.keywords : DEFAULT_SHOPPING_KEYWORDS,
  }));
}

export function isShoppingChannel(name: string, cfg?: ShoppingFilterConfig): boolean {
  if (!cfg?.enabled) return false;
  const n = (name || '').trim();
  if (!n) return false;
  return cfg.keywords.some((k) => k && n.includes(k));
}
