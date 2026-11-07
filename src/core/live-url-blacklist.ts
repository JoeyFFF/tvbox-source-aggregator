// 直播源正则黑名单：按播放地址、直播源名、频道名或原始分组过滤频道条目。
// 规则保存在 KV，直播合并时在 parseLiveContent 之后、分组/合并之前应用。

import type { Storage } from '../storage/interface';
import { KV_LIVE_URL_BLACKLIST } from './config';
import { validateRegexRule } from './blacklist';

export const LIVE_URL_BLACKLIST_FIELDS = ['url', 'source', 'name', 'group'] as const;
export type LiveUrlBlacklistField = (typeof LIVE_URL_BLACKLIST_FIELDS)[number];

export interface LiveUrlBlacklistRule {
  id: string;
  pattern: string;
  field: LiveUrlBlacklistField;
  enabled: boolean;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LiveUrlBlacklistRuleSet {
  version: 1;
  rules: LiveUrlBlacklistRule[];
}

export interface LiveUrlBlacklistTarget {
  url: string;
  source?: string;
  name?: string;
  group?: string;
}

const MAX_RULES = 500;
const MAX_NOTE_LENGTH = 200;
const EMPTY: LiveUrlBlacklistRuleSet = { version: 1, rules: [] };

function nowIso(): string {
  return new Date().toISOString();
}

function newId(index: number): string {
  return `lub-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeField(value: unknown): LiveUrlBlacklistField | null {
  return LIVE_URL_BLACKLIST_FIELDS.includes(value as LiveUrlBlacklistField)
    ? value as LiveUrlBlacklistField
    : null;
}

function normalizeRule(raw: unknown, index: number, usedIds: Set<string>): { ok: true; rule: LiveUrlBlacklistRule } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: `第 ${index + 1} 条不是对象` };
  const input = raw as Record<string, unknown>;
  const pattern = String(input.pattern ?? '').trim();
  if (!pattern) return { ok: false, error: `第 ${index + 1} 条缺少 pattern` };
  const checked = validateRegexRule(pattern);
  if (!checked.ok) return { ok: false, error: `第 ${index + 1} 条：${checked.error}` };
  const field = normalizeField(input.field);
  if (!field) return { ok: false, error: `第 ${index + 1} 条 field 必须是 url/source/name/group` };
  let id = String(input.id ?? '').trim() || newId(index);
  while (usedIds.has(id)) id = `${id}_`;
  usedIds.add(id);
  const note = String(input.note ?? '').trim().slice(0, MAX_NOTE_LENGTH);
  const createdAt = typeof input.createdAt === 'string' && input.createdAt ? input.createdAt : nowIso();
  const updatedAt = typeof input.updatedAt === 'string' && input.updatedAt ? input.updatedAt : createdAt;
  return {
    ok: true,
    rule: {
      id,
      pattern,
      field,
      enabled: input.enabled !== false,
      note: note || undefined,
      createdAt,
      updatedAt,
    },
  };
}

export function validateLiveUrlBlacklist(input: unknown): { ok: true; ruleSet: LiveUrlBlacklistRuleSet } | { ok: false; error: string } {
  const rawRules = Array.isArray(input)
    ? input
    : (input && typeof input === 'object' && Array.isArray((input as Record<string, unknown>).rules))
      ? (input as Record<string, unknown>).rules as unknown[]
      : null;
  if (!rawRules) return { ok: false, error: 'rules 必须是数组' };
  if (rawRules.length > MAX_RULES) return { ok: false, error: `规则最多 ${MAX_RULES} 条` };
  const rules: LiveUrlBlacklistRule[] = [];
  const usedIds = new Set<string>();
  for (let i = 0; i < rawRules.length; i++) {
    const checked = normalizeRule(rawRules[i], i, usedIds);
    if (!checked.ok) return checked;
    rules.push(checked.rule);
  }
  return { ok: true, ruleSet: { version: 1, rules } };
}

export function parseLiveUrlBlacklist(raw: string | null | undefined): LiveUrlBlacklistRuleSet {
  if (!raw) return EMPTY;
  try {
    const checked = validateLiveUrlBlacklist(JSON.parse(raw));
    if (checked.ok) return checked.ruleSet;
    console.warn(`[live-url-blacklist] Invalid stored rules: ${checked.error}`);
  } catch (err) {
    console.warn(`[live-url-blacklist] Failed to parse stored rules: ${err instanceof Error ? err.message : String(err)}`);
  }
  return EMPTY;
}

export async function loadLiveUrlBlacklist(storage: Storage): Promise<LiveUrlBlacklistRuleSet> {
  return parseLiveUrlBlacklist(await storage.get(KV_LIVE_URL_BLACKLIST));
}

export async function saveLiveUrlBlacklist(storage: Storage, ruleSet: LiveUrlBlacklistRuleSet): Promise<void> {
  await storage.put(KV_LIVE_URL_BLACKLIST, JSON.stringify(ruleSet));
}

export interface LiveUrlBlacklistMatcher {
  rule: LiveUrlBlacklistRule;
  regex: RegExp;
}

export function compileLiveUrlBlacklist(ruleSet: LiveUrlBlacklistRuleSet | undefined): LiveUrlBlacklistMatcher[] {
  return (ruleSet?.rules || [])
    .filter((rule) => rule.enabled)
    .map((rule) => {
      try {
        return { rule, regex: new RegExp(rule.pattern, 'i') };
      } catch {
        return null;
      }
    })
    .filter((item): item is LiveUrlBlacklistMatcher => item !== null);
}

export function matchLiveUrlBlacklist(
  entry: LiveUrlBlacklistTarget,
  matchers: LiveUrlBlacklistMatcher[],
): LiveUrlBlacklistMatcher | null {
  if (matchers.length === 0) return null;
  for (const matcher of matchers) {
    const value = matcher.rule.field === 'url'
      ? entry.url
      : matcher.rule.field === 'source'
        ? entry.source
        : matcher.rule.field === 'name'
          ? entry.name
          : entry.group;
    if (matcher.regex.test(String(value ?? ''))) return matcher;
  }
  return null;
}

export function filterLiveUrlBlacklist<T extends LiveUrlBlacklistTarget>(
  entries: T[],
  matchers: LiveUrlBlacklistMatcher[],
): T[] {
  if (matchers.length === 0) return entries;
  return entries.filter((entry) => !matchLiveUrlBlacklist(entry, matchers));
}

export function addLiveUrlBlacklistRule(
  ruleSet: LiveUrlBlacklistRuleSet,
  raw: unknown,
): { ok: true; ruleSet: LiveUrlBlacklistRuleSet; rule: LiveUrlBlacklistRule } | { ok: false; error: string } {
  const checked = validateLiveUrlBlacklist([...ruleSet.rules, raw]);
  if (!checked.ok) return checked;
  const rule = checked.ruleSet.rules[checked.ruleSet.rules.length - 1];
  return { ok: true, ruleSet: checked.ruleSet, rule };
}

export function updateLiveUrlBlacklistRule(
  ruleSet: LiveUrlBlacklistRuleSet,
  id: string,
  patch: Partial<Pick<LiveUrlBlacklistRule, 'pattern' | 'field' | 'enabled' | 'note'>>,
): { ok: true; ruleSet: LiveUrlBlacklistRuleSet } | { ok: false; error: string } {
  const index = ruleSet.rules.findIndex((rule) => rule.id === id);
  if (index < 0) return { ok: false, error: '规则不存在' };
  const next = ruleSet.rules.map((rule) => rule.id === id
    ? { ...rule, ...patch, updatedAt: nowIso() }
    : rule);
  const checked = validateLiveUrlBlacklist(next);
  if (!checked.ok) return checked;
  return { ok: true, ruleSet: checked.ruleSet };
}
