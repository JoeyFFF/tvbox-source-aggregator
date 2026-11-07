// 直播分组规则：管理端保存到 KV，合并时读取；改规则只需 refresh，不用重启。
import {
  DEFAULT_BUILTIN_RULES,
  normalizeBuiltinRuleConfig,
  validateBuiltinRuleConfig,
  type BuiltinRuleConfig,
} from './live-group-defaults';

export const KV_LIVE_GROUP_RULES = 'live_group_rules';
export const KV_LIVE_GROUP_SNAPSHOT = 'live_group_snapshot';

export const LIVE_GROUP_FILTER_TARGET = '__filter__';
const MAX_RULES = 500;
const MAX_FILTER_TARGETS = 50;
const MAX_CHANNELS_PER_GROUP = 5000;
const MAX_GROUP_ORDER = 100;

export interface LiveGroupRule {
  id: string;
  enabled: boolean;
  groupPattern: string;
  channelPattern?: string;
  target: string;
  prefix?: string; // '' | 'province' | 自定义前缀
  priority: number;
}

export interface LiveGroupSortOptions {
  groupOrder?: string[]; // 目标组显示顺序；未列出的组按首次出现顺序排在后面
  channelSort?: 'default' | 'name'; // 组内频道排序：default=按合并出现顺序，name=按显示名
  failedLast?: boolean; // 把带 [失效] 前缀的频道放到组末
}

export interface LiveGroupRuleSet extends LiveGroupSortOptions {
  version: 1;
  rules: LiveGroupRule[];
  filterTargets?: string[]; // 最终目标组整组过滤，例如 ['轮播台']
  builtin?: BuiltinRuleConfig; // 内置规则的可见配置；缺省时使用默认值
  useBuiltin?: boolean; // false = 纯自定义规则，不套用内置规则
}

export interface LiveGroupDecision {
  group: string | null;
  prefix?: string;
}

export interface LiveGroupSnapshotGroup {
  group: string;
  count: number;          // 源条目数（含跨源重复）
  channels: string[];     // 去重后的原始频道名
  targets: Record<string, number>; // 当前规则下的目标分布
}

export interface LiveGroupSnapshot {
  updatedAt: number;
  mode: 'merged';
  totalEntries: number;
  groups: LiveGroupSnapshotGroup[];
}

export type LiveGroupMatcher = (group: string, name: string) => LiveGroupDecision | null;

export interface LiveGroupPreviewGroup {
  group: string;
  count: number;
}

export interface LiveGroupPreviewSource {
  group: string;
  count: number;
  targets: LiveGroupPreviewGroup[];
}

export interface LiveGroupPreviewChannel {
  name: string;        // 最终显示名（含地方台省份前缀）
  sourceName: string;  // 源频道名
  sourceGroup: string; // 来源组
}

export interface LiveGroupPreviewTarget {
  group: string;
  count: number;
  channels: LiveGroupPreviewChannel[];
}

export interface LiveGroupPreview {
  total: number;
  groups: LiveGroupPreviewGroup[];
  sources: LiveGroupPreviewSource[];
  targets: LiveGroupPreviewTarget[];
}

const PROVINCE_NAMES = '北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|广西|海南|四川|贵州|云南|西藏|陕西|甘肃|青海|宁夏|新疆|内蒙古';
const PROVINCE_RE = new RegExp(`^(${PROVINCE_NAMES})(综合|地区)?$`);

export function provinceFromGroup(group: string): string | null {
  const m = String(group || '').match(PROVINCE_RE);
  return m ? m[1] : null;
}

function normalizeTarget(value: unknown): string {
  return String(value ?? '').trim();
}

function compilePattern(pattern: string | undefined): RegExp | null {
  const p = String(pattern || '').trim();
  if (!p) return null;
  return new RegExp(p, 'i');
}

