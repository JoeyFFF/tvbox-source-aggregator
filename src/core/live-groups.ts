// 直播分组归并
//
// 问题：几十个配置源各带一套分组名（"影视""数字频道""某某专线"…），
// 合并后能有几百个分组，电视上翻起来是灾难。
//
// 做法：定义一组标准分组 + 关键词映射，把杂组收进标准组，认不出来的兜底到「其他」。
// 频道本身仍按名字跨源合并（一个台挂多个源），归并只影响它落在哪个分组里。

import type { Storage } from '../storage/interface';
import { KV_LIVE_GROUP_MERGE } from './config';

export interface LiveGroupRule {
  keyword: string;
  target: string;
}

export interface LiveGroupMergeConfig {
  enabled: boolean;
  standard: string[];
  rules: LiveGroupRule[];
}

/**
 * 标准分组，顺序 = 展示顺序，也是「同一频道出现在多个分组时」的优先级
 * （越靠前越具体，例如同时出现在「央视」和「其他」里，归到央视）
 */
export const DEFAULT_STANDARD = [
  '央视', '卫视', '境内地方', '境内专题',
  '港澳台', '台湾', '韩国', '日本',
  '体育赛事', '少儿动画', '纪录科教', '国际新闻', '其他海外',
  '其他',
];

export const DEFAULT_RULES: LiveGroupRule[] = [
  { keyword: '央视', target: '央视' },
  { keyword: 'CCTV', target: '央视' },
  { keyword: 'CGTN', target: '央视' },
  { keyword: '中央', target: '央视' },

  { keyword: '卫视', target: '卫视' },

  { keyword: '港澳', target: '港澳台' },
  { keyword: '香港', target: '港澳台' },
  { keyword: '澳门', target: '港澳台' },
  { keyword: 'hong_kong', target: '港澳台' },
  { keyword: 'macau', target: '港澳台' },

  { keyword: '台湾', target: '台湾' },
  { keyword: 'taiwan', target: '台湾' },

  { keyword: '韩国', target: '韩国' },
  { keyword: '日本', target: '日本' },

  { keyword: '体育', target: '体育赛事' },
  { keyword: '赛事', target: '体育赛事' },
  { keyword: '足球', target: '体育赛事' },
  { keyword: '篮球', target: '体育赛事' },
  { keyword: '网球', target: '体育赛事' },
  { keyword: '台球', target: '体育赛事' },

  { keyword: '少儿', target: '少儿动画' },
  { keyword: '动画', target: '少儿动画' },
  { keyword: '卡通', target: '少儿动画' },
  { keyword: '儿童', target: '少儿动画' },
  { keyword: '动漫', target: '少儿动画' },

  { keyword: '纪录', target: '纪录科教' },
  { keyword: '纪实', target: '纪录科教' },
  { keyword: '科教', target: '纪录科教' },
  { keyword: '探索', target: '纪录科教' },
  { keyword: '地理', target: '纪录科教' },

  { keyword: '新闻', target: '国际新闻' },
  { keyword: '资讯', target: '国际新闻' },

  { keyword: '地方', target: '境内地方' },
  { keyword: '城市', target: '境内地方' },
  { keyword: '县市', target: '境内地方' },
  { keyword: '省内', target: '境内地方' },
  { keyword: '本地', target: '境内地方' },

  { keyword: '专题', target: '境内专题' },
  { keyword: '剧场', target: '境内专题' },
  { keyword: '电影', target: '境内专题' },
  { keyword: '电视剧', target: '境内专题' },
  { keyword: '影视', target: '境内专题' },
  { keyword: '综艺', target: '境内专题' },
  { keyword: '戏曲', target: '境内专题' },
  { keyword: '音乐', target: '境内专题' },

  { keyword: '海外', target: '其他海外' },
  { keyword: '国际', target: '其他海外' },
  { keyword: '欧美', target: '其他海外' },
];

const FALLBACK = '其他';

export function defaultLiveGroupMerge(): LiveGroupMergeConfig {
  return { enabled: true, standard: [...DEFAULT_STANDARD], rules: [...DEFAULT_RULES] };
}

export async function loadLiveGroupMerge(storage: Storage): Promise<LiveGroupMergeConfig> {
  const raw = await storage.get(KV_LIVE_GROUP_MERGE);
  if (!raw) return defaultLiveGroupMerge();
  try {
    const parsed = JSON.parse(raw);
    const standard = Array.isArray(parsed.standard) && parsed.standard.length > 0
      ? parsed.standard.filter((x: unknown): x is string => typeof x === 'string')
      : [...DEFAULT_STANDARD];
    const rules = Array.isArray(parsed.rules)
      ? parsed.rules
        .filter((r: unknown) => r && typeof (r as LiveGroupRule).keyword === 'string' && typeof (r as LiveGroupRule).target === 'string')
        .map((r: LiveGroupRule) => ({ keyword: r.keyword.trim(), target: r.target.trim() }))
        .filter((r: LiveGroupRule) => r.keyword && r.target)
      : [...DEFAULT_RULES];
    return { enabled: parsed.enabled !== false, standard, rules };
  } catch {
    return defaultLiveGroupMerge();
  }
}

export async function saveLiveGroupMerge(storage: Storage, cfg: LiveGroupMergeConfig): Promise<void> {
  await storage.put(KV_LIVE_GROUP_MERGE, JSON.stringify({
    enabled: !!cfg.enabled,
    standard: cfg.standard || DEFAULT_STANDARD,
    rules: cfg.rules || DEFAULT_RULES,
  }));
}

/** 分组名归一：已是标准组则原样返回，否则按关键词映射，认不出就进「其他」 */
export function normalizeGroupName(raw: string, cfg: LiveGroupMergeConfig): string {
  const name = (raw || '').trim();
  if (!name) return FALLBACK;
  if (cfg.standard.includes(name)) return name;

  const upper = name.toUpperCase();
  for (const rule of cfg.rules) {
    const kw = rule.keyword.toUpperCase();
    if (kw && upper.includes(kw) && cfg.standard.includes(rule.target)) {
      return rule.target;
    }
  }
  return FALLBACK;
}

/** 分组优先级：标准组按配置顺序，越靠前越具体；未知组最末 */
export function groupPriority(name: string, cfg: LiveGroupMergeConfig): number {
  const i = cfg.standard.indexOf(name);
  return i >= 0 ? i : cfg.standard.length + 1;
}
