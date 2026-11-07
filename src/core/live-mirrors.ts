// GitHub Raw 直播列表镜像：逻辑身份与下载地址分离，直连优先，保留可用回退。

const RAW_HOST = 'raw.githubusercontent.com';

// 仅列出能够明确拆出嵌套 Raw 地址的代理；未知的代理/普通路径原样保留。
const KNOWN_PROXY_HOSTS = new Set([
  'ghfast.top', 'down.nigx.cn', 'gh-proxy.com', 'gh-proxy.org',
  'gh.llkk.cc', 'ghproxy.net', 'ghproxy.cn', 'gh-proxy.net', 'ghfast.com',
]);

export function normalizeLiveInputUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try { return new URL(trimmed).href; } catch { /* 交给输入校验处理 */ }
  }
  return trimmed;
}

export function githubRawLiveIdentity(raw: string): string | null {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (host === RAW_HOST) return `https://${RAW_HOST}${parsed.pathname}${parsed.search}`;
  if (!KNOWN_PROXY_HOSTS.has(host) || parsed.username || parsed.password) return null;

  let embedded: string;
  try { embedded = decodeURIComponent(parsed.pathname); } catch { return null; }
  embedded = embedded.replace(/^\/+/, '');
  if (!/^https?:\/\/raw\.githubusercontent\.com\//i.test(embedded)
      && !/^raw\.githubusercontent\.com\//i.test(embedded)) return null;
  const inner = new URL(embedded.startsWith('http') ? embedded : `https://${embedded}`);
  if (inner.hostname.toLowerCase() !== RAW_HOST || inner.username || inner.password) return null;
  return `https://${RAW_HOST}${inner.pathname}${parsed.search}${inner.search}`;
}

export interface LiveMirrorGroup<T = unknown> {
  primary: T;
  // 同一逻辑文件备用候选，含原始UA/header，不能丢弃或重复汇入。
  fallbacks: T[];
}

/**
 * 精确URL已经去重后调用；直连排在镜像之前。
 * 只把声明具有相同请求上下文的入口放在一起，避免复用错误鉴权。
 */
export function groupLiveSourceMirrors<T extends { url: string; ua?: string; header?: Record<string, string> }>(
  inputs: readonly T[],
): LiveMirrorGroup<T>[] {
  const groups = new Map<string, { identity: string; candidates: T[] }>();
  for (const input of inputs) {
    const url = normalizeLiveInputUrl(input.url);
    if (!/^https?:\/\//i.test(url)) continue;
    const normalized = { ...input, url };
    // 没有显式UA/header的普通Raw声明共享同一上下文；其他请求独立保留。
    const context = JSON.stringify([input.ua || '', input.header || {}]);
    const identity = githubRawLiveIdentity(url);
    const logical = identity ?? `url:${url}`;
    const key = identity ? `${identity}\0${context}` : logical;
    const group: { identity: string; candidates: T[] } = groups.get(key) ?? { identity: logical, candidates: [] };
    group.candidates.push(normalized);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map(({ identity, candidates }) => {
    const ordered = candidates.slice().sort((a, b) =>
      Number(a.url.toLowerCase().startsWith(`https://${RAW_HOST}/`) ? 0 : 1)
      - Number(b.url.toLowerCase().startsWith(`https://${RAW_HOST}/`) ? 0 : 1));
    // 即使配置只给了代理地址，也先尝试同请求上下文的 GitHub 直连。
    if (identity.startsWith(`https://${RAW_HOST}/`)
        && !ordered.some(c => c.url.toLowerCase().startsWith(`https://${RAW_HOST}/`))) {
      return { primary: { ...ordered[0], url: identity }, fallbacks: ordered };
    }
    return { primary: ordered[0], fallbacks: ordered.slice(1) };
  });
}

/** TVBox 在第一个 $ 处拆地址/名称；探活、去重必须与其一致，不能改删查询参数。 */
export function cleanPlaybackUrl(raw: string): string {
  return String(raw || '').split('$', 1)[0].trim();
}
