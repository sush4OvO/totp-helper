const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function normalizeSecret(value) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/=+$/, '')
    .toUpperCase();
}

export function decodeBase32(value) {
  const secret = normalizeSecret(value);
  if (!secret) {
    throw new Error('密钥不能为空');
  }

  let bits = 0;
  let buffer = 0;
  const bytes = [];

  for (const char of secret) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('密钥包含无效的 Base32 字符');
    }
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }

  if (bytes.length === 0) {
    throw new Error('密钥长度不足');
  }

  return Uint8Array.from(bytes);
}

export function encodeBase32(bytes) {
  let bits = 0;
  let buffer = 0;
  let result = '';

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += ALPHABET[(buffer >>> bits) & 31];
      buffer &= (1 << bits) - 1;
    }
  }

  if (bits > 0) {
    result += ALPHABET[(buffer << (5 - bits)) & 31];
  }

  return result;
}
