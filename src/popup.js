import { decodeBase32, normalizeSecret } from './lib/base32.js';
import {
  formatCode,
  generateTOTP,
  getSecondsRemaining,
  getStep,
} from './lib/totp.js';
import { isMigrationUri, parseOtpAuthUri } from './lib/otpauth.js';
import { decodeMigrationUri } from './lib/migration.js';
import {
  clearAccounts,
  isPreview,
  loadAccounts,
  saveAccounts,
} from './lib/storage.js';
import {
  accountFingerprint,
  mergeAccounts,
  normalizeAccount,
} from './lib/accounts.js';
import { decodeQrFromBlob } from './lib/qr-image.js';
import { fillOtpField } from './lib/autofill.js';

const RING_CIRCUMFERENCE = 2 * Math.PI * 15;
const HAS_EXTENSION_APIS = Boolean(
  globalThis.chrome?.tabs?.query && globalThis.chrome?.scripting?.executeScript,
);

const state = {
  accounts: [],
  view: 'list',
  addTab: 'scan',
  editingId: null,
  search: '',
  codes: new Map(),
  visible: new Map(),
  inFlight: new Set(),
  menuAccountId: null,
  menuAnchor: null,
  modalReturnFocus: null,
  busy: false,
  toastTimer: null,
  modalResolve: null,
};

