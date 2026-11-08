// FTP 对外发布：每次聚合完成后，把生成的 live.txt 覆盖上传到远端。
//
// 用途：把订阅地址发给别人——对方访问你的 FTP / 静态站点地址即可拿到最新源，
// 不需要暴露 NAS 端口，也不需要对方能访问你的局域网。
//
// 实现注意：basic-ftp 仅在 Node/Docker 环境可用，所以用 eval('require') 延迟加载，
// 避免打包器把它静态打进 CF / Android 产物（那边只会拿到「FTP 不可用」的报错）。
// 密码明文存在 KV，请使用专用的只写 FTP 账号。

import type { Storage } from '../storage/interface';
import { KV_FTP_SYNC } from './config';

export interface FtpSyncConfig {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
  remotePath: string;   // 远端文件路径，如 /wwwroot/live.txt
  secure: boolean;      // true = FTPS（显式 TLS）
  publicUrl: string;    // 仅用于后台展示：别人访问的地址
}

export const DEFAULT_FTP_CONFIG: FtpSyncConfig = {
  enabled: false,
  host: '',
  port: 21,
  user: '',
  password: '',
  remotePath: '/live.txt',
  secure: false,
  publicUrl: '',
};

export async function loadFtpConfig(storage: Storage): Promise<FtpSyncConfig> {
  const raw = await storage.get(KV_FTP_SYNC);
  if (!raw) return { ...DEFAULT_FTP_CONFIG };
  try {
    const p = JSON.parse(raw);
    return {
      enabled: !!p.enabled,
      host: typeof p.host === 'string' ? p.host.trim() : '',
      port: Number(p.port) > 0 ? Number(p.port) : 21,
      user: typeof p.user === 'string' ? p.user : '',
      password: typeof p.password === 'string' ? p.password : '',
      remotePath: typeof p.remotePath === 'string' && p.remotePath ? p.remotePath : '/live.txt',
      secure: !!p.secure,
      publicUrl: typeof p.publicUrl === 'string' ? p.publicUrl.trim() : '',
    };
  } catch {
    return { ...DEFAULT_FTP_CONFIG };
  }
}

export async function saveFtpConfig(storage: Storage, cfg: FtpSyncConfig): Promise<void> {
  await storage.put(KV_FTP_SYNC, JSON.stringify(cfg));
}

interface FtpClientLike {
  access(opts: Record<string, unknown>): Promise<void>;
  ensureDir(dir: string): Promise<void>;
  uploadFrom(source: unknown, remotePath: string): Promise<void>;
  pwd(): Promise<string>;
  close(): void;
}

function createClient(): FtpClientLike | null {
  try {
    // eval 阻断打包器静态解析，保证 CF / APK 构建不受影响
    // eslint-disable-next-line no-eval
    const req = eval('require') as NodeRequire;
    const mod = req('basic-ftp') as { Client: new (timeout?: number) => FtpClientLike };
    return new mod.Client(15000);
  } catch {
    return null;
  }
}

function makeStream(content: string): unknown {
  // eslint-disable-next-line no-eval
  const req = eval('require') as NodeRequire;
  const { Readable } = req('node:stream') as typeof import('node:stream');
  return Readable.from([Buffer.from(content, 'utf8')]);
}

export interface FtpResult {
  ok: boolean;
  bytes?: number;
  error?: string;
}

async function withClient<T>(cfg: FtpSyncConfig, fn: (c: FtpClientLike) => Promise<T>): Promise<T> {
  const client = createClient();
  if (!client) throw new Error('当前环境不支持 FTP（仅 Node/Docker 可用）');
  try {
    await client.access({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      secure: cfg.secure,
    });
    return await fn(client);
  } finally {
    client.close();
  }
}

export async function testFtpConnection(cfg: FtpSyncConfig): Promise<FtpResult> {
  try {
    const pwd = await withClient(cfg, (c) => c.pwd());
    return { ok: true, bytes: pwd.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 覆盖上传；远端目录不存在会自动创建 */
export async function uploadLiveTxt(cfg: FtpSyncConfig, content: string): Promise<FtpResult> {
  if (!cfg.host || !cfg.user) return { ok: false, error: 'FTP 未配置' };

  try {
    await withClient(cfg, async (client) => {
      const remote = cfg.remotePath || '/live.txt';
      const idx = remote.lastIndexOf('/');
      const dir = idx > 0 ? remote.slice(0, idx) : '';
      const file = idx >= 0 ? remote.slice(idx + 1) : remote;

      if (dir) {
        // ensureDir 会把工作目录切到目标目录，随后用文件名上传即可
        await client.ensureDir(dir);
      }
      await client.uploadFrom(makeStream(content), file);
    });
    return { ok: true, bytes: Buffer.byteLength(content, 'utf8') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