/** 校验并规范化管理端提交的规则。 */
export function validateLiveGroupRules(input: unknown):
  | { ok: true; ruleSet: LiveGroupRuleSet }
  | { ok: false; error: string } {
  const rawRules = Array.isArray(input)
    ? input
    : (input && typeof input === 'object' && Array.isArray((input as { rules?: unknown }).rules)
      ? (input as { rules: unknown[] }).rules
      : null);
  if (!rawRules) return { ok: false, error: 'rules 必须是数组' };
  if (rawRules.length > MAX_RULES) return { ok: false, error: `规则最多 ${MAX_RULES} 条` };

  const rawBuiltin = (!Array.isArray(input) && input && typeof input === 'object'
    && (input as { builtin?: unknown }).builtin != null)
    ? (input as { builtin?: unknown }).builtin
    : undefined;
  const checkedBuiltin = validateBuiltinRuleConfig(rawBuiltin);
  if (!checkedBuiltin.ok) return { ok: false, error: checkedBuiltin.error };

  const rawUseBuiltin = (!Array.isArray(input) && input && typeof input === 'object'
    && typeof (input as { useBuiltin?: unknown }).useBuiltin === 'boolean')
    ? (input as { useBuiltin: boolean }).useBuiltin
    : true;

  const rawFilterTargets = (!Array.isArray(input) && input && typeof input === 'object'
    && Array.isArray((input as { filterTargets?: unknown }).filterTargets))
    ? (input as { filterTargets: unknown[] }).filterTargets
    : [];
  if (rawFilterTargets.length > MAX_FILTER_TARGETS) {
    return { ok: false, error: `整组过滤最多 ${MAX_FILTER_TARGETS} 个目标` };
  }
  const filterTargets: string[] = [];
  for (const raw of rawFilterTargets) {
    if (typeof raw !== 'string') return { ok: false, error: 'filterTargets 必须是字符串数组' };
    const target = raw.trim();
    if (!target) continue;
    if (target.includes(',') || /[\r\n]/.test(target)) {
      return { ok: false, error: 'filterTargets 不能包含逗号或换行' };
    }
    if (!filterTargets.includes(target)) filterTargets.push(target);
  }

  const rawGroupOrder = (!Array.isArray(input) && input && typeof input === 'object'
    && Array.isArray((input as { groupOrder?: unknown }).groupOrder))
    ? (input as { groupOrder: unknown[] }).groupOrder
    : [];
  if (rawGroupOrder.length > MAX_GROUP_ORDER) {
    return { ok: false, error: `组顺序最多 ${MAX_GROUP_ORDER} 个` };
  }
  const groupOrder: string[] = [];
  for (const raw of rawGroupOrder) {
    if (typeof raw !== 'string') return { ok: false, error: 'groupOrder 必须是字符串数组' };
    const name = raw.trim();
    if (!name) continue;
    if (name.includes(',') || /[\r\n]/.test(name)) {
      return { ok: false, error: 'groupOrder 不能包含逗号或换行' };
    }
    if (!groupOrder.includes(name)) groupOrder.push(name);
  }

  const rawChannelSort = (!Array.isArray(input) && input && typeof input === 'object')
    ? (input as { channelSort?: unknown }).channelSort
    : undefined;
  const channelSort = rawChannelSort === 'name' ? 'name' : 'default';
  const rawFailedLast = (!Array.isArray(input) && input && typeof input === 'object')
    ? (input as { failedLast?: unknown }).failedLast
    : undefined;
  const failedLast = rawFailedLast === true;

  const rules: LiveGroupRule[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < rawRules.length; i++) {
    const raw = rawRules[i];
    if (!raw || typeof raw !== 'object') return { ok: false, error: `第 ${i + 1} 条规则不是对象` };
    const r = raw as Record<string, unknown>;
    const target = normalizeTarget(r.target);
    if (!target) return { ok: false, error: `第 ${i + 1} 条规则缺少 target` };
    if (target === '__default__') return { ok: false, error: 'target __default__ 仅供界面使用' };
    if (target.includes(',') || /[\r\n]/.test(target)) {
      return { ok: false, error: `第 ${i + 1} 条规则 target 不能包含逗号或换行` };
    }
    const groupPattern = String(r.groupPattern ?? '').trim();
    const channelPattern = String(r.channelPattern ?? '').trim();
    for (const [label, pattern] of [['groupPattern', groupPattern], ['channelPattern', channelPattern]] as const) {
      if (!pattern) continue;
      try {
        compilePattern(pattern);
      } catch {
        return { ok: false, error: `第 ${i + 1} 条规则 ${label} 不是合法正则` };
      }
    }
    let id = String(r.id ?? '').trim() || `r${i + 1}`;
    while (ids.has(id)) id = `${id}_`;
    ids.add(id);
    const prefixRaw = r.prefix;
    const prefix = prefixRaw === 'province'
      ? 'province'
      : (typeof prefixRaw === 'string' ? prefixRaw.trim() : '');
    const priority = Number.isFinite(Number(r.priority)) ? Number(r.priority) : 0;
    rules.push({
      id,
      enabled: r.enabled !== false,
      groupPattern,
      channelPattern,
      target,
      prefix,
      priority,
    });
  }
  return {
    ok: true,
    ruleSet: {
      version: 1, rules, filterTargets, builtin: checkedBuiltin.config, useBuiltin: rawUseBuiltin,
      groupOrder, channelSort, failedLast,
    },
  };
}

