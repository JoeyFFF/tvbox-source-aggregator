// 频道排序 admin 路由（分类内拖动排序 + 央视一键智能排序）
//
// 数据源用「当前输出配置」而不是原始频道树：死链清理已经生效，
// 用户在后台看到的列表和电视上看到的列表是同一份。

import type { Hono } from 'hono';
import type { Storage } from '../storage/interface';
import type { AppConfig, TVBoxLiveGroup } from '../core/types';
import { KV_MERGED_CONFIG } from '../core/config';
import {
  loadChannelOrder,
  saveChannelOrder,
  smartSortCctv,
  type ChannelOrderConfig,
} from '../core/live-order';

function verifyAdmin(request: Request, config: AppConfig): boolean {
  const token = config.adminToken;
  if (!token) return false;
  return request.headers.get('Authorization') === `Bearer ${token}`;
}

export interface ChannelOrderRouteDeps {
  storage: Storage;
  config: AppConfig;
  triggerRefresh?: () => Promise<void>;
}

function isNativeGroups(lives: unknown): lives is TVBoxLiveGroup[] {
  if (!Array.isArray(lives) || lives.length === 0) return false;
  return lives.every((g) => g && typeof g === 'object'
    && typeof (g as TVBoxLiveGroup).group === 'string'
    && Array.isArray((g as TVBoxLiveGroup).channels));
}

export function mountChannelOrderRoutes(app: Hono, deps: ChannelOrderRouteDeps): void {
  const { storage, config, triggerRefresh } = deps;

  async function readGroups(): Promise<TVBoxLiveGroup[]> {
    const raw = await storage.get(KV_MERGED_CONFIG);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return isNativeGroups(parsed.lives) ? parsed.lives : [];
    } catch {
      return [];
    }
  }

  // GET /admin/channel-order — 当前分组与频道（按生效顺序）
  app.get('/admin/channel-order', async (c) => {
    if (!verifyAdmin(c.req.raw, config)) return c.json({ error: 'Unauthorized' }, 401);

    const [groups, saved] = await Promise.all([readGroups(), loadChannelOrder(storage)]);
    return c.json({
      groups: groups.map((g) => ({
        group: g.group,
        count: g.channels.length,
        channels: g.channels.map((ch) => ({ name: ch.name, urls: ch.urls.length })),
      })),
      saved,
    });
  });

  // PUT /admin/channel-order — 保存手动顺序 { groups: { 分组: [频道名...] } }
  app.put('/admin/channel-order', async (c) => {
    if (!verifyAdmin(c.req.raw, config)) return c.json({ error: 'Unauthorized' }, 401);

    let body: { groups?: Record<string, string[]> };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }
    if (!body.groups || typeof body.groups !== 'object') {
      return c.json({ error: 'groups is required' }, 400);
    }

    const current = await loadChannelOrder(storage);
    const next: ChannelOrderConfig = {
      groups: { ...current.groups },
      moves: { ...current.moves },
    };
    for (const [group, order] of Object.entries(body.groups)) {
      if (!Array.isArray(order)) continue;
      next.groups[group] = order.filter((n): n is string => typeof n === 'string');
    }

    await saveChannelOrder(storage, next);
    if (triggerRefresh) triggerRefresh().catch(() => {});
    return c.json({ success: true, groups: Object.keys(next.groups).length });
  });

  // POST /admin/channel-order/smart — 央视分组一键智能排序
  app.post('/admin/channel-order/smart', async (c) => {
    if (!verifyAdmin(c.req.raw, config)) return c.json({ error: 'Unauthorized' }, 401);

    const groups = await readGroups();
    if (groups.length === 0) return c.json({ error: 'No live config yet, run a refresh first' }, 400);

    const result = smartSortCctv(groups);
    if (result.order.length === 0) {
      return c.json({ error: 'CCTV group not found' }, 404);
    }

    const current = await loadChannelOrder(storage);
    const next: ChannelOrderConfig = {
      groups: { ...current.groups, 央视: result.order },
      moves: { ...current.moves, ...result.moves },
    };
    await saveChannelOrder(storage, next);
    if (triggerRefresh) triggerRefresh().catch(() => {});

    return c.json({
      success: true,
      kept: result.keptCount,
      movedOut: result.movedOut,
      order: result.order,
    });
  });

  // DELETE /admin/channel-order — 清空自定义顺序与移动规则
  app.delete('/admin/channel-order', async (c) => {
    if (!verifyAdmin(c.req.raw, config)) return c.json({ error: 'Unauthorized' }, 401);

    await saveChannelOrder(storage, { groups: {}, moves: {} });
    if (triggerRefresh) triggerRefresh().catch(() => {});
    return c.json({ success: true });
  });
}
