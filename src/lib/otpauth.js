import { decodeBase32, normalizeSecret } from './base32.js';
import { normalizeAlgorithm } from './totp.js';

function cleanText(value, maxLength = 120) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function isMigrationUri(value) {
  return /^otpauth-migration:\/\//i.test(String(value ?? '').trim());
}

export function parseOtpAuthUri(uri) {
  const raw = String(uri ?? '').trim();
  if (!raw) {
    throw new Error('链接不能为空');
  }
  if (isMigrationUri(raw)) {
    throw new Error('这是迁移二维码，请使用迁移导入');
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('链接格式不正确');
  }

  if (url.protocol.toLowerCase() !== 'otpauth:') {
    throw new Error('不是有效的 otpauth 链接');
  }

  const type = url.hostname.toLowerCase();
  if (type === 'hotp') {
    throw new Error('暂不支持 HOTP（计数器）账户');
  }
  if (type !== 'totp') {
    throw new Error('不支持的验证类型');
  }

  const secret = normalizeSecret(url.searchParams.get('secret'));
  if (!secret) {
    throw new Error('链接中缺少密钥');
  }
  decodeBase32(secret);

  let label = '';
  try {
    label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    label = url.pathname.replace(/^\//, '');
  }
  label = cleanText(label, 200);

  let labelIssuer = '';
  let accountName = label;
  const separator = label.indexOf(':');
  if (separator > 0) {
    labelIssuer = cleanText(label.slice(0, separator));
    accountName = cleanText(label.slice(separator + 1));
  }

  const issuer = cleanText(url.searchParams.get('issuer') || labelIssuer);
  const name = cleanText(accountName) || issuer || '未命名账户';

  const algorithm = normalizeAlgorithm(url.searchParams.get('algorithm') || 'SHA1');

  const digits = Number.parseInt(url.searchParams.get('digits') || '6', 10);
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
    throw new Error('验证码位数应为 6–8 位');
  }

  const period = Number.parseInt(url.searchParams.get('period') || '30', 10);
  if (!Number.isInteger(period) || period < 1 || period > 600) {
    throw new Error('刷新周期应为 1–600 秒');
  }

  return { issuer, name, secret, algorithm, digits, period };
}
