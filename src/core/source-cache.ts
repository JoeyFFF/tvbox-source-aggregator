// 单源 last-good 配置缓存
//
// 现有聚合器只缓存整份 merged config：所有源都失败时保留上一版；
// 单个源失败时，它的站点会在下一次合并中消失。
// 这里按源 URL 缓存最后一次成功解析出的配置，抓取失败时用它顶替，
// 让 fty4 这类偶发超时的源仍能保持直连。

import type { Storage } from '../storage/interface';
import type { SourceFetchResult, SourcedConfig, TVBoxConfig } from './types';

const CACHE_PREFIX = 'source_cache:';

/** 最后一次成功配置最多保留 7 天；超过后不再拿旧配置顶替失败源。 */
export const SOURCE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedSourceRecord {
  url: string;
  name: string;
  cachedAt: number;
  config: TVBoxConfig;
}

async function cacheKey(url: string): Promise<string> {
  const bytes = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return CACHE_PREFIX + hex;
}

/** 每次成功抓取后保存该源的解析结果。 */
export async function saveSourceCaches(storage: Storage, configs: SourcedConfig[]): Promise<number> {
  let saved = 0;

  for (const sourced of configs) {
    if (!sourced.sourceUrl || sourced.sourceUrl.startsWith('inline://')) continue;

    const record: CachedSourceRecord = {
      url: sourced.sourceUrl,
      name: sourced.sourceName,
      cachedAt: Date.now(),
      config: sourced.config,
    };

    try {
      await storage.put(await cacheKey(sourced.sourceUrl), JSON.stringify(record));
      saved++;
    } catch (error) {
      console.warn('[source-cache] save failed:', sourced.sourceUrl, error);
    }
  }

  return saved;
}

export interface SourceCacheHit {
  url: string;
  name: string;
  ageMs: number;
}

/**
 * 对抓取失败的源，用最后一次成功配置顶替。
 * 只处理单仓 / 多仓叶子配置；多仓索引本身失败时没有叶子缓存可用。
 */
export async function restoreSourceCaches(
  storage: Storage,
  fetchResults: SourceFetchResult[],
  succeededUrls: Set<string>,
): Promise<{ configs: SourcedConfig[]; hits: SourceCacheHit[] }> {
  const configs: SourcedConfig[] = [];
  const hits: SourceCacheHit[] = [];

  for (const result of fetchResults) {
    if (result.status === 'ok' || succeededUrls.has(result.url)) continue;
    if (!result.url || result.url.startsWith('inline://')) continue;

    try {
      const raw = await storage.get(await cacheKey(result.url));
      if (!raw) continue;

      const record = JSON.parse(raw) as CachedSourceRecord;
      if (!record || record.url !== result.url || !record.config) continue;

      const ageMs = Date.now() - record.cachedAt;
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > SOURCE_CACHE_TTL_MS) continue;

      configs.push({
        sourceUrl: result.url,
        sourceName: result.name || record.name,
        config: record.config,
      });

      const ageHours = Math.round(ageMs / 3_600_000);
      result.errorMessage = `${result.errorMessage || result.status}；已使用 ${ageHours} 小时前的缓存`;
      hits.push({ url: result.url, name: result.name || record.name, ageMs });
    } catch (error) {
      console.warn('[source-cache] load failed:', result.url, error);
    }
  }

  return { configs, hits };
}
