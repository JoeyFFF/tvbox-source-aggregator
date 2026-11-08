import type { Hono } from 'hono';
import type { Storage } from '../storage/interface';
import type { AppConfig, TVBoxLiveGroup } from '../core/types';
import { KV_CHANNEL_MERGED_TREE } from '../core/config';
import {
  addLiveUrlBlacklistRule,
  loadLiveUrlBlacklist,
  saveLiveUrlBlacklist,
  updateLiveUrlBlacklistRule,
  validateLiveUrlBlacklist,
} from '../core/live-url-blacklist';
import { validateRegexRule } from '../core/blacklist';
import { stripFailurePrefix } from '../core/channel-health';
import { liveUrlBlacklistHtml } from '../core/live-url-blacklist-ui';

function verifyAdmin(request: Request, config: AppConfig): boolean {
  const token = config.adminToken;
  if (!token) return false;
  return request.headers.get('Authorization') === `Bearer ${token}`;
}

export interface LiveUrlBlacklistRouteDeps {
  storage: Storage;
  config: AppConfig;
}

function liveValues(groups: TVBoxLiveGroup[], field: 'url' | 'source' | 'name' | 'group'): Array<{ value: string; group: string; name: string }> {
  const values: Array<{ value: string; group: string; name: string }> = [];
  for (const g of groups) {
    for (const ch of g.channels || []) {
      if (field === 'group') {
        values.push({ value: g.group || '', group: g.group || '', name: ch.name || '' });
        continue;
      }
      if (field === 'name') {
        values.push({ value: stripFailurePrefix(String(ch.name || '')), group: g.group || '', name: ch.name || '' });
        continue;
      }
      for (const raw of ch.urls || []) {
        const i = raw.lastIndexOf('$');
        const url = i > 0 ? raw.slice(0, i) : raw;
        if (field === 'url') values.push({ value: url, group: g.group || '', name: ch.name || '' });
        if (field === 'source') values.push({ value: i > 0 ? raw.slice(i + 1) : '', group: g.group || '', name: ch.name || '' });
      }
    }
  }
  return values;
}

export function mountLiveUrlBlacklistRoutes(app: Hono, deps: LiveUrlBlacklistRouteDeps): void {
  const { storage, config } = deps;

  app.get('/admin/live-url-blacklist', (c) => c.html(liveUrlBlacklistHtml));

  app.get('/admin/live-url-blacklist/rules', async (c) => {
    if (!verifyAdmin(c.req.raw, config)) return c.json({ error: 'Unauthorized' }, 401);
    const ruleSet = await loadLiveUrlBlacklist(storage);
    c.header('Cache-Control', 'no-store');
    return c.json({ ...ruleSet, fields: ['url', 'source', 'name', 'group'] });
  });

  app.post('/admin/live-url-blacklist/rules', async (c) => {
    if (!verifyAdmin(c.req.raw, config)) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json().catch(() => null);
    const current = await loadLiveUrlBlacklist(storage);
    const added = addLiveUrlBlacklistRule(current, body);
    if (!added.ok) return c.json({ error: added.error }, 400);
    await saveLiveUrlBlacklist(storage, added.ruleSet);
    return c.json({ success: true, rule: added.rule, count: added.ruleSet.rules.length });
  });

  app.post('/admin/live-url-blacklist/batch', async (c) => {
    if (!verifyAdmin(c.req.raw, config)) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json().catch(() => null);
    const rawRules = Array.isArray(body) ? body : body && Array.isArray(body.rules) ? body.rules : null;
    if (!rawRules) return c.json({ error: 'rules 必须是数组' }, 400);
    const current = await loadLiveUrlBlacklist(storage);
    const checked = validateLiveUrlBlacklist([...current.rules, ...rawRules]);
    if (!checked.ok) return c.json({ error: checked.error }, 400);
    await saveLiveUrlBlacklist(storage, checked.ruleSet);
    return c.json({ success: true, added: rawRules.length, count: checked.ruleSet.rules.length });
  });

  app.put('/admin/live-url-blacklist/rules/:id', async (c) => {
    if (!verifyAdmin(c.req.raw, config)) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json().catch(() => null);
    const current = await loadLiveUrlBlacklist(storage);
    const patch: Record<string, unknown> = {};
    if (body && typeof body === 'object') {
      for (const key of ['pattern', 'field', 'enabled', 'note']) {
        if (key in body) patch[key] = body[key];
      }
    }
    const updated = updateLiveUrlBlacklistRule(current, c.req.param('id'), patch);
    if (!updated.ok) return c.json({ error: updated.error }, 400);
    await saveLiveUrlBlacklist(storage, updated.ruleSet);
    return c.json({ success: true, count: updated.ruleSet.rules.length });
  });

  app.delete('/admin/live-url-blacklist/rules/:id', async (c) => {
    if (!verifyAdmin(c.req.raw, config)) return c.json({ error: 'Unauthorized' }, 401);
    const current = await loadLiveUrlBlacklist(storage);
    const next = { ...current, rules: current.rules.filter((rule) => rule.id !== c.req.param('id')) };
    if (next.rules.length === current.rules.length) return c.json({ error: '规则不存在' }, 404);
    await saveLiveUrlBlacklist(storage, next);
    return c.json({ success: true, count: next.rules.length });
  });

  app.post('/admin/live-url-blacklist/test', async (c) => {
    if (!verifyAdmin(c.req.raw, config)) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json().catch(() => null);
    const pattern = String(body?.pattern ?? '').trim();
    const field = body?.field === 'source' || body?.field === 'name' || body?.field === 'group' ? body.field : 'url';
    const checked = validateRegexRule(pattern);
    if (!checked.ok) return c.json({ error: checked.error }, 400);
    const raw = await storage.get(KV_CHANNEL_MERGED_TREE);
    if (!raw) return c.json({ error: '还没有合并树，请先 refresh' }, 404);
    let groups: TVBoxLiveGroup[];
    try { groups = JSON.parse(raw) as TVBoxLiveGroup[]; }
    catch { return c.json({ error: '合并树解析失败' }, 500); }
    let re: RegExp;
    try { re = new RegExp(pattern, 'i'); }
    catch (err) { return c.json({ error: `正则无效: ${err instanceof Error ? err.message : String(err)}` }, 400); }
    const values = liveValues(groups, field);
    const matched = values.filter((x) => re.test(x.value));
    const sample = matched.slice(0, 30).map((x) => {
      let host = '';
      try { host = new URL(x.value).host; } catch { /* value may be a name/source */ }
      return { group: x.group, name: x.name, host };
    });
    return c.json({ matched: matched.length, sample });
  });
}
