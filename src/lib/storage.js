import { normalizeAccount } from './accounts.js';

const STORAGE_KEY = 'totp_accounts_v1';

function hasExtensionStorage() {
  return Boolean(globalThis.chrome?.storage?.local?.get);
}

function normalizeList(value) {
  const rawList = Array.isArray(value) ? value : [];
  const accounts = [];
  const ids = new Set();

  for (const item of rawList) {
    try {
      let account = normalizeAccount(item);
      if (ids.has(account.id)) {
        account = normalizeAccount(item, { keepId: false });
      }
      ids.add(account.id);
      accounts.push(account);
    } catch {
      // Ignore corrupted entries instead of blocking the whole list.
    }
  }

  return accounts;
}

async function readRaw() {
  if (hasExtensionStorage()) {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data?.[STORAGE_KEY];
  }

  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

async function writeRaw(accounts) {
  if (hasExtensionStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEY]: accounts });
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  } catch {
    throw new Error('本地存储空间不足，无法保存');
  }
}

export function isPreview() {
  return !hasExtensionStorage();
}

export async function loadAccounts() {
  return normalizeList(await readRaw());
}

export async function saveAccounts(accounts) {
  await writeRaw(accounts.map((account) => ({ ...account })));
}

export async function clearAccounts() {
  if (hasExtensionStorage()) {
    await chrome.storage.local.remove(STORAGE_KEY);
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
}
