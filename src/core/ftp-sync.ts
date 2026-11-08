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
  cd(dir: string): Promise<void>;
  uploadFrom(source: unknown, remotePath: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(path?: string): Promise<Array<{ name: string; type: number }>>;
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

export interface FtpDiagnoseResult extends FtpResult {
  pwd?: string;
  files?: string[];
  writable?: boolean;
  note?: string;
}

/**
 * 连接诊断：除了登录，还查「当前目录 / 目录内容 / 能否写入」。
 * 550 Access is denied 基本都是目标目录不可写或路径不存在，靠这个能直接定位。
 */
export async function testFtpConnection(cfg: FtpSyncConfig): Promise<FtpDiagnoseResult> {
  try {
    return await withClient(cfg, async (client) => {
      const pwd = await client.pwd();
      let files: string[] = [];
      try {
        const list = await client.list();
        files = list.slice(0, 30).map((f) => f.name);
      } catch {
        /* 部分服务端不允许 LIST，忽略 */
      }

      // 优先探测「真实目标文件路径」是否可写——登录根目录不可写不代表目标目录不可写
      let writable = false;
      let note = '';
      const target = cfg.remotePath || '/live.txt';
      const probePaths = [`${target}.probe`, '.tvbox-write-test'];

      for (const probe of probePaths) {
        try {
          await client.uploadFrom(makeStream('ok'), probe);
          writable = true;
          try { await client.remove(probe); } catch { /* ignore */ }
          break;
        } catch (err) {
          note = err instanceof Error ? err.message : String(err);
        }
      }

      return { ok: true, pwd, files, writable, note: note || undefined };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 覆盖上传；远端目录不存在会自动创建 */
export async function uploadLiveTxt(cfg: FtpSyncConfig, content: string): Promise<FtpResult> {
  if (!cfg.host || !cfg.user) return { ok: false, error: 'FTP 未配置' };

  const remote = cfg.remotePath || '/live.txt';
  const idx = remote.lastIndexOf('/');
  const dir = idx > 0 ? remote.slice(0, idx) : '';
  const file = idx >= 0 ? remote.slice(idx + 1) : remote;

  // 路径写法兼容：绝对路径 → 目录 + 文件名 → 直接放登录目录
  const attempts: Array<{ label: string; run: (c: FtpClientLike) => Promise<void> }> = [
    { label: `绝对路径 ${remote}`, run: (c) => c.uploadFrom(makeStream(content), remote) },
  ];
  if (dir) {
    attempts.push({
      label: `进入目录 ${dir} 后上传 ${file}`,
      run: async (c) => { await c.ensureDir(dir); await c.uploadFrom(makeStream(content), file); },
    });
  }
  attempts.push({
    label: `直接上传到登录目录 ${file}`,
    run: (c) => c.uploadFrom(makeStream(content), file),
  });

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      await withClient(cfg, attempt.run);
      return { ok: true, bytes: Buffer.byteLength(content, 'utf8') };
    } catch (err) {
      errors.push(`${attempt.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 全部失败：带上登录目录，方便判断是不是路径/权限问题
  let pwd = '';
  try {
    pwd = await withClient(cfg, (c) => c.pwd());
  } catch { /* ignore */ }
  return { ok: false, error: (pwd ? `登录目录 ${pwd}；` : '') + errors.join(' | ') };
}