const els = {
  listView: document.getElementById('listView'),
  formView: document.getElementById('formView'),
  settingsView: document.getElementById('settingsView'),
  addBtn: document.getElementById('addBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  appHeader: document.querySelector('.app-header'),
  main: document.getElementById('main'),
  searchWrap: document.getElementById('searchWrap'),
  searchInput: document.getElementById('searchInput'),
  accountList: document.getElementById('accountList'),
  emptyState: document.getElementById('emptyState'),
  formTitle: document.getElementById('formTitle'),
  formTabs: document.getElementById('formTabs'),
  scanPanel: document.getElementById('scanPanel'),
  manualPanel: document.getElementById('manualPanel'),
  dropzone: document.getElementById('dropzone'),
  qrFile: document.getElementById('qrFile'),
  uriInput: document.getElementById('uriInput'),
  uriImportBtn: document.getElementById('uriImportBtn'),
  accountForm: document.getElementById('accountForm'),
  fieldIssuer: document.getElementById('fieldIssuer'),
  fieldName: document.getElementById('fieldName'),
  fieldSecret: document.getElementById('fieldSecret'),
  secretError: document.getElementById('secretError'),
  fieldAlgorithm: document.getElementById('fieldAlgorithm'),
  fieldDigits: document.getElementById('fieldDigits'),
  fieldPeriod: document.getElementById('fieldPeriod'),
  advanced: document.getElementById('advanced'),
  formError: document.getElementById('formError'),
  formSubmit: document.getElementById('formSubmit'),
  settingsCount: document.getElementById('settingsCount'),
  settingsStorage: document.getElementById('settingsStorage'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  clearBtn: document.getElementById('clearBtn'),
  toast: document.getElementById('toast'),
  contextMenu: document.getElementById('contextMenu'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
  modalCancel: document.getElementById('modalCancel'),
  modalConfirm: document.getElementById('modalConfirm'),
};

init();

async function init() {
  bindEvents();
  try {
    state.accounts = await loadAccounts();
  } catch {
    toast('读取本地数据失败', { type: 'error' });
  }
  renderList();
  renderSettings();
  startTicker();
}

function bindEvents() {
  els.addBtn.addEventListener('click', openAddView);
  els.settingsBtn.addEventListener('click', openSettingsView);

  document.querySelectorAll('[data-back]').forEach((button) => {
    button.addEventListener('click', goBackToList);
  });

  els.searchInput.addEventListener('input', () => {
    state.search = els.searchInput.value.trim();
    renderList();
  });

  els.emptyState.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="open-add"]')) {
      openAddView();
    }
  });

  els.formTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) {
      setAddTab(button.dataset.tab);
    }
  });

  els.accountList.addEventListener('click', onListClick);
  els.accountList.addEventListener('scroll', closeMenu, { passive: true });

  els.dropzone.addEventListener('click', () => {
    if (!state.busy) {
      els.qrFile.click();
    }
  });

  els.dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!state.busy) {
        els.qrFile.click();
      }
    }
  });

  els.dropzone.addEventListener('dragenter', onDragOver);
  els.dropzone.addEventListener('dragover', onDragOver);
  els.dropzone.addEventListener('dragleave', onDragLeave);
  els.dropzone.addEventListener('drop', onDrop);

  els.qrFile.addEventListener('change', async () => {
    const file = els.qrFile.files?.[0];
    els.qrFile.value = '';
    if (file) {
      await handleQrFile(file);
    }
  });

  document.addEventListener('paste', onPaste);

  els.uriImportBtn.addEventListener('click', async () => {
    const text = els.uriInput.value.trim();
    if (!text) {
      toast('请先粘贴链接或二维码内容', { type: 'warn' });
      return;
    }
    await importText(text, { clearInput: true });
  });

  els.uriInput.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      els.uriImportBtn.click();
    }
  });

  els.accountForm.addEventListener('submit', onSubmitForm);

  els.fieldSecret.addEventListener('blur', () => {
    const normalized = normalizeSecret(els.fieldSecret.value);
    if (normalized) {
      els.fieldSecret.value = normalized;
    }
  });

  els.fieldSecret.addEventListener('input', () => {
    els.secretError.hidden = true;
    els.fieldSecret.classList.remove('invalid');
    hideFormError();
  });

  [els.fieldIssuer, els.fieldName, els.fieldPeriod].forEach((input) => {
    input.addEventListener('input', hideFormError);
  });

  els.exportBtn.addEventListener('click', exportBackup);
  els.importBtn.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', async () => {
    const file = els.importFile.files?.[0];
    els.importFile.value = '';
    if (file) {
      await importBackupFile(file);
    }
  });
  els.clearBtn.addEventListener('click', clearAllAccounts);

  els.contextMenu.addEventListener('click', onMenuClick);

  els.modalCancel.addEventListener('click', () => resolveModal(false));
  els.modalConfirm.addEventListener('click', () => resolveModal(true));
  els.modal.addEventListener('click', (event) => {
    if (event.target === els.modal) {
      resolveModal(false);
    }
  });

  document.addEventListener('click', (event) => {
    if (
      !els.contextMenu.hidden
      && !els.contextMenu.contains(event.target)
      && !event.target.closest('[data-action="menu"]')
    ) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    if (!els.modal.hidden) {
      resolveModal(false);
      return;
    }
    if (!els.contextMenu.hidden) {
      closeMenu();
      return;
    }
    if (state.view !== 'list') {
      goBackToList();
    }
  });

  window.addEventListener('resize', closeMenu);
}

function setView(view) {
  state.view = view;
  const isList = view === 'list';

  els.listView.hidden = !isList;
  els.formView.hidden = view !== 'form';
  els.settingsView.hidden = view !== 'settings';
  document.body.classList.toggle('subview', !isList);

  if (isList) {
    renderList();
  } else {
    state.visible.clear();
    closeMenu();
  }
}

function goBackToList() {
  state.editingId = null;
  resetForm();
  setView('list');
}

function openAddView() {
  closeMenu();
  resetForm();
  state.editingId = null;
  els.formTitle.textContent = '添加账户';
  els.formSubmit.textContent = '添加账户';
  els.formTabs.hidden = false;
  setAddTab('scan');
  setView('form');
}

function openEditView(accountId) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) {
    return;
  }

  closeMenu();
  resetForm();
  state.editingId = account.id;
  els.formTitle.textContent = '编辑账户';
  els.formSubmit.textContent = '保存修改';
  els.formTabs.hidden = true;

  els.fieldIssuer.value = account.issuer;
  els.fieldName.value = account.name;
  els.fieldSecret.value = account.secret;
  els.fieldAlgorithm.value = account.algorithm;
  els.fieldDigits.value = String(account.digits);
  els.fieldPeriod.value = String(account.period);
  els.advanced.open = (
    account.algorithm !== 'SHA1'
    || account.digits !== 6
    || account.period !== 30
  );

  setAddTab('manual');
  setView('form');
  setTimeout(() => els.fieldIssuer.focus(), 0);
}

