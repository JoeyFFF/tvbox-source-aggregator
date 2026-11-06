// GitHub Release ZIP 源（仅 Node.js 模式）
//
// 有些 TVBox 订阅（PG / ZX）并不发布 raw JSON，而是把配置、JAR 和
// 相对路径资源打包成 GitHub Release 的 ZIP。这里负责：
// 1. 通过 GitHub API 找到 latest release 的 ZIP 资产；
// 2. 下载并解压到 DATA_DIR/zip/<key>/；
// 3. 找到根目录的配置 JSON；
// 4. 把配置里的 ./ 引用改写成 {{BASE_URL}}/zip/<key>/...，
//    由 /zip/:key/* 路由提供 JAR 和其他相对资源。

import { unzipSync } from 'fflate';
import { BASE_URL_PLACEHOLDER } from './config';

const GITHUB_API = 'https://api.github.com';
const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 400 * 1024 * 1024;

export interface PreparedZipSource {
  text: string;
  key: string;
  assetName: string;
  releaseTag: string;
  speedMs: number;
}

export function isGitHubReleaseSource(url: string): boolean {
  return /^gh-release:\/\/[^/]+\/[^/]+$/i.test(url);
}

function parseRepo(url: string): { owner: string; repo: string } {
  const match = url.match(/^gh-release:\/\/([^/]+)\/([^/]+)$/i);
  if (!match) throw new Error('Invalid gh-release URL');
  return { owner: match[1], repo: match[2] };
}

async function sha256Hex(text: string, length = 16): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, length);
}

function dataDir(): string {
  // 只在 Node 分支调用；require 放在函数内部，避免 CF 打包时静态解析
  const path = require('path');
  return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
}

/**
 * 下载并展开一个 GitHub Release ZIP 源。
 * 返回改写后的配置文本（相对路径已指向 /zip/<key>/）。
 */
export async function prepareGitHubReleaseSource(url: string): Promise<PreparedZipSource> {
  if (typeof process === 'undefined' || !process.versions?.node) {
    throw new Error('ZIP sources are only supported in Node.js mode');
  }

  const fs = require('fs');
  const path = require('path');
  const startedAt = Date.now();
  const { owner, repo } = parseRepo(url);

  // 1. 解析 latest release
  const releaseResp = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/releases/latest`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'okhttp/3.12.0',
    },
    signal: AbortSignal.timeout(180_000),
  });
  if (!releaseResp.ok) {
    throw new Error(`GitHub release HTTP ${releaseResp.status}`);
  }
  const release = await releaseResp.json() as {
    tag_name?: string;
    assets?: Array<{ name: string; browser_download_url: string; size?: number }>;
  };
  const zipAssets = (release.assets || []).filter((asset) => asset.name.toLowerCase().endsWith('.zip'));
  if (zipAssets.length === 0) {
    throw new Error('No ZIP asset in latest release');
  }
  const asset = zipAssets[0];
  if (asset.size && asset.size > MAX_ZIP_BYTES) {
    throw new Error(`ZIP asset too large: ${asset.size}`);
  }

  const key = await sha256Hex(`${owner}/${repo}`);
  const zipRoot = path.join(dataDir(), 'zip');
  const root = path.join(zipRoot, key);
  const base = `${BASE_URL_PLACEHOLDER}/zip/${key}`;
  const metaPath = path.join(root, '.source.json');

  // 同一个 release 已展开过 → 直接复用磁盘上的文件，避免每天重复下载 60–90MB
  try {
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
        tag?: string;
        asset?: string;
        configName?: string;
      };
      if (meta.tag === (release.tag_name || '') && meta.asset === asset.name && meta.configName) {
        const configPath = path.join(root, meta.configName);
        if (fs.existsSync(configPath)) {
          const text = fs.readFileSync(configPath, 'utf8').replaceAll('./', `${base}/`);
          console.log(`[zip-source] ${owner}/${repo} ${release.tag_name || ''} cached (${meta.configName})`);
          return {
            text,
            key,
            assetName: asset.name,
            releaseTag: release.tag_name || '',
            speedMs: Date.now() - startedAt,
          };
        }
      }
    }
  } catch {
    // 元数据损坏则重新下载
  }

  // 2. 下载 ZIP
  const zipResp = await fetch(asset.browser_download_url, {
    headers: { 'User-Agent': 'okhttp/3.12.0' },
    signal: AbortSignal.timeout(180_000),
  });
  if (!zipResp.ok) {
    throw new Error(`ZIP download HTTP ${zipResp.status}`);
  }
  const zipBytes = new Uint8Array(await zipResp.arrayBuffer());
  if (zipBytes.length > MAX_ZIP_BYTES) {
    throw new Error(`ZIP too large: ${zipBytes.length}`);
  }

  // 3. 解压到临时目录，成功后原子替换
  const entries = unzipSync(zipBytes);
  const temp = `${root}.tmp-${Date.now()}`;
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(temp, { recursive: true });

  let total = 0;
  try {
    for (const [name, data] of Object.entries(entries)) {
      if (!name || name.endsWith('/')) continue;
      const rel = name.replace(/\\/g, '/');
      if (rel.startsWith('/') || rel.includes('\0')) continue;
      const dest = path.resolve(temp, rel);
      if (!dest.startsWith(temp + path.sep)) continue; // zip-slip
      total += data.length;
      if (total > MAX_UNZIPPED_BYTES) {
        throw new Error('ZIP uncompressed size too large');
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(data));
    }

    // 4. 找根目录配置：优先已知文件名，否则找含 sites 的根 JSON
    const preferred = ['jsm.json', 'FongMi.json', 'config.json', 'tvbox.json'];
    let configName = preferred.find((name) => entries[name] && entries[name].length > 0);
    if (!configName) {
      const candidates = Object.keys(entries).filter(
        (name) => !name.includes('/') && /\.json$/i.test(name) && entries[name].length > 0,
      );
      for (const name of candidates) {
        const text = new TextDecoder('utf-8').decode(entries[name]);
        if (text.includes('"sites"')) {
          configName = name;
          break;
        }
      }
    }
    if (!configName) {
      throw new Error('No TVBox config JSON found in ZIP');
    }

    const configText = new TextDecoder('utf-8').decode(entries[configName]);
    // 与 4567 的 loadLocalConfigJson 一样，把所有 ./ 引用指向 ZIP 资源根
    const base = `${BASE_URL_PLACEHOLDER}/zip/${key}`;
    const text = configText.replaceAll('./', `${base}/`);

    fs.writeFileSync(
      path.join(temp, '.source.json'),
      JSON.stringify({ tag: release.tag_name || '', asset: asset.name, configName, cachedAt: Date.now() }),
    );
    fs.rmSync(root, { recursive: true, force: true });
    fs.renameSync(temp, root);

    console.log(`[zip-source] ${owner}/${repo} ${release.tag_name || ''} ${asset.name} -> ${key} (${configName}, ${total} bytes)`);
    return {
      text,
      key,
      assetName: asset.name,
      releaseTag: release.tag_name || '',
      speedMs: Date.now() - startedAt,
    };
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}
