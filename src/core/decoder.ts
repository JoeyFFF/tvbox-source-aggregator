// TVBox 配置解码器
// 移植自安卓端 ApiConfig.FindResult() + AES.java
// 支持三种编码格式：图片伪装 + Base64、AES CBC 自解密、AES ECB 外部密钥

/**
 * 解码配置响应，自动检测格式
 * @param buffer 原始响应数据
 * @param configKey 可选的 AES ECB 外部密钥（来自 URL 的 ;pk; 后缀）
 * @returns 解码后的文本，或 null
 */
export async function decodeConfigResponse(
  buffer: ArrayBuffer,
  configKey?: string,
): Promise<string | null> {
  // 先用 UTF-8 解码（保留中文等多字节字符）
  const utf8Text = new TextDecoder('utf-8').decode(buffer);

  // 已经是 JSON → 直接返回 UTF-8 文本（保留中文）
  if (isJson(utf8Text)) {
    return utf8Text;
  }

  // 非 JSON → 用 Latin-1 解码保留所有字节（用于二进制标记检测）
  const text = new TextDecoder('latin1').decode(buffer);

  // AES 分支只接受纯 hex/Base64；去掉响应里可能带的换行和空格。
  // 4567 的 convertResult 会先把 \r/\n 换成空格，toBytes 再按整除丢弃尾部，
  // 这里显式去掉全部空白，效果一致且不会让尾部换行参与 length 计算。
  const compact = text.replace(/\s+/g, '');

  // 格式 1：图片伪装 + Base64（[A-Za-z0]{8}** 标记）
  const imageDecoded = decodeImageWrapped(text);
  if (imageDecoded !== null) {
    console.log('[decoder] Decoded image-wrapped base64 config');
    return imageDecoded;
  }

  // 格式 2：AES CBC 自解密（2423 前缀）
  if (compact.startsWith('2423')) {
    try {
      const cbcResult = await decryptAesCbc(compact);
      if (cbcResult !== null) {
        console.log('[decoder] Decoded AES CBC config');
        return cbcResult;
      }
    } catch (e) {
      console.warn('[decoder] AES CBC decryption failed:', e);
    }
  }

  // 格式 3：AES ECB 外部密钥
  if (configKey && !isJson(text)) {
    try {
      const ecbResult = await decryptAesEcb(compact, configKey);
      if (ecbResult !== null) {
        console.log('[decoder] Decoded AES ECB config');
        return ecbResult;
      }
    } catch (e) {
      console.warn('[decoder] AES ECB decryption failed:', e);
    }
  }

  // 都不匹配 → 返回 UTF-8 原文（可能是非标 JSON，让 parseConfigJson 处理）
  return utf8Text;
}

/**
 * 检测并解码图片伪装格式
 * 图片数据后有 [A-Za-z0]{8}** 标记，标记后 10 字符为 base64 数据
 */
function decodeImageWrapped(text: string): string | null {
  // 移植自 ApiConfig.FindResult(): Pattern.compile("[A-Za-z0]{8}\\*\\*")
  // 客户端实际源里会出现数字 1（如 SWKYkz1W**），不能只允许数字 0。
  const marker = /[A-Za-z0-9]{8}\*\*/;
  const match = marker.exec(text);
  if (!match) return null;

  // 标记本身 10 字符（8 字符 + "**"），跳过标记取后面的 base64。
  // 有些源站会把 base64 按行折行，先去掉所有空白再解码。
  const base64Start = match.index + 10;
  const base64Data = text.substring(base64Start).replace(/\s+/g, '');
  if (!base64Data) return null;

  try {
    return base64Decode(base64Data);
  } catch {
    return null;
  }
}

/**
 * AES CBC 自解密（2423 格式）
 * 移植自 ApiConfig.FindResult() + AES.CBC()
 *
 * 数据结构：
 * - 整体是 hex 字符串，以 "2423"（"$#" 的 hex）开头
 * - hex → 字符串后：
 *   - "$#" 和 "#$" 之间是 key
 *   - 最后 13 个字符是 iv
 *   - "#$" 之后到倒数第 26 字符是密文（hex 编码）
 * - key 和 iv 都右补 "0" 到 16 位
 */