function openSettingsView() {
  closeMenu();
  renderSettings();
  setView('settings');
}

function setAddTab(tab) {
  state.addTab = tab;
  els.formTabs.querySelectorAll('[data-tab]').forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  els.scanPanel.hidden = tab !== 'scan';
  els.manualPanel.hidden = tab !== 'manual';

  if (tab === 'manual') {
    setTimeout(() => els.fieldIssuer.focus(), 0);
  }
}

function resetForm() {
  els.accountForm.reset();
  els.fieldAlgorithm.value = 'SHA1';
  els.fieldDigits.value = '6';
  els.fieldPeriod.value = '30';
  els.advanced.open = false;
  els.secretError.hidden = true;
  els.secretError.textContent = '';
  els.fieldSecret.classList.remove('invalid');
  hideFormError();
}

function renderList() {
  closeMenu();
  state.visible.clear();

  if (state.view !== 'list') {
    return;
  }

  const total = state.accounts.length;
  els.searchWrap.hidden = total === 0;
  els.emptyState.hidden = total !== 0;

  if (total === 0) {
    state.search = '';
    els.searchInput.value = '';
    els.accountList.innerHTML = '';
    return;
  }

  const query = state.search.toLowerCase();
  const filtered = query
    ? state.accounts.filter((account) => (
      `${account.issuer} ${account.name}`.toLowerCase().includes(query)
    ))
    : state.accounts;

  if (filtered.length === 0) {
    els.accountList.innerHTML = `
      <div class="no-results">
        <strong>没有匹配的账户</strong>
        <span>换个关键词试试</span>
      </div>
    `;
    return;
  }

  const now = Date.now();
  els.accountList.innerHTML = filtered.map((account) => accountCardHtml(account, now)).join('');

  els.accountList.querySelectorAll('.account-card').forEach((card) => {
    const id = card.dataset.accountId;
    state.visible.set(id, {
      card,
      title: card.querySelector('.account-title').textContent,
      codeEl: card.querySelector('.code'),
      secondsEl: card.querySelector('.ring-sec'),
      ringWrap: card.querySelector('.ring'),
      ringFg: card.querySelector('.ring-fg'),
    });
  });

  refreshVisibleCodes();
}

