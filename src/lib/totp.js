import { decodeBase32, normalizeSecret } from './base32.js';

const HASHES = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
};

const keyCache = new Map();

export function normalizeAlgorithm(value) {
  const algorithm = String(value ?? 'SHA1')
    .toUpperCase()
    .replace(/[-_]/g, '');
  if (!Object.hasOwn(HASHES, algorithm)) {
    throw new Error('不支持的哈希算法');
  }
  return algorithm;
}

export function getStep(period, timestamp = Date.now()) {
  return Math.floor(timestamp / 1000 / period);
}

export function getSecondsRemaining(period, timestamp = Date.now()) {
  const seconds = period - (Math.floor(timestamp / 1000) % period);
  return Math.max(1, Math.min(period, seconds));
}

async function getHmacKey(secret, algorithm) {
  const secretBytes = decodeBase32(secret);
  const cacheKey = `${algorithm}:${normalizeSecret(secret)}`;
  let pending = keyCache.get(cacheKey);

  if (!pending) {
    pending = crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: HASHES[algorithm] },
      false,
      ['sign'],
    );
    keyCache.set(cacheKey, pending);
  }

  try {
    return await pending;
  } catch (error) {
    keyCache.delete(cacheKey);
    throw new Error('无法读取密钥');
  }
}

export async function generateTOTP({
  secret,
  algorithm = 'SHA1',
  digits = 6,
  period = 30,
  timestamp = Date.now(),
} = {}) {
  const normalizedAlgorithm = normalizeAlgorithm(algorithm);
  const normalizedDigits = Number(digits);
  const normalizedPeriod = Number(period);

  if (!Number.isInteger(normalizedDigits) || normalizedDigits < 6 || normalizedDigits > 8) {
    throw new Error('验证码位数应为 6–8 位');
  }
  if (!Number.isInteger(normalizedPeriod) || normalizedPeriod < 1 || normalizedPeriod > 600) {
    throw new Error('刷新周期应为 1–600 秒');
  }

  const key = await getHmacKey(secret, normalizedAlgorithm);
  const step = getStep(normalizedPeriod, timestamp);
  const counter = new Uint8Array(8);
  const view = new DataView(counter.buffer);
  view.setUint32(0, Math.floor(step / 0x100000000));
  view.setUint32(4, step >>> 0);

  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = (
    ((signature[offset] & 0x7f) << 24)
    | ((signature[offset + 1] & 0xff) << 16)
    | ((signature[offset + 2] & 0xff) << 8)
    | (signature[offset + 3] & 0xff)
  ) >>> 0;
  const code = binary % (10 ** normalizedDigits);

  return String(code).padStart(normalizedDigits, '0');
}

export function formatCode(code, digits = String(code).length) {
  const groupSize = digits === 8 ? 4 : 3;
  return String(code)
    .replace(new RegExp(`(.{${groupSize}})`, 'g'), '$1 ')
    .trim();
}
