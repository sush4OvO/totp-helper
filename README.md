# TOTP 身份验证器 / TOTP Authenticator

一个离线运行的 Chrome 扩展，用于生成 TOTP 双因素验证码。  
An offline Chrome extension for generating TOTP two-factor authentication codes.

[简体中文](#简体中文) · [English](#english)

----
## 简体中文

### 简介

TOTP 身份验证器是一个基于 Manifest V3 的 Chrome 扩展。它在本机完成全部验证码计算，不发起网络请求，也不依赖云端账户。支持手动录入、二维码导入、`otpauth://` 链接以及 Google Authenticator 迁移码导入。

### 功能特性

- 多账户管理，支持搜索、编辑、删除与清空
- 算法：SHA-1 / SHA-256 / SHA-512
- 验证码：6 / 7 / 8 位，默认 6 位
- 周期：默认 30 秒，可设置 1–600 秒
- 实时倒计时圆环，验证码在周期边界自动刷新
- 点击验证码即可复制
- 「填入当前页面」自动查找并填写网页中的验证码输入框；找不到输入框时自动复制验证码
- 导入方式：
  - 选择、粘贴或拖拽二维码图片
  - 粘贴 `otpauth://totp/...` 链接
  - 扫描 Google Authenticator 导出的迁移二维码（`otpauth-migration://...`）
- JSON 备份导出与合并导入，重复账户自动跳过
- 快捷键 `Command/Ctrl + Shift + Y` 打开扩展
- 中文界面，无构建步骤，无第三方运行时依赖

### 安装

1. 下载或克隆本仓库到本地
2. 打开 `chrome://extensions`
3. 开启右上角的「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择本仓库根目录（包含 `manifest.json` 的目录）
6. 建议将扩展图标固定到工具栏

可在 `chrome://extensions/shortcuts` 查看或修改快捷键。

最低支持 Chrome 102。

### 使用说明

**添加账户**

点击工具栏图标打开扩展，点击右上角「+」，然后选择：

- **扫码导入**：选择二维码图片，或将图片直接拖入/粘贴到窗口中；也可以粘贴 `otpauth://` 或迁移链接后点击「解析并导入」
- **手动输入**：填写密钥，可选填服务名称与账户备注；在「高级选项」中调整算法、位数和周期

**获取验证码**

- 点击账户卡片上的验证码即可复制
- 点击「更多操作」→「填入当前页面」，扩展会尝试填写当前标签页中的验证码输入框
- 点击「更多操作」→「编辑账户」或「删除账户」进行管理

**备份与迁移**

打开「设置」→「备份与迁移」：

- **导出**：下载 `totp-backup-YYYY-MM-DD.json`
- **导入**：合并 JSON 备份，已存在的相同账户会被跳过

### 支持的导入格式

| 格式 | 说明 |
| --- | --- |
| 二维码图片 | 二维码内容需为 `otpauth://` 或 `otpauth-migration://` 链接 |
| `otpauth://totp/...` | 支持 `secret`、`issuer`、`algorithm`、`digits`、`period` 参数 |
| `otpauth-migration://...` | Google Authenticator 迁移码，导入其中的 TOTP 账户 |
| JSON 备份 | 本扩展导出的备份文件，导入时自动合并去重 |

重复账户按「密钥 + 算法 + 位数 + 周期」判断。迁移时遇到 HOTP 账户会跳过。

### 权限说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 将账户与密钥保存在浏览器本地 |
| `activeTab` | 仅在用户主动点击「填入当前页面」时临时访问当前标签页 |
| `scripting` | 在用户主动操作后向当前页面注入验证码填充逻辑 |

扩展未申请任何 `host_permissions`，也不会在后台自动访问网页。

### 数据与隐私

- 扩展不发起网络请求，验证码全部在本地计算
- 账户密钥保存在 `chrome.storage.local`，不会同步到云端
- 浏览器本地存储未额外加密；能访问你的 Chrome 用户资料的人可能读取到密钥
- 导出的 JSON 备份是**明文**，请勿分享或上传到不受信任的位置
- 系统时间偏差会导致验证码校验失败，请保持系统时间自动同步

### 开发与测试

项目使用原生 JavaScript、ES Modules 和 Manifest V3，无需安装依赖或构建。

**浏览器预览**

```bash
cd /path/to/totp-helper
python3 -m http.server 8123
```

然后打开 `http://127.0.0.1:8123/popup.html`。

预览模式使用 `localStorage` 代替 `chrome.storage`，并且无法使用网页自动填充；正式功能请以加载后的扩展为准。

**运行单元测试**

启动本地服务器后打开 `http://127.0.0.1:8123/tests/unit.html`。测试覆盖：

- RFC 6238 SHA-1 / SHA-256 / SHA-512 标准向量
- Base32 编解码与非法输入
- `otpauth://` 与 Google Authenticator 迁移码解析
- 账户去重与规范化
- `chrome.storage` 存储路径（使用模拟 API）
- 网页验证码输入框识别与填充

测试二维码样例位于 `tests/fixtures/`。

### 项目结构

```text
.
├── manifest.json          # Manifest V3 扩展清单
├── popup.html             # 弹窗界面
├── src/
│   ├── popup.js           # 界面与交互逻辑
│   ├── popup.css          # 样式
│   ├── lib/
│   │   ├── base32.js      # Base32 编解码
│   │   ├── totp.js        # TOTP / HMAC 计算
│   │   ├── otpauth.js     # otpauth URI 解析
│   │   ├── migration.js   # Google Authenticator 迁移码解析
│   │   ├── accounts.js    # 账户规范化与去重
│   │   ├── storage.js     # chrome.storage / localStorage 封装
│   │   ├── qr-image.js    # 二维码图片解码
│   │   └── autofill.js    # 网页验证码输入框填充
│   └── vendor/
│       ├── jsQR.js        # 二维码解码库
│       └── jsQR.LICENSE
├── icons/                 # 16 / 32 / 48 / 128 像素图标
├── tests/                 # 单元测试与二维码样例
└── tools/                 # 图标与界面预览开发素材
```

### 已知限制

- 仅支持基于时间的一次性密码（TOTP），不支持计数器型 HOTP
- 不支持云同步或跨设备同步
- 自动填充仅能识别页面主文档中的输入框；部分使用 iframe、跨域组件或特殊交互的网站可能需要手动复制
- 网站自身对验证码格式的特殊要求（例如自动提交、分段输入框）可能影响填充效果，此时请使用复制功能

### 第三方组件

- [jsQR](https://github.com/cozmo/jsQR) 1.4.0，Apache License 2.0，许可证见 `src/vendor/jsQR.LICENSE`

---

## English

### Overview

TOTP Authenticator is a Manifest V3 Chrome extension for generating TOTP two-factor authentication codes. All codes are computed locally; the extension makes no network requests and does not require a cloud account. Accounts can be added manually, imported from QR codes or `otpauth://` links, or migrated from Google Authenticator.

### Features

- Multi-account management with search, edit, delete, and clear-all
- Algorithms: SHA-1 / SHA-256 / SHA-512
- Codes: 6 / 7 / 8 digits, 6 digits by default
- Period: 30 seconds by default, configurable from 1 to 600 seconds
- Live countdown ring with automatic refresh at period boundaries
- Click a code to copy it
- **Fill current page** detects and fills OTP inputs on the active page, falling back to copying the code when no input is found
- Import options:
  - Select, paste, or drag-and-drop a QR code image
  - Paste an `otpauth://totp/...` link
  - Scan a Google Authenticator migration QR code (`otpauth-migration://...`)
- JSON backup export and merge import with automatic duplicate skipping
- Keyboard shortcut: `Command/Ctrl + Shift + Y`
- Chinese UI, no build step, no third-party runtime dependencies beyond the bundled QR decoder

### Installation

1. Download or clone this repository
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the repository root (the directory containing `manifest.json`)
6. Optionally pin the extension to the toolbar

Manage the keyboard shortcut at `chrome://extensions/shortcuts`.

Requires Chrome 102 or later.

### Usage

**Add an account**

Open the extension from the toolbar and click **+**, then choose:

- **Scan QR**: select a QR image, or drag/paste it into the window. You can also paste an `otpauth://` or migration link and click **Parse and import**
- **Manual entry**: enter the secret and optionally the service name and account label. Use **Advanced options** to change the algorithm, digit count, and period

**Get a code**

- Click the code on an account card to copy it
- Open **More actions** → **Fill current page** to fill an OTP input on the active tab
- Open **More actions** → **Edit account** or **Delete account** to manage the entry

**Backup and migration**

Open **Settings** → **Backup & migration**:

- **Export**: downloads `totp-backup-YYYY-MM-DD.json`
- **Import**: merges a JSON backup and skips accounts that already exist

### Supported import formats

| Format | Notes |
| --- | --- |
| QR code image | The QR payload must be an `otpauth://` or `otpauth-migration://` link |
| `otpauth://totp/...` | Supports `secret`, `issuer`, `algorithm`, `digits`, and `period` parameters |
| `otpauth-migration://...` | Google Authenticator migration payload; TOTP accounts are imported |
| JSON backup | A backup exported by this extension; merged with duplicate skipping |

Duplicates are detected by **secret + algorithm + digits + period**. HOTP accounts are skipped during migration.

### Permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Store accounts and secrets locally in the browser |
| `activeTab` | Temporarily access the active tab only after the user clicks **Fill current page** |
| `scripting` | Inject the code-filling function into the active page after an explicit user action |

The extension requests no `host_permissions` and does not access web pages automatically in the background.

### Data and privacy

- No network requests; all codes are computed locally
- Secrets are stored in `chrome.storage.local` and are not synced to the cloud
- Browser local storage is not additionally encrypted; anyone with access to your Chrome profile may be able to read the secrets
- Exported JSON backups are **plaintext**. Do not share them or upload them to untrusted locations
- Clock drift can cause code verification failures; keep system time synchronization enabled

### Development and testing

The project uses plain JavaScript, ES Modules, and Manifest V3. No dependencies or build step are required.

**Preview in a browser**

```bash
cd /path/to/totp-helper
python3 -m http.server 8123
```

Then open `http://127.0.0.1:8123/popup.html`.

The preview uses `localStorage` instead of `chrome.storage` and cannot perform page autofill. Use the loaded extension for real behavior.

**Run unit tests**

Start the local server and open `http://127.0.0.1:8123/tests/unit.html`. The tests cover:

- RFC 6238 SHA-1 / SHA-256 / SHA-512 test vectors
- Base32 encoding/decoding and invalid input handling
- `otpauth://` and Google Authenticator migration parsing
- Account normalization and duplicate detection
- The `chrome.storage` path using a mock API
- OTP input detection and filling

Sample QR fixtures are in `tests/fixtures/`.

### Project structure

```text
.
├── manifest.json          # Manifest V3 extension manifest
├── popup.html             # Popup UI
├── src/
│   ├── popup.js           # UI and interaction logic
│   ├── popup.css          # Styles
│   ├── lib/
│   │   ├── base32.js      # Base32 encoding/decoding
│   │   ├── totp.js        # TOTP / HMAC computation
│   │   ├── otpauth.js     # otpauth URI parsing
│   │   ├── migration.js   # Google Authenticator migration parsing
│   │   ├── accounts.js    # Account normalization and deduplication
│   │   ├── storage.js     # chrome.storage / localStorage wrapper
│   │   ├── qr-image.js    # QR image decoding
│   │   └── autofill.js    # OTP input filling
│   └── vendor/
│       ├── jsQR.js        # QR decoder
│       └── jsQR.LICENSE
├── icons/                 # 16 / 32 / 48 / 128 px icons
├── tests/                 # Unit tests and QR fixtures
└── tools/                 # Icon and UI preview development assets
```

### Known limitations

- Time-based OTP (TOTP) only; counter-based HOTP is not supported
- No cloud or cross-device sync
- Autofill only targets inputs in the page's main document; sites using iframes, cross-origin components, or custom OTP widgets may require manual copying
- Site-specific OTP behavior (such as auto-submit or segmented inputs) may affect filling; use the copy action in those cases

### Third-party components

- [jsQR](https://github.com/cozmo/jsQR) 1.4.0, Apache License 2.0. See `src/vendor/jsQR.LICENSE`.