function accountCardHtml(account, now) {
  const title = account.issuer || account.name || '未命名账户';
  const subtitle = account.issuer && account.name && account.name !== account.issuer
    ? account.name
    : '';
  const fingerprint = accountFingerprint(account);
  const step = getStep(account.period, now);
  const cached = state.codes.get(account.id);
  const hasCurrentCode = cached
    && cached.step === step
    && cached.fingerprint === fingerprint;
  const codeText = hasCurrentCode ? formatCode(cached.code, account.digits) : '· · ·';
  const secondsLeft = getSecondsRemaining(account.period, now);
  const ringOffset = RING_CIRCUMFERENCE * (1 - (secondsLeft / account.period));

  return `
    <article class="account-card" data-account-id="${escapeHtml(account.id)}" aria-label="${escapeHtml(title)}">
      <div class="avatar" style="background:${avatarGradient(title)}">${escapeHtml(firstCharacter(title))}</div>
      <div class="account-meta">
        <div class="account-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="account-sub">${escapeHtml(subtitle)}</div>` : ''}
      </div>
      <button type="button" class="code" data-action="copy" data-id="${escapeHtml(account.id)}" title="点击复制验证码" aria-label="复制 ${escapeHtml(title)} 的验证码 ${escapeHtml(codeText)}">${escapeHtml(codeText)}</button>
      <div class="ring${secondsLeft <= 5 ? ' warn' : ''}" aria-label="剩余 ${secondsLeft} 秒">
        <svg viewBox="0 0 36 36" aria-hidden="true">
          <circle class="ring-bg" cx="18" cy="18" r="15"></circle>
          <circle class="ring-fg" cx="18" cy="18" r="15" style="stroke-dasharray:${RING_CIRCUMFERENCE.toFixed(2)};stroke-dashoffset:${ringOffset.toFixed(2)}"></circle>
        </svg>
        <span class="ring-sec" aria-hidden="true">${secondsLeft}</span>
      </div>
      <button type="button" class="kebab" data-action="menu" data-id="${escapeHtml(account.id)}" title="更多操作" aria-haspopup="menu" aria-expanded="false" aria-label="更多操作">⋯</button>
    </article>
  `;
}

function onListClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) {
    return;
  }

  const { action, id } = button.dataset;
  if (action === 'copy') {
    copyAccount(id);
  } else if (action === 'menu') {
    if (els.contextMenu.hidden || state.menuAccountId !== id) {
      openMenu(id, button);
    } else {
      closeMenu();
    }
    event.stopPropagation();
  }
}

function openMenu(accountId, anchor) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) {
    return;
  }

  closeMenu();
  state.menuAccountId = accountId;
  state.menuAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  els.contextMenu.hidden = false;

  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = els.contextMenu.getBoundingClientRect();
  const left = Math.max(
    8,
    Math.min(
      window.innerWidth - menuRect.width - 8,
      anchorRect.right - menuRect.width + 4,
    ),
  );
  let top = anchorRect.bottom + 5;
  if (top + menuRect.height > window.innerHeight - 8) {
    top = anchorRect.top - menuRect.height - 5;
  }
  els.contextMenu.style.left = `${left}px`;
  els.contextMenu.style.top = `${Math.max(8, top)}px`;

  els.contextMenu.querySelector('button')?.focus();
}

function closeMenu() {
  if (els.contextMenu.hidden) {
    return;
  }
  els.contextMenu.hidden = true;
  if (state.menuAnchor?.isConnected) {
    state.menuAnchor.setAttribute('aria-expanded', 'false');
  }
  state.menuAnchor = null;
  state.menuAccountId = null;
}

function onMenuClick(event) {
  const button = event.target.closest('[data-menu-action]');
  if (!button) {
    return;
  }

  const { menuAction } = button.dataset;
  const accountId = state.menuAccountId;
  closeMenu();
  if (!accountId) {
    return;
  }

  if (menuAction === 'copy') {
    copyAccount(accountId);
  } else if (menuAction === 'fill') {
    fillAccount(accountId);
  } else if (menuAction === 'edit') {
    openEditView(accountId);
  } else if (menuAction === 'delete') {
    deleteAccount(accountId);
  }
}

async function getCurrentCode(accountId, { silent = false } = {}) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) {
    return null;
  }

  const timestamp = Date.now();
  const fingerprint = accountFingerprint(account);
  const step = getStep(account.period, timestamp);
  const cached = state.codes.get(accountId);
  if (cached && cached.step === step && cached.fingerprint === fingerprint) {
    return cached.code;
  }

  try {
    const code = await generateTOTP({
      secret: account.secret,
      algorithm: account.algorithm,
      digits: account.digits,
      period: account.period,
      timestamp,
    });
    state.codes.set(accountId, { code, step, fingerprint });
    return code;
  } catch (error) {
    if (!silent) {
      toast(`验证码生成失败：${error.message}`, { type: 'error' });
    }
    return null;
  }
}

async function copyAccount(accountId) {
  const code = await getCurrentCode(accountId);
  if (!code) {
    return;
  }
  const copied = await copyText(code);
  if (copied) {
    toast('验证码已复制');
    flashCard(accountId);
  } else {
    toast('复制失败，请手动选择验证码', { type: 'error' });
  }
}

async function fillAccount(accountId) {
  const code = await getCurrentCode(accountId);
  if (!code) {
    return;
  }

  if (!HAS_EXTENSION_APIS) {
    const copied = await copyText(code);
    toast(copied ? '预览模式：验证码已复制' : '预览模式下无法填入页面', {
      type: copied ? 'warn' : 'error',
    });
    return;
  }

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    await copyAfterFillFailure(code, '无法获取当前页面，已复制验证码');
    return;
  }

  if (!tab?.id) {
    await copyAfterFillFailure(code, '无法获取当前页面，已复制验证码');
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillOtpField,
      args: [code],
    });
    if (results?.[0]?.result === true) {
      toast('已填入当前页面');
      setTimeout(() => window.close(), 700);
      return;
    }
    await copyAfterFillFailure(code, '未找到验证码输入框，已复制验证码');
  } catch {
    await copyAfterFillFailure(code, '此页面无法自动填充，已复制验证码');
  }
}

async function copyAfterFillFailure(code, message) {
  const copied = await copyText(code);
  toast(copied ? message : '自动填充失败，请手动复制验证码', {
    type: copied ? 'warn' : 'error',
  });
}

function flashCard(accountId) {
  const card = state.visible.get(accountId)?.card;
  if (!card) {
    return;
  }
  card.classList.add('copied');
  clearTimeout(card.copyTimer);
  card.copyTimer = setTimeout(() => card.classList.remove('copied'), 700);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through to the legacy path.
  }

  try {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand('copy');
    helper.remove();
    return copied;
  } catch {
    return false;
  }
}

function refreshVisibleCodes() {
  const tasks = [];

  for (const [accountId, refs] of state.visible) {
    const account = state.accounts.find((item) => item.id === accountId);
    if (!account) {
      continue;
    }

    const fingerprint = accountFingerprint(account);
    const timestamp = Date.now();
    const step = getStep(account.period, timestamp);
    const cached = state.codes.get(accountId);
    if (cached && cached.step === step && cached.fingerprint === fingerprint) {
      continue;
    }

    const flightKey = `${accountId}:${fingerprint}`;
    if (state.inFlight.has(flightKey)) {
      continue;
    }
    state.inFlight.add(flightKey);

    tasks.push(
      generateTOTP({
        secret: account.secret,
        algorithm: account.algorithm,
        digits: account.digits,
        period: account.period,
        timestamp,
      }).then((code) => {
        const latest = state.accounts.find((item) => item.id === accountId);
        if (!latest || accountFingerprint(latest) !== fingerprint) {
          return;
        }
        if (getStep(latest.period) !== step) {
          return;
        }
        state.codes.set(accountId, { code, step, fingerprint });
        const current = state.visible.get(accountId);
        if (current) {
          const formatted = formatCode(code, account.digits);
          current.codeEl.textContent = formatted;
          current.codeEl.setAttribute('aria-label', `复制 ${current.title} 的验证码 ${formatted}`);
        }
      }).catch(() => {
        const current = state.visible.get(accountId);
        if (current) {
          current.codeEl.textContent = '错误';
        }
      }).finally(() => {
        state.inFlight.delete(flightKey);
      }),
    );
  }

  return Promise.all(tasks);
}

function updateCountdowns() {
  const now = Date.now();

  for (const [accountId, refs] of state.visible) {
    const account = state.accounts.find((item) => item.id === accountId);
    if (!account) {
      continue;
    }
    const secondsLeft = getSecondsRemaining(account.period, now);
    refs.secondsEl.textContent = String(secondsLeft);
    refs.ringWrap.classList.toggle('warn', secondsLeft <= 5);
    refs.ringWrap.setAttribute('aria-label', `剩余 ${secondsLeft} 秒`);
    refs.ringFg.style.strokeDashoffset = (
      RING_CIRCUMFERENCE * (1 - (secondsLeft / account.period))
    ).toFixed(2);
  }
}

function startTicker() {
  const tick = () => {
    if (state.view === 'list') {
      updateCountdowns();
      refreshVisibleCodes();
    }
    const delay = 1000 - (Date.now() % 1000) + 20;
    setTimeout(tick, delay);
  };
  setTimeout(tick, 1000 - (Date.now() % 1000) + 20);
}

function onDragOver(event) {
  event.preventDefault();
  if (!state.busy) {
    els.dropzone.classList.add('dragging');
  }
}

function onDragLeave(event) {
  if (!els.dropzone.contains(event.relatedTarget)) {
    els.dropzone.classList.remove('dragging');
  }
}

async function onDrop(event) {
  event.preventDefault();
  els.dropzone.classList.remove('dragging');
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    await handleQrFile(file);
  }
}

function onPaste(event) {
  if (state.view !== 'form' || state.addTab !== 'scan' || els.formTabs.hidden) {
    return;
  }

  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find((item) => item.type.startsWith('image/'));
  if (imageItem) {
    event.preventDefault();
    const file = imageItem.getAsFile();
    if (file) {
      handleQrFile(file);
    }
    return;
  }

  const text = event.clipboardData?.getData('text') || '';
  const isEditable = event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement;
  if (!isEditable && /otpauth(?:-migration)?:\/\//i.test(text)) {
    event.preventDefault();
    importText(text);
  }
}

async function handleQrFile(file) {
  if (!file.type?.startsWith('image/')) {
    toast('请选择图片文件', { type: 'error' });
    return;
  }

  await withBusy(async () => {
    try {
      const payload = await decodeQrFromBlob(file);
      await importPayloadText(payload);
    } catch (error) {
      toast(error.message || '二维码识别失败', { type: 'error' });
    }
  });
}

async function importText(text, { clearInput = false } = {}) {
  await withBusy(async () => {
    try {
      const imported = await importPayloadText(text);
      if (imported && clearInput) {
        els.uriInput.value = '';
      }
    } catch (error) {
      toast(error.message || '导入失败', { type: 'error' });
    }
  });
}

async function withBusy(task) {
  if (state.busy) {
    return;
  }
  state.busy = true;
  els.dropzone.classList.add('busy');
  els.dropzone.setAttribute('aria-busy', 'true');
  try {
    await task();
  } finally {
    state.busy = false;
    els.dropzone.classList.remove('busy');
    els.dropzone.removeAttribute('aria-busy');
  }
}

async function importPayloadText(text) {
  const uris = String(text).match(/otpauth(?:-migration)?:\/\/[^\s"'<>]+/gi) || [];
  if (uris.length === 0) {
    throw new Error('未识别到有效的 otpauth 数据');
  }

  const parsedAccounts = [];
  const reasons = new Set();
  let skipped = 0;

  for (const uri of uris) {
    try {
      if (isMigrationUri(uri)) {
        const result = decodeMigrationUri(uri);
        parsedAccounts.push(...result.accounts);
        skipped += result.skipped;
        result.reasons.forEach((reason) => reasons.add(reason));
      } else {
        parsedAccounts.push(parseOtpAuthUri(uri));
      }
    } catch (error) {
      if (uris.length === 1) {
        throw error;
      }
      skipped += 1;
      reasons.add('解析失败');
    }
  }

  if (parsedAccounts.length === 0) {
    throw new Error('没有可导入的账户');
  }

  const normalized = [];
  let invalid = 0;
  for (const item of parsedAccounts) {
    try {
      normalized.push(normalizeAccount(item, { keepId: false }));
    } catch {
      invalid += 1;
    }
  }

  if (normalized.length === 0) {
    throw new Error('账户格式无法识别');
  }

  const merged = mergeAccounts(state.accounts, normalized);
  const totalSkipped = skipped + invalid + merged.skipped;

  if (merged.added.length === 0) {
    toast(
      totalSkipped > 0 ? `没有新账户（跳过 ${totalSkipped} 个）` : '这些账户已经存在',
      { type: 'warn' },
    );
    return false;
  }

  try {
    await saveAccounts(merged.accounts);
  } catch (error) {
    toast(error.message || '保存失败', { type: 'error' });
    return false;
  }

  state.accounts = merged.accounts;
  state.search = '';
  els.searchInput.value = '';
  resetForm();
  state.editingId = null;
  setView('list');

  const skippedText = totalSkipped > 0 ? `，跳过 ${totalSkipped} 个` : '';
  const reasonText = reasons.size > 0 ? `（${[...reasons].join('、')} 不支持）` : '';
  toast(`已添加 ${merged.added.length} 个账户${skippedText}${reasonText}`);
  return true;
}

async function onSubmitForm(event) {
  event.preventDefault();
  hideFormError();
  els.secretError.hidden = true;
  els.fieldSecret.classList.remove('invalid');

  const issuer = els.fieldIssuer.value.trim();
  const name = els.fieldName.value.trim();
  if (!issuer && !name) {
    showFormError('请填写服务名称或账户名称');
    els.fieldIssuer.focus();
    return;
  }

  const secret = normalizeSecret(els.fieldSecret.value);
  if (!secret) {
    showSecretError('请填写密钥');
    return;
  }
  try {
    decodeBase32(secret);
  } catch (error) {
    showSecretError(error.message);
    return;
  }

  const period = Number(els.fieldPeriod.value);
  if (!Number.isInteger(period) || period < 1 || period > 600) {
    showFormError('刷新周期应为 1–600 秒');
    els.fieldPeriod.focus();
    return;
  }

  const raw = {
    issuer,
    name,
    secret,
    algorithm: els.fieldAlgorithm.value,
    digits: Number(els.fieldDigits.value),
    period,
  };

  let account;
  try {
    account = normalizeAccount(raw, { keepId: false });
  } catch (error) {
    showFormError(error.message);
    return;
  }

  const duplicate = state.accounts.find((item) => (
    item.id !== state.editingId
    && accountFingerprint(item) === accountFingerprint(account)
  ));
  if (duplicate) {
    showSecretError('该密钥已添加过，请勿重复添加');
    els.fieldSecret.classList.add('invalid');
    return;
  }

  try {
    if (state.editingId) {
      const existing = state.accounts.find((item) => item.id === state.editingId);
      if (!existing) {
        showFormError('账户不存在，请返回后重试');
        return;
      }
      const updated = normalizeAccount({
        ...raw,
        id: existing.id,
        createdAt: existing.createdAt,
      });
      const next = state.accounts.map((item) => (
        item.id === existing.id ? updated : item
      ));
      await saveAccounts(next);
      state.accounts = next;
      state.codes.delete(existing.id);
      resetForm();
      state.editingId = null;
      setView('list');
      toast('账户已更新');
      return;
    }

    const next = [account, ...state.accounts];
    await saveAccounts(next);
    state.accounts = next;
    state.search = '';
    els.searchInput.value = '';
    resetForm();
    setView('list');
    toast('账户已添加');
  } catch (error) {
    showFormError(error.message || '保存失败');
  }
}

function showFormError(message) {
  els.formError.textContent = message;
  els.formError.hidden = false;
  els.formError.scrollIntoView({ block: 'nearest' });
}

function hideFormError() {
  els.formError.hidden = true;
  els.formError.textContent = '';
}

function showSecretError(message) {
  els.secretError.textContent = message;
  els.secretError.hidden = false;
  els.fieldSecret.classList.add('invalid');
  els.fieldSecret.focus();
}

async function deleteAccount(accountId) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) {
    return;
  }

  closeMenu();
  const label = account.issuer || account.name || '该账户';
  const confirmed = await confirmDialog({
    title: '删除账户？',
    body: `「${label}」的密钥将从本机删除，此操作无法撤销。`,
    confirmLabel: '删除',
  });
  if (!confirmed) {
    return;
  }

  try {
    const next = state.accounts.filter((item) => item.id !== accountId);
    await saveAccounts(next);
    state.accounts = next;
    state.codes.delete(accountId);
    renderList();
    toast('账户已删除');
  } catch (error) {
    toast(error.message || '删除失败', { type: 'error' });
  }
}

function renderSettings() {
  els.settingsCount.textContent = `${state.accounts.length} 个账户`;
  els.settingsStorage.textContent = isPreview()
    ? '预览模式 · 数据保存在浏览器本地'
    : '数据仅保存在本机浏览器';
  els.exportBtn.disabled = state.accounts.length === 0;
  els.clearBtn.disabled = state.accounts.length === 0;
}

function exportBackup() {
  if (state.accounts.length === 0) {
    return;
  }

  const accounts = state.accounts.map((account) => ({
    issuer: account.issuer,
    name: account.name,
    secret: account.secret,
    algorithm: account.algorithm,
    digits: account.digits,
    period: account.period,
  }));
  const payload = {
    app: 'TOTP Helper',
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `totp-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('备份已导出');
}

