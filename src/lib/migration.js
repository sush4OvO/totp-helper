import { encodeBase32 } from './base32.js';
import { normalizeAlgorithm } from './totp.js';
import { isMigrationUri } from './otpauth.js';

const ALGORITHMS = {
  0: 'SHA1',
  1: 'SHA1',
  2: 'SHA256',
  3: 'SHA512',
};

const DIGITS = {
  0: 6,
  1: 6,
  2: 8,
};

function cleanText(value, maxLength = 120) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function decodeBase64Url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('迁移数据不是有效的 Base64 编码');
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function readVarint(bytes, state) {
  let result = 0;
  let shift = 0;

  for (;;) {
    if (state.pos >= bytes.length) {
      throw new Error('迁移数据不完整');
    }
    const byte = bytes[state.pos];
    state.pos += 1;
    result += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) {
      return result;
    }
    shift += 7;
    if (shift > 49) {
      throw new Error('迁移数据格式不正确');
    }
  }
}

function readMessage(bytes) {
  const state = { pos: 0 };
  const fields = new Map();

  while (state.pos < bytes.length) {
    const tag = readVarint(bytes, state);
    const field = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (field === 0) {
      throw new Error('迁移数据格式不正确');
    }

    let value;
    if (wireType === 0) {
      value = readVarint(bytes, state);
    } else if (wireType === 2) {
      const length = readVarint(bytes, state);
      if (state.pos + length > bytes.length) {
        throw new Error('迁移数据不完整');
      }
      value = bytes.subarray(state.pos, state.pos + length);
      state.pos += length;
    } else if (wireType === 1) {
      if (state.pos + 8 > bytes.length) {
        throw new Error('迁移数据不完整');
      }
      state.pos += 8;
      continue;
    } else if (wireType === 5) {
      if (state.pos + 4 > bytes.length) {
        throw new Error('迁移数据不完整');
      }
      state.pos += 4;
      continue;
    } else {
      throw new Error('迁移数据包含不支持的结构');
    }

    if (!fields.has(field)) {
      fields.set(field, []);
    }
    fields.get(field).push(value);
  }

  return fields;
}

function decodeText(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    return '';
  }
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function parseOtpParameters(bytes) {
  const fields = readMessage(bytes);
  const secretBytes = fields.get(1)?.[0];
  const type = Number(fields.get(6)?.[0] ?? 0);
  const algorithmValue = Number(fields.get(4)?.[0] ?? 0);
  const digitsValue = Number(fields.get(5)?.[0] ?? 0);

  if (!(secretBytes instanceof Uint8Array) || secretBytes.length === 0) {
    return { skipReason: '密钥无效' };
  }
  if (type === 1) {
    return { skipReason: 'HOTP' };
  }
  if (type !== 0 && type !== 2) {
    return { skipReason: '验证类型' };
  }
  if (!ALGORITHMS[algorithmValue]) {
    return { skipReason: '哈希算法' };
  }
  if (!DIGITS[digitsValue]) {
    return { skipReason: '验证码位数' };
  }

  let algorithm;
  try {
    algorithm = normalizeAlgorithm(ALGORITHMS[algorithmValue]);
  } catch {
    return { skipReason: '哈希算法' };
  }

  const issuer = cleanText(decodeText(fields.get(3)?.[0]));
  const name = cleanText(decodeText(fields.get(2)?.[0])) || issuer || '未命名账户';

  return {
    issuer,
    name,
    secret: encodeBase32(secretBytes),
    algorithm,
    digits: DIGITS[digitsValue],
    period: 30,
  };
}

export function parseMigrationPayload(payloadBytes) {
  const payload = readMessage(payloadBytes);
  const parameterEntries = payload.get(1) ?? [];
  const accounts = [];
  const reasons = new Set();
  let skipped = 0;

  for (const entry of parameterEntries) {
    if (!(entry instanceof Uint8Array)) {
      skipped += 1;
      continue;
    }
    try {
      const parsed = parseOtpParameters(entry);
      if (parsed.skipReason) {
        skipped += 1;
        reasons.add(parsed.skipReason);
      } else {
        accounts.push(parsed);
      }
    } catch {
      skipped += 1;
    }
  }

  return { accounts, skipped, reasons: [...reasons] };
}

export function decodeMigrationUri(uri) {
  const raw = String(uri ?? '').trim();
  if (!isMigrationUri(raw)) {
    throw new Error('不是有效的迁移链接');
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('迁移链接格式不正确');
  }

  const data = url.searchParams.get('data');
  if (!data) {
    throw new Error('迁移链接中缺少数据');
  }

  const result = parseMigrationPayload(decodeBase64Url(data));
  if (result.accounts.length === 0) {
    throw new Error(result.skipped ? '二维码中的账户暂不支持' : '二维码中没有可导入的账户');
  }

  return result;
}