export function parseLiveGroupRules(raw: string | null | undefined): LiveGroupRuleSet {
  const defaults = (): LiveGroupRuleSet => ({
    version: 1, rules: [], filterTargets: [], builtin: normalizeBuiltinRuleConfig(undefined), useBuiltin: true,
  });
  if (!raw) return defaults();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | unknown[];
    // 规则严格校验；builtin 宽松合并，避免旧格式/局部配置导致自定义规则被整体丢弃。
    const checked = validateLiveGroupRules({
      rules: Array.isArray(parsed) ? parsed : parsed.rules,
      filterTargets: Array.isArray(parsed) ? [] : parsed.filterTargets,
      useBuiltin: Array.isArray(parsed) ? true : parsed.useBuiltin,
      groupOrder: Array.isArray(parsed) ? [] : parsed.groupOrder,
      channelSort: Array.isArray(parsed) ? undefined : parsed.channelSort,
      failedLast: Array.isArray(parsed) ? undefined : parsed.failedLast,
      builtin: undefined,
    });
    if (!checked.ok) return defaults();
    return {
      ...checked.ruleSet,
      builtin: normalizeBuiltinRuleConfig(Array.isArray(parsed) ? undefined : parsed.builtin),
    };
  } catch {
    return defaults();
  }
}

/**
 * 规则匹配器：按 priority 从高到低匹配，命中第一条就返回。
 * provinceOf 用于 prefix='province' 时解析源组名的省份。
 */
export function createLiveGroupRuleMatcher(
  ruleSet: LiveGroupRuleSet | undefined,
  provinceOf: (group: string) => string | null = provinceFromGroup,
): LiveGroupMatcher {
  const compiled = (ruleSet?.rules || [])
    .filter((r) => r.enabled)
    .slice()
    .sort((a, b) => b.priority - a.priority)
    .map((rule) => ({
      rule,
      groupRe: compilePattern(rule.groupPattern),
      channelRe: compilePattern(rule.channelPattern),
    }));

  return (group: string, name: string): LiveGroupDecision | null => {
    for (const c of compiled) {
      if (c.groupRe && !c.groupRe.test(group)) continue;
      if (c.channelRe && !c.channelRe.test(name)) continue;
      if (c.rule.target === LIVE_GROUP_FILTER_TARGET || c.rule.target === '__drop__') {
        return { group: null };
      }
      let prefix: string | undefined;
      if (c.rule.prefix === 'province') prefix = provinceOf(group) || undefined;
      else prefix = c.rule.prefix || undefined;
      return { group: c.rule.target, prefix };
    }
    return null;
  };
}

/** 最终目标组整组过滤；在 resolveLiveGroup 之后调用。 */
export function filterLiveGroupDecision(
  decision: LiveGroupDecision,
  filterTargets: Set<string>,
): LiveGroupDecision {
  return decision.group && filterTargets.has(decision.group) ? { group: null } : decision;
}

/* ── 输出排序 ─────────────────────────────────────── */

const LIVE_SORT_COLLATOR = (() => {
  try {
    return new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  } catch {
    return null;
  }
})();

export function stripFailedPrefix(name: string): string {
  return String(name ?? '').replace(/^\[失效\]\s*/, '');
}

/** 英文/数字开头的频道排在汉字、假名、韩文之前（中文区常见的文件排序习惯）。 */
function leadingScriptRank(name: string): number {
  const cp = String(name ?? '').codePointAt(0) ?? 0;
  return cp < 0x2e80 ? 0 : 1;
}

/** 显示名比较：英文/数字在前，中文按拼音、数字按自然序；[失效] 前缀不参与排序。 */
export function compareLiveChannelName(a: string, b: string): number {
  const x = stripFailedPrefix(a);
  const y = stripFailedPrefix(b);
  const rx = leadingScriptRank(x);
  const ry = leadingScriptRank(y);
  if (rx !== ry) return rx - ry;
  const c = LIVE_SORT_COLLATOR ? LIVE_SORT_COLLATOR.compare(x, y) : (x < y ? -1 : x > y ? 1 : 0);
  if (c !== 0) return c;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 按 groupOrder 重排组名；未列出的组保持原相对顺序排在后面。 */
export function orderLiveGroupNames(names: string[], groupOrder?: string[]): string[] {
  const order = (groupOrder || []).filter(Boolean);
  if (order.length === 0) return names.slice();
  const rank = new Map<string, number>();
  for (let i = 0; i < order.length; i++) {
    if (!rank.has(order[i])) rank.set(order[i], i);
  }
  return names.slice().sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a)! : -1;
    const rb = rank.has(b) ? rank.get(b)! : -1;
    if (ra >= 0 && rb >= 0) return ra - rb;
    if (ra >= 0) return -1;
    if (rb >= 0) return 1;
    return 0; // 都未列出：保持原顺序（Array#sort 稳定）
  });
}