async function importBackupFile(file) {
  try {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('备份文件不是有效的 JSON');
    }

    const rawList = Array.isArray(data)
      ? data
      : (Array.isArray(data?.accounts) ? data.accounts : null);
    if (!rawList) {
      throw new Error('备份文件格式不正确');
    }

    const normalized = [];
    let invalid = 0;
    for (const item of rawList) {
      try {
        normalized.push(normalizeAccount(item, { keepId: false }));
      } catch {
        invalid += 1;
      }
    }
    if (normalized.length === 0) {
      throw new Error('备份文件中没有有效账户');
    }

    const merged = mergeAccounts(state.accounts, normalized);
    const skipped = invalid + merged.skipped;
    if (merged.added.length === 0) {
      toast(`没有新账户${skipped > 0 ? `（跳过 ${skipped} 个）` : ''}`, { type: 'warn' });
      return;
    }

    await saveAccounts(merged.accounts);
    state.accounts = merged.accounts;
    state.search = '';
    els.searchInput.value = '';
    renderSettings();
    setView('list');
    toast(`已导入 ${merged.added.length} 个账户${skipped > 0 ? `，跳过 ${skipped} 个` : ''}`);
  } catch (error) {
    toast(error.message || '导入失败', { type: 'error' });
  }
}

async function clearAllAccounts() {
  const confirmed = await confirmDialog({
    title: '清空所有账户？',
    body: '本机保存的全部密钥将被删除，且无法恢复。建议先导出备份。',
    confirmLabel: '清空',
  });
  if (!confirmed) {
    return;
  }

  try {
    await clearAccounts();
    state.accounts = [];
    state.codes.clear();
    state.search = '';
    els.searchInput.value = '';
    resetForm();
    renderSettings();
    setView('list');
    toast('已清空所有账户');
  } catch (error) {
    toast(error.message || '清空失败', { type: 'error' });
  }
}

