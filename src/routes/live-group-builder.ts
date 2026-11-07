import type { Hono } from 'hono';
import type { Storage } from '../storage/interface';
import type { AppConfig } from '../core/types';
import {
  KV_LIVE_GROUP_RULES,
  KV_LIVE_GROUP_SNAPSHOT,
  createLiveGroupRuleMatcher,
  filterLiveGroupDecision,
  parseLiveGroupRules,
  previewLiveGroupSnapshot,
  validateLiveGroupRules,
  type LiveGroupSnapshot,
} from '../core/live-group-rules';
import { DEFAULT_BUILTIN_RULES, compileBuiltinRules, provinceOfGroup } from '../core/live-group-defaults';
import { resolveLiveGroup } from '../core/live-merger';
import { liveGroupBuilderHtml } from '../core/live-group-builder-ui';

function verifyAdmin(request: Request, config: AppConfig): boolean {
  const token = config.adminToken;
  if (!token) return false;
  const auth = request.headers.get('Authorization');
  return auth === `Bearer ${token}`;
}

export interface LiveGroupBuilderRouteDeps {
  storage: Storage;
  config: AppConfig;
}

export function mountLiveGroupBuilderRoutes(app: Hono, deps: LiveGroupBuilderRouteDeps): void {
  const { storage, config } = deps;

  // GET /group-builder — 页面
  app.get('/group-builder', (c) => c.html(liveGroupBuilderHtml));

  // GET /admin/live-group-rules — 当前规则
  app.get('/admin/live-group-rules', async (c) => {
    if (!verifyAdmin(c.req.raw, config)) return c.json({ error: 'Unauthorized' }, 401);
    const ruleSet = parseLiveGroupRules(await storage.get(KV_LIVE_GROUP_RULES));
    c.header('Cache-Control', 'no-store');
    return c.json({ ...ruleSet, builtinDefaults: DEFAULT_BUILTIN_RULES });
  });

  // PUT /admin/live-group-rules — 保存规则；下次 refresh 生效，不需要重启
  app.put('/admin/live-group-rules', async (c) => {
    if (!verifyAdmin(c.req.raw, config)) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json().catch(() => null);
    const checked = validateLiveGroupRules(body);
    if (!checked.ok) return c.json({ error: checked.error }, 400);
    await storage.put(KV_LIVE_GROUP_RULES, JSON.stringify(checked.ruleSet));
    return c.json({ success: true, ruleSet: checked.ruleSet });
  });

  // GET /admin/live-group-snapshot — 上次合并的源组/频道快照
  app.get('/admin/live-group-snapshot', async (c) => {
    if (!verifyAdmin(c.req.raw, config)) return c.json({ error: 'Unauthorized' }, 401);
    const raw = await storage.get(KV_LIVE_GROUP_SNAPSHOT);
    if (!raw) return c.json({ error: '还没有快照，请先触发一次 refresh' }, 404);
    try {
      const snapshot = JSON.parse(raw) as LiveGroupSnapshot;
      c.header('Cache-Control', 'no-store');
      return c.json(snapshot);
    } catch {
      return c.json({ error: '快照解析失败' }, 500);
    }
  });

  // POST /admin/live-group-preview — 用提交的规则对快照做预演
  app.post('/admin/live-group-preview', async (c) => {
    if (!verifyAdmin(c.req.raw, config)) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json().catch(() => null);
    const checked = validateLiveGroupRules(body);
    if (!checked.ok) return c.json({ error: checked.error }, 400);
    const raw = await storage.get(KV_LIVE_GROUP_SNAPSHOT);
    if (!raw) return c.json({ error: '还没有快照，请先触发一次 refresh' }, 404);
    let snapshot: LiveGroupSnapshot;
    try {
      snapshot = JSON.parse(raw) as LiveGroupSnapshot;
    } catch {
      return c.json({ error: '快照解析失败' }, 500);
    }
    const builtin = compileBuiltinRules(checked.ruleSet.builtin || DEFAULT_BUILTIN_RULES);
    const useBuiltin = checked.ruleSet.useBuiltin !== false;
    const provinceOf = (group: string) => provinceOfGroup(group, builtin);
    const matcher = createLiveGroupRuleMatcher(checked.ruleSet, provinceOf);
    const targetFilter = new Set(checked.ruleSet.filterTargets || []);
    const preview = previewLiveGroupSnapshot(
      snapshot,
      (group, name) => filterLiveGroupDecision(resolveLiveGroup(group, name, matcher, builtin, useBuiltin), targetFilter),
      provinceOf,
      checked.ruleSet,
    );
    return c.json({ success: true, preview });
  });
}