/** 组内频道排序；failedLast 始终生效，channelSort=name 时按显示名排序。 */
export function sortLiveGroupChannels<T extends { name: string }>(
  channels: T[],
  options?: LiveGroupSortOptions,
): T[] {
  let list = channels.slice();
  if (options?.channelSort === 'name') {
    list.sort((a, b) => compareLiveChannelName(a.name, b.name));
  }
  if (options?.failedLast) {
    const ok = list.filter((c) => !/^\[失效\]/.test(c.name));
    const failed = list.filter((c) => /^\[失效\]/.test(c.name));
    list = ok.concat(failed);
  }
  return list;
}

export function buildLiveGroupSnapshot(
  entries: Array<{ group: string; name: string }>,
  resolve: (group: string, name: string) => LiveGroupDecision,
): LiveGroupSnapshot {
  const map = new Map<string, { group: string; count: number; channels: Set<string>; targets: Record<string, number> }>();
  for (const e of entries) {
    const srcGroup = e.group || '其他';
    let st = map.get(srcGroup);
    if (!st) {
      st = { group: srcGroup, count: 0, channels: new Set<string>(), targets: {} };
      map.set(srcGroup, st);
    }
    st.count++;
    if (st.channels.size < MAX_CHANNELS_PER_GROUP) st.channels.add(e.name);
    const decision = resolve(srcGroup, e.name);
    const target = decision.group ?? LIVE_GROUP_FILTER_TARGET;
    st.targets[target] = (st.targets[target] || 0) + 1;
  }
  return {
    updatedAt: Date.now(),
    mode: 'merged',
    totalEntries: entries.length,
    groups: Array.from(map.values())
      .map((g) => ({
        group: g.group,
        count: g.count,
        channels: Array.from(g.channels),
        targets: g.targets,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

/** 与合并输出一致的显示名：地方台按省份加前缀。 */
export function buildLiveGroupDisplayName(
  sourceGroup: string,
  name: string,
  decision: LiveGroupDecision,
  provinceOf: (group: string) => string | null = provinceFromGroup,
): string {
  const prefix = decision.prefix !== undefined
    ? decision.prefix
    : (decision.group === '地方台' ? (provinceOf(sourceGroup) || '') : '');
  return prefix && !name.startsWith(prefix) ? `${prefix}·${name}` : name;
}

export function previewLiveGroupSnapshot(
  snapshot: LiveGroupSnapshot,
  resolve: (group: string, name: string) => LiveGroupDecision,
  provinceOf: (group: string) => string | null = provinceFromGroup,
  sortOptions?: LiveGroupSortOptions,
): LiveGroupPreview {
  const sources: LiveGroupPreviewSource[] = [];
  const targetChannels = new Map<string, Map<string, LiveGroupPreviewChannel>>();

  for (const g of snapshot.groups || []) {
    const local = new Map<string, number>();
    const seen = new Set<string>();
    for (const name of g.channels || []) {
      const decision = resolve(g.group, name);
      const target = decision.group ?? LIVE_GROUP_FILTER_TARGET;
      const displayName = buildLiveGroupDisplayName(g.group, name, decision, provinceOf);
      const key = `${target}|${displayName}`;
      if (!seen.has(key)) {
        seen.add(key);
        local.set(target, (local.get(target) || 0) + 1);
      }
      let bucket = targetChannels.get(target);
      if (!bucket) {
        bucket = new Map();
        targetChannels.set(target, bucket);
      }
      if (!bucket.has(displayName)) {
        bucket.set(displayName, { name: displayName, sourceName: name, sourceGroup: g.group });
      }
    }
    sources.push({
      group: g.group,
      count: g.channels?.length || 0,
      targets: Array.from(local.entries())
        .map(([group, count]) => ({ group, count }))
        .sort((a, b) => b.count - a.count),
    });
  }

  let targets: LiveGroupPreviewTarget[] = Array.from(targetChannels.entries())
    .map(([group, bucket]) => ({
      group,
      count: bucket.size,
      channels: sortLiveGroupChannels(Array.from(bucket.values()), sortOptions),
    }))
    .sort((a, b) => b.count - a.count);
  if (sortOptions?.groupOrder?.length) {
    const filterTarget = targets.find((t) => t.group === LIVE_GROUP_FILTER_TARGET);
    const realTargets = targets.filter((t) => t.group !== LIVE_GROUP_FILTER_TARGET);
    const byName = new Map(realTargets.map((t) => [t.group, t]));
    const ordered = orderLiveGroupNames(realTargets.map((t) => t.group), sortOptions.groupOrder)
      .map((name) => byName.get(name))
      .filter((t): t is LiveGroupPreviewTarget => Boolean(t));
    targets = filterTarget ? ordered.concat([filterTarget]) : ordered;
  }

  return {
    total: targets.reduce((sum, target) => sum + target.count, 0),
    groups: targets.map(({ group, count }) => ({ group, count })),
    sources: sources.sort((a, b) => b.count - a.count),
    targets,
  };
}