function confirmDialog({ title, body, confirmLabel = '确定', cancelLabel = '取消' }) {
  if (state.modalResolve) {
    resolveModal(false);
  }

  els.modalTitle.textContent = title;
  els.modalBody.textContent = body;
  els.modalConfirm.textContent = confirmLabel;
  els.modalCancel.textContent = cancelLabel;
  state.modalReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  els.appHeader.inert = true;
  els.main.inert = true;
  els.modal.hidden = false;
  els.modalCancel.focus();

  return new Promise((resolve) => {
    state.modalResolve = resolve;
  });
}

function resolveModal(result) {
  els.modal.hidden = true;
  els.appHeader.inert = false;
  els.main.inert = false;
  const returnFocus = state.modalReturnFocus;
  state.modalReturnFocus = null;
  const resolve = state.modalResolve;
  state.modalResolve = null;
  if (resolve) {
    resolve(result);
  }
  if (returnFocus?.isConnected) {
    returnFocus.focus();
  }
}

function toast(message, { type = '' } = {}) {
  clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  if (type) {
    els.toast.dataset.type = type;
  } else {
    delete els.toast.dataset.type;
  }
  els.toast.classList.add('show');
  state.toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
  }, 2300);
}

function avatarGradient(text) {
  let hash = 0;
  for (const char of String(text)) {
    hash = (hash * 31 + char.codePointAt(0)) % 360;
  }
  const hue = hash;
  return `linear-gradient(135deg, hsl(${hue} 68% 52%), hsl(${(hue + 34) % 360} 63% 43%))`;
}

function firstCharacter(text) {
  const value = String(text).trim();
  return value ? [...value][0].toUpperCase() : '?';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}