async function decryptAesCbc(hexContent: string): Promise<string | null> {
  // 提取密文数据：从 "2324"（"#$" 的 hex）之后到倒数 26 字符
  const separatorIndex = hexContent.indexOf('2324');
  if (separatorIndex === -1) return null;
  const data = hexContent.substring(separatorIndex + 4, hexContent.length - 26);

  // hex → 字符串，提取 key 和 iv
  const fullStr = hexToString(hexContent).toLowerCase();
  const keyStart = fullStr.indexOf('$#');
  const keyEnd = fullStr.indexOf('#$');
  if (keyStart === -1 || keyEnd === -1) return null;

  const key = rightPadding(fullStr.substring(keyStart + 2, keyEnd), '0', 16);
  const iv = rightPadding(fullStr.substring(fullStr.length - 13), '0', 16);

  // 密文 hex → bytes
  const cipherBytes = hexToBytes(data);
  const keyBytes = new TextEncoder().encode(key);
  const ivBytes = new TextEncoder().encode(iv);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt'],
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: ivBytes }, cryptoKey, cipherBytes,
  );

  return new TextDecoder('utf-8').decode(decrypted);
}

/**
 * AES ECB 解密（外部密钥）
 * 移植自 AES.ECB()
 *
 * Web Crypto API 不支持 ECB，用逐块 CBC（zero IV）模拟
 */
async function decryptAesEcb(hexContent: string, key: string): Promise<string | null> {
  const paddedKey = rightPadding(key, '0', 16);
  const cipherBytes = hexToBytes(hexContent);
  const keyBytes = new TextEncoder().encode(paddedKey);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt'],
  );

  const zeroIv = new Uint8Array(16);
  const blocks: Uint8Array[] = [];

  // 逐块解密：ECB 每块独立，等价于 CBC + zero IV 不链接
  for (let i = 0; i < cipherBytes.length; i += 16) {
    const block = cipherBytes.slice(i, i + 16);
    // 单块 CBC 解密需要 block + 填充块以满足 PKCS7
    // 但最后一块可能包含 PKCS7 padding，所以需要特殊处理
    if (i + 16 < cipherBytes.length) {
      // 非最后一块：追加一个全 16 的 padding 块让 Web Crypto 能去除 padding
      const paddedBlock = new Uint8Array(32);
      paddedBlock.set(block, 0);
      // PKCS7 padding block: 16 bytes of 0x10
      for (let j = 16; j < 32; j++) paddedBlock[j] = 16;
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: zeroIv }, cryptoKey, paddedBlock,
      );
      blocks.push(new Uint8Array(decrypted));
    } else {
      // 最后一块：包含原始 PKCS7 padding，Web Crypto 自动去除
      // 需要确保至少有一个完整块供 decrypt 处理
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: zeroIv }, cryptoKey, block,
      );
      blocks.push(new Uint8Array(decrypted));
    }
  }

  const totalLength = blocks.reduce((sum, b) => sum + b.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of blocks) {
    result.set(b, offset);
    offset += b.length;
  }

  return new TextDecoder('utf-8').decode(result);
}

// ---- 工具函数 ----

/**
 * 右填充字符串
 * 移植自 AES.rightPadding()
 */
function rightPadding(str: string, pad: string, length: number): string {
  // 与 4567 的 rightPadding 一致：先 trim，避免响应尾部的 \n/\r 被当成
  // key/iv 的一部分（nf 的 2423 载荷就是尾部带换行）。
  let result = str.trim();
  while (result.length < length) {
    result += pad;
  }
  return result.substring(0, length);
}

/**
 * Hex 字符串 → Uint8Array
 * 移植自 AES.toBytes()
 */
function hexToBytes(hex: string): Uint8Array {
  // 与 4567 的 toBytes 一致：按 length/2 向下取整，奇数长度时丢弃最后一个
  // 不完整的 hex 字符；调用方已去掉空白，这里再兜底。
  const length = Math.floor(hex.length / 2);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const byte = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    bytes[i] = Number.isNaN(byte) ? 0 : byte;
  }
  return bytes;
}

/**
 * Hex 字符串 → 普通字符串（每 2 个 hex 字符 → 1 个 char）
 */
function hexToString(hex: string): string {
  // 与 hexToBytes 一致，奇数长度时不把最后一个不完整字符转成 \u0000。
  let str = '';
  const length = Math.floor(hex.length / 2);
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(parseInt(hex.substring(i * 2, i * 2 + 2), 16));
  }
  return str;
}

/**
 * 检查文本是否为 JSON
 */
function isJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * 跨平台 Base64 解码
 * CF Worker 有 atob()，Node.js 用 Buffer
 */
function base64Decode(data: string): string {
  if (typeof atob === 'function') {
    // CF Worker / 浏览器环境
    const binary = atob(data);
    // 用 TextDecoder 处理 UTF-8 多字节字符
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  }
  // Node.js 环境
  return Buffer.from(data, 'base64').toString('utf-8');
}
