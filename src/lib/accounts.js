import { decodeBase32, normalizeSecret } from './base32.js';
import { normalizeAlgorithm } from './totp.js';

let sequence = 0;

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  sequence += 1;
  return `account_${Date.now().toString(36)}_${sequence.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value, maxLength = 120) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function normalizeAccount(raw, { keepId = true } = {}) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('账户数据格式不正确');
  }

  const secret = normalizeSecret(raw.secret);
  if (!secret) {
    throw new Error('缺少密钥');
  }
  decodeBase32(secret);

  const algorithm = normalizeAlgorithm(raw.algorithm || 'SHA1');

  const digits = Number.parseInt(raw.digits ?? 6, 10);
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
    throw new Error('验证码位数应为 6–8 位');
  }

  const period = Number.parseInt(raw.period ?? 30, 10);
  if (!Number.isInteger(period) || period < 1 || period > 600) {
    throw new Error('刷新周期应为 1–600 秒');
  }

  const issuer = cleanText(raw.issuer);
  const name = cleanText(raw.name) || issuer || '未命名账户';
  const createdAt = Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now();

  return {
    id: keepId && typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    issuer,
    name,
    secret,
    algorithm,
    digits,
    period,
    createdAt,
  };
}

export function accountFingerprint(account) {
  return [account.secret, account.algorithm, account.digits, account.period].join('|');
}

export function mergeAccounts(existing, incoming) {
  const seen = new Set(existing.map(accountFingerprint));
  const added = [];
  let skipped = 0;

  for (const account of incoming) {
    const fingerprint = accountFingerprint(account);
    if (seen.has(fingerprint)) {
      skipped += 1;
      continue;
    }
    seen.add(fingerprint);
    added.push(account);
  }

  return {
    accounts: [...added, ...existing],
    added,
    skipped,
  };
}
