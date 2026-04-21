# Obsidian R2 Uploader 重写计划

## 目标
彻底重写 obsidian-r2-uploader 插件，符合 Obsidian 官方插件开发规范和 Cloudflare R2 最佳实践。

## 架构
- **R2 操作**：统一使用 Cloudflare REST API + Bearer Token
- **文件结构**：职责分离，main.ts 只管生命周期
- **错误处理**：统一错误类，Notice 提示
- **生命周期**：完整 onload/onunload，事件自动清理

## 文件结构
```
obsidian-r2-uploader/
├── src/
│   ├── main.ts              # 插件入口（仅生命周期 + 命令注册）
│   ├── types.ts             # 类型定义
│   ├── r2-client.ts         # R2 REST API 封装
│   ├── note-ops.ts          # 笔记搜索/替换操作
│   ├── settings.ts          # 设置面板
│   ├── image-manager.ts     # 图片管理 Modal
│   ├── modals/
│   │   ├── input-modal.ts   # 输入弹窗
│   │   └── confirm-modal.ts # 确认弹窗
│   └── utils.ts             # 工具函数
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── styles.css
├── LICENSE                  # MIT
└── .gitignore
```

---

## 任务清单

### Task 1: 清理旧文件 + 建立新骨架

**目标**：删除旧源码，创建新的类型定义和工具函数

**操作**：
- 删除 `src/` 下所有旧文件
- 重写 `types.ts`、`utils.ts`

**types.ts**：
```typescript
// 类型定义
export interface R2Settings {
  accountId: string;
  apiToken: string;       // Cloudflare API Token（Bearer）
  bucketName: string;
  publicUrl: string;      // 公共访问域名
  imagePrefix: string;    // 上传目录前缀
}

export const DEFAULT_SETTINGS: R2Settings = {
  accountId: "",
  apiToken: "",
  bucketName: "",
  publicUrl: "",
  imagePrefix: "",
};

export interface R2Object {
  key: string;
  size: number;
  etag: string;
  uploaded: string;       // ISO 日期
}

export interface ListResult {
  objects: R2Object[];
  cursor: string;
  truncated: boolean;
}

export interface NoteRef {
  file: TFile;
  content: string;
}
```

**utils.ts**：
```typescript
// 工具函数

/** ArrayBuffer → base64，用于 requestUrl body */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** base64 → ArrayBuffer */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** MIME → 扩展名 */
const MIME_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

export function getExtension(mime: string): string {
  return MIME_MAP[mime] || "png";
}

/** 从 key 中提取文件名 */
export function getFileName(key: string): string {
  return key.split("/").pop() || key;
}

/** 生成安全的 R2 key */
export function buildKey(name: string, ext: string, prefix: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9\-_]/g, "-");
  const fileName = `${safeName}-${Date.now()}.${ext}`;
  return prefix ? `${prefix}/${fileName}` : fileName;
}
```

---

### Task 2: R2 API 客户端

**目标**：封装所有 R2 REST API 调用

**创建**：`src/r2-client.ts`

```typescript
import { requestUrl } from "obsidian";
import type { R2Object, ListResult, R2Settings } from "./types";
import { arrayBufferToBase64 } from "./utils";

const API_BASE = "https://api.cloudflare.com/client/v4";

export class R2Client {
  constructor(private settings: R2Settings) {}

  /** 构建 API URL */
  private url(path: string): string {
    return `${API_BASE}/accounts/${this.settings.accountId}/r2/buckets/${this.settings.bucketName}${path}`;
  }

  /** 统一请求头 */
  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.settings.apiToken}`,
      ...extra,
    };
  }

  /** 统一错误解析 */
  private async checkError(response: { status: number; text: string }, action: string): Promise<void> {
    if (response.status >= 200 && response.status < 300) return;
    let msg = `${action}失败: ${response.status}`;
    try {
      const body = JSON.parse(response.text);
      if (body.errors?.[0]?.message) {
        msg += ` - ${body.errors[0].message}`;
      }
    } catch {
      // 非 JSON 响应，用原始文本
      if (response.text) msg += ` - ${response.text}`;
    }
    throw new Error(msg);
  }

  /** 列出对象（分页） */
  async list(cursor = "", limit = 100): Promise<ListResult> {
    const params = new URLSearchParams({ per_page: String(limit) });
    if (cursor) params.set("cursor", cursor);

    const res = await requestUrl({
      url: `${this.url("/objects")}?${params}`,
      method: "GET",
      headers: this.headers(),
    });
    await this.checkError(res, "获取列表");

    const data = JSON.parse(res.text);
    return {
      objects: (data.result || []).map((obj: Record<string, unknown>) => ({
        key: obj.key as string,
        size: obj.size as number,
        etag: obj.etag as string,
        uploaded: obj.uploaded as string,
      })),
      cursor: data.cursors?.next || "",
      truncated: !!data.cursors?.next,
    };
  }

  /** 上传对象 */
  async put(key: string, body: ArrayBuffer, contentType: string): Promise<void> {
    const res = await requestUrl({
      url: this.url(`/objects/${encodeURIComponent(key)}`),
      method: "PUT",
      headers: this.headers({ "Content-Type": contentType }),
      body: arrayBufferToBase64(body),
    });
    await this.checkError(res, "上传");
  }

  /** 删除对象 */
  async delete(key: string): Promise<void> {
    const res = await requestUrl({
      url: this.url(`/objects/${encodeURIComponent(key)}`),
      method: "DELETE",
      headers: this.headers(),
    });
    await this.checkError(res, "删除");
  }

  /** 复制对象（服务端 copy） */
  async copy(srcKey: string, destKey: string): Promise<void> {
    const res = await requestUrl({
      url: this.url(`/objects/${encodeURIComponent(destKey)}`),
      method: "PUT",
      headers: this.headers({
        "Content-Type": "application/octet-stream",
        "X-Amz-Copy-Source": `/${this.settings.bucketName}/${encodeURIComponent(srcKey)}`,
      }),
      body: "", // copy 不需要 body
    });
    await this.checkError(res, "复制");
  }

  /** 重命名 = copy + delete */
  async rename(oldKey: string, newKey: string): Promise<void> {
    await this.copy(oldKey, newKey);
    await this.delete(oldKey);
  }

  /** 获取公共 URL */
  getPublicUrl(key: string): string {
    const base = this.settings.publicUrl.replace(/\/+$/, "");
    return `${base}/${key}`;
  }
}
```

---

### Task 3: 笔记操作模块

**目标**：封装笔记搜索和 URL 替换逻辑

**创建**：`src/note-ops.ts`

```typescript
import type { App, TFile } from "obsidian";
import type { NoteRef } from "./types";

export class NoteOps {
  constructor(private app: App) {}

  /** 搜索包含指定 URL 的所有笔记 */
  async findNotesContaining(url: string): Promise<NoteRef[]> {
    const files = this.app.vault.getMarkdownFiles();
    const results: NoteRef[] = [];

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      if (content.includes(url)) {
        results.push({ file, content });
      }
    }
    return results;
  }

  /** 替换笔记中的 URL */
  async replaceUrlInNotes(
    notes: NoteRef[],
    oldUrl: string,
    newUrl: string
  ): Promise<number> {
    let count = 0;
    for (const note of notes) {
      const updated = note.content.split(oldUrl).join(newUrl);
      if (updated !== note.content) {
        await this.app.vault.modify(note.file, updated);
        count++;
      }
    }
    return count;
  }

  /** 删除笔记中引用指定 URL 的 markdown 图片语法 */
  async removeImageRefs(notes: NoteRef[], url: string): Promise<number> {
    let count = 0;
    const escaped = this.escapeRegex(url);

    for (const note of notes) {
      // 匹配 ![任意内容](url) 及其前后可能的空行
      const pattern = new RegExp(`\\n?!\\[.*?\\]\\(${escaped}\\)\\n?`, "g");
      const updated = note.content.replace(pattern, "\n");
      if (updated !== note.content) {
        await this.app.vault.modify(note.file, updated);
        count++;
      }
    }
    return count;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
```

---

### Task 4: 输入弹窗和确认弹窗

**目标**：创建可复用的 Modal 组件

**创建**：`src/modals/input-modal.ts`

```typescript
import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";

type InputCallback = (value: string | null) => void;

export class InputModal extends Modal {
  private result: string;
  private onSubmit: InputCallback;

  constructor(
    app: App,
    private title: string,
    private defaultValue: string,
    onSubmit: InputCallback
  ) {
    super(app);
    this.result = defaultValue;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.title });

    new Setting(contentEl).setName("名称").addText((text) => {
      text
        .setPlaceholder("输入名称...")
        .setValue(this.defaultValue)
        .onChange((v) => {
          this.result = v.trim();
        });
      // 自动选中文本
      setTimeout(() => text.inputEl.select(), 50);

      // Enter 提交
      text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.submit();
        }
      });
    });

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("取消").onClick(() => {
          this.onSubmit(null);
          this.close();
        })
      )
      .addButton((b) =>
        b.setButtonText("确认").setCta().onClick(() => this.submit())
      );
  }

  private submit() {
    this.onSubmit(this.result || this.defaultValue);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
```

**创建**：`src/modals/confirm-modal.ts`

```typescript
import { Modal, Setting } from "obsidian";
import type { App, TFile } from "obsidian";

interface NoteInfo {
  file: TFile;
}

type ConfirmCallback = (action: "cancel" | "rename-only" | "rename-replace") => void;

export class ConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private oldName: string,
    private newName: string,
    private notes: NoteInfo[],
    private onSubmit: ConfirmCallback
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "确认重命名" });
    contentEl.createEl("p", { text: `${this.oldName} → ${this.newName}` });

    if (this.notes.length > 0) {
      contentEl.createEl("p", {
        text: `以下 ${this.notes.length} 个笔记引用了此图片：`,
      });
      const list = contentEl.createEl("ul", { cls: "r2-rename-notes" });
      for (const { file } of this.notes) {
        list.createEl("li").setText(file.path);
      }
    } else {
      contentEl.createEl("p", {
        text: "没有笔记引用此图片",
        cls: "r2-rename-empty",
      });
    }

    const btns = new Setting(contentEl);
    btns.addButton((b) =>
      b.setButtonText("取消").onClick(() => this.resolve("cancel"))
    );

    if (this.notes.length > 0) {
      btns.addButton((b) =>
        b.setButtonText("仅重命名").onClick(() => this.resolve("rename-only"))
      );
      btns.addButton((b) =>
        b.setButtonText("重命名并替换").setCta().onClick(() => this.resolve("rename-replace"))
      );
    } else {
      btns.addButton((b) =>
        b.setButtonText("确认").setCta().onClick(() => this.resolve("rename-only"))
      );
    }
  }

  private resolve(action: "cancel" | "rename-only" | "rename-replace") {
    if (this.resolved) return;
    this.resolved = true;
    this.onSubmit(action);
    this.close();
  }

  onClose() {
    // 如果用户直接关闭弹窗（如按 Esc），视为取消
    if (!this.resolved) {
      this.resolved = true;
      this.onSubmit("cancel");
    }
    this.contentEl.empty();
  }
}
```

---

### Task 5: 图片管理面板

**目标**：重写 ImageManager，完善所有操作

**创建**：`src/image-manager.ts`

```typescript
import { Modal, Notice } from "obsidian";
import type { App } from "obsidian";
import type R2Uploader from "./main";
import type { R2Object } from "./types";
import { ConfirmModal } from "./modals/confirm-modal";
import { InputModal } from "./modals/input-modal";
import { getFileName } from "./utils";

export class ImageManager extends Modal {
  private cursor = "";
  private loading = false;
  private listEl: HTMLElement | null = null;

  constructor(
    app: App,
    private plugin: R2Uploader
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("r2-manager");
    contentEl.createEl("h2", { text: "R2 图片管理" });
    this.listEl = contentEl.createDiv("r2-manager-list");
    void this.loadImages();
  }

  onClose() {
    this.contentEl.empty();
  }

  private async loadImages(append = false) {
    if (this.loading || !this.listEl) return;
    this.loading = true;

    if (!append) this.listEl.empty();
    const loadingEl = this.listEl.createDiv("r2-loading");
    loadingEl.setText("加载中...");

    try {
      const result = await this.plugin.client.list(this.cursor);
      loadingEl.remove();

      if (!append && result.objects.length === 0) {
        this.listEl.createDiv("r2-empty").setText("暂无图片");
        this.loading = false;
        return;
      }

      for (const obj of result.objects) {
        this.renderItem(obj);
      }
      this.cursor = result.cursor;

      if (result.truncated) {
        const btn = this.listEl.createEl("button", {
          text: "加载更多...",
          cls: "r2-load-more",
        });
        btn.onclick = () => {
          btn.remove();
          void this.loadImages(true);
        };
      }
    } catch (e) {
      loadingEl.setText(`❌ ${(e as Error).message}`);
    }

    this.loading = false;
  }

  private renderItem(obj: R2Object) {
    if (!this.listEl) return;

    const item = this.listEl.createDiv("r2-image-item");
    const name = getFileName(obj.key);
    const publicUrl = this.plugin.client.getPublicUrl(obj.key);
    const sizeKB = (obj.size / 1024).toFixed(1);
    const date = new Date(obj.uploaded).toLocaleDateString("zh-CN");

    // 预览图
    const preview = item.createEl("img", { cls: "r2-preview" });
    preview.src = publicUrl;
    preview.alt = name;
    preview.onerror = () => {
      preview.alt = "❌";
      preview.style.opacity = "0.3";
    };

    // 信息
    const info = item.createDiv("r2-info");
    info.createDiv("r2-name").setText(name);
    info.createDiv("r2-path").setText(obj.key);
    info.createDiv("r2-meta").setText(`${sizeKB} KB · ${date}`);

    // 操作按钮
    const actions = item.createDiv("r2-actions");

    this.addActionBtn(actions, "📋", "复制 markdown", () => {
      void navigator.clipboard.writeText(`![${name}](${publicUrl})`);
      new Notice("✅ 已复制");
    });

    this.addActionBtn(actions, "🔗", "复制 URL", () => {
      void navigator.clipboard.writeText(publicUrl);
      new Notice("✅ 已复制");
    });

    this.addActionBtn(actions, "✏️", "重命名", () => {
      void this.handleRename(obj, item);
    });

    this.addActionBtn(actions, "🗑️", "删除", () => {
      void this.handleDelete(obj, item);
    });
  }

  private addActionBtn(
    parent: HTMLElement,
    emoji: string,
    title: string,
    onClick: () => void
  ) {
    parent
      .createEl("button", {
        text: emoji,
        cls: "r2-btn",
        attr: { title, "aria-label": title },
      })
      .onclick = onClick;
  }

  // ── 删除 ────────────────────────────────

  private async handleDelete(obj: R2Object, itemEl: HTMLElement) {
    const name = getFileName(obj.key);
    const publicUrl = this.plugin.client.getPublicUrl(obj.key);

    // 先搜索引用
    const notice = new Notice("🔍 正在搜索引用...", 0);
    const notes = await this.plugin.noteOps.findNotesContaining(publicUrl);
    notice.hide();

    // 确认
    if (notes.length > 0) {
      // 有引用笔记 — 用 ConfirmModal
      const action = await new Promise<"cancel" | "delete-only" | "delete-cleanup">((resolve) => {
        // 复用 ConfirmModal 风格，这里简化为 confirm
        const msg = `${name} 被 ${notes.length} 个笔记引用。\n\n选择「仅删除」会留下死链。\n选择「删除并清理」会移除笔记中的图片引用。`;
        // 临时用 Notice + confirm，后续可优化为专用 Modal
        if (confirm(msg + "\n\n确定要删除吗？")) {
          resolve("delete-cleanup");
        } else {
          resolve("cancel");
        }
      });

      if (action === "cancel") return;

      if (action === "delete-cleanup") {
        await this.plugin.noteOps.removeImageRefs(notes, publicUrl);
      }
    } else {
      if (!confirm(`确定删除 ${name}？`)) return;
    }

    // 执行删除
    const delNotice = new Notice("🗑️ 正在删除...", 0);
    try {
      await this.plugin.client.delete(obj.key);
      itemEl.remove();
      delNotice.hide();
      new Notice("✅ 已删除");
    } catch (e) {
      delNotice.hide();
      new Notice(`❌ ${(e as Error).message}`);
    }
  }

  // ── 重命名 ──────────────────────────────

  private async handleRename(obj: R2Object, itemEl: HTMLElement) {
    const oldName = getFileName(obj.key);
    const oldUrl = this.plugin.client.getPublicUrl(obj.key);

    // 输入新名称
    const baseName = oldName.replace(/\.[^.]+$/, "");
    const newName = await new Promise<string | null>((resolve) => {
      new InputModal(this.app, "重命名", baseName, resolve).open();
    });
    if (!newName || newName === baseName) return;

    const ext = oldName.includes(".") ? oldName.split(".").pop()! : "png";
    const newKey = obj.key.replace(oldName, `${newName}.${ext}`);
    const newUrl = this.plugin.client.getPublicUrl(newKey);

    // 搜索引用
    const searchNotice = new Notice("🔍 正在搜索引用...", 0);
    const notes = await this.plugin.noteOps.findNotesContaining(oldUrl);
    searchNotice.hide();

    // 确认操作
    const action = await new Promise<"cancel" | "rename-only" | "rename-replace">((resolve) => {
      new ConfirmModal(this.app, oldName, newName, notes, resolve).open();
    });
    if (action === "cancel") return;

    // 执行重命名
    const renameNotice = new Notice("✏️ 正在重命名...", 0);
    try {
      // 服务端 copy + delete
      await this.plugin.client.rename(obj.key, newKey);

      // 替换笔记引用
      if (action === "rename-replace" && notes.length > 0) {
        const count = await this.plugin.noteOps.replaceUrlInNotes(notes, oldUrl, newUrl);
        renameNotice.hide();
        new Notice(`✅ 重命名成功，已更新 ${count} 个笔记`);
      } else {
        renameNotice.hide();
        new Notice("✅ 重命名成功");
      }

      // 刷新列表
      if (this.listEl) this.listEl.empty();
      this.cursor = "";
      await this.loadImages();
    } catch (e) {
      renameNotice.hide();
      new Notice(`❌ ${(e as Error).message}`);
    }
  }
}
```

---

### Task 6: 设置面板

**目标**：清理设置，只保留必要字段

**创建**：`src/settings.ts`

```typescript
import { PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import type R2Uploader from "./main";

export class R2SettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: R2Uploader
  ) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Cloudflare R2 配置" });

    // Account ID
    new Setting(containerEl)
      .setName("Account ID")
      .setDesc("Cloudflare 仪表盘右上角可复制")
      .addText((t) =>
        t
          .setPlaceholder("3792fd7e...")
          .setValue(this.plugin.settings.accountId)
          .onChange(async (v) => {
            this.plugin.settings.accountId = v.trim();
            await this.plugin.saveSettings();
          })
      );

    // API Token
    new Setting(containerEl)
      .setName("API Token")
      .setDesc("Cloudflare → R2 → 管理 R2 API 令牌 → 创建令牌（需 Object Read & Write 权限）")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("cfat_...")
          .setValue(this.plugin.settings.apiToken)
          .onChange(async (v) => {
            this.plugin.settings.apiToken = v.trim();
            await this.plugin.saveSettings();
          });
      });

    // Bucket Name
    new Setting(containerEl)
      .setName("存储桶名称")
      .setDesc("R2 中的存储桶名称")
      .addText((t) =>
        t
          .setPlaceholder("blog")
          .setValue(this.plugin.settings.bucketName)
          .onChange(async (v) => {
            this.plugin.settings.bucketName = v.trim();
            await this.plugin.saveSettings();
          })
      );

    // Public URL
    new Setting(containerEl)
      .setName("自定义域")
      .setDesc("绑定到 R2 存储桶的自定义域名，如 https://bk.iflux.art")
      .addText((t) =>
        t
          .setPlaceholder("https://img.example.com")
          .setValue(this.plugin.settings.publicUrl)
          .onChange(async (v) => {
            this.plugin.settings.publicUrl = v.trim();
            await this.plugin.saveSettings();
          })
      );

    // Image Prefix
    new Setting(containerEl)
      .setName("上传目录")
      .setDesc("上传到存储桶的子目录，留空则上传到根目录")
      .addText((t) =>
        t
          .setPlaceholder("images")
          .setValue(this.plugin.settings.imagePrefix)
          .onChange(async (v) => {
            this.plugin.settings.imagePrefix = v.trim();
            await this.plugin.saveSettings();
          })
      );

    // 使用说明
    containerEl.createEl("h3", { text: "使用方法" });
    containerEl.createEl("p", { text: "• 粘贴图片 (Ctrl+V) → 输入名称 → 自动上传并插入链接" });
    containerEl.createEl("p", { text: "• 命令面板 → 「上传图片到 R2」→ 选择文件 → 上传" });
    containerEl.createEl("p", { text: "• 侧边栏图标 → 图片管理（查看/复制/重命名/删除）" });

    // R2 配置说明
    containerEl.createEl("h3", { text: "R2 配置步骤" });
    containerEl.createEl("p", { text: "1. Cloudflare Dashboard → R2 → 创建存储桶" });
    containerEl.createEl("p", { text: "2. R2 → 管理 R2 API 令牌 → 创建令牌" });
    containerEl.createEl("p", { text: "3. 权限选择「Object Read & Write」，限定到你的存储桶" });
    containerEl.createEl("p", { text: "4. 将 Account ID 和 API Token 填入上方" });
    containerEl.createEl("p", { text: "5. 设置 → 公开访问 → 连接自定义域（或启用 r2.dev 子域名）" });
  }
}
```

---

### Task 7: 主插件入口

**目标**：精简 main.ts，只有生命周期和命令注册

**创建**：`src/main.ts`

```typescript
import { Notice, Plugin } from "obsidian";
import type { Editor } from "obsidian";
import { R2Client } from "./r2-client";
import { NoteOps } from "./note-ops";
import { ImageManager } from "./image-manager";
import { InputModal } from "./modals/input-modal";
import { R2SettingTab } from "./settings";
import { buildKey, getExtension } from "./utils";
import { DEFAULT_SETTINGS } from "./types";
import type { R2Settings } from "./types";

export default class R2Uploader extends Plugin {
  settings: R2Settings = { ...DEFAULT_SETTINGS };
  client!: R2Client;
  noteOps!: NoteOps;

  async onload() {
    // 加载设置
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(await this.loadData()),
    };

    // 初始化模块
    this.initModules();

    // 注册设置面板
    this.addSettingTab(new R2SettingTab(this.app, this));

    // 注册粘贴事件（使用 registerEvent 自动清理）
    this.registerEvent(
      this.app.workspace.on("editor-paste", this.handlePaste.bind(this))
    );

    // 注册命令
    this.addCommand({
      id: "r2-upload",
      name: "上传图片到 R2",
      callback: () => this.triggerUpload(),
    });

    this.addCommand({
      id: "r2-manage",
      name: "R2 图片管理",
      callback: () => new ImageManager(this.app, this).open(),
    });

    // 侧边栏图标
    this.addRibbonIcon("image-up", "R2 图片管理", () => {
      new ImageManager(this.app, this).open();
    });
  }

  onunload() {
    // registerEvent 会自动清理 editor-paste 监听器
    // Ribbon icon 由 Obsidian 自动管理
    // 无需手动清理
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.initModules();
  }

  /** 初始化/重初始化 R2 客户端和笔记操作 */
  private initModules() {
    this.client = new R2Client(this.settings);
    this.noteOps = new NoteOps(this.app);
  }

  // ── 粘贴上传 ─────────────────────────────

  private handlePaste(evt: ClipboardEvent, editor: Editor) {
    const data = evt.clipboardData;
    if (!data) return;

    // 从 files 或 items 中找图片
    let file: File | null =
      Array.from(data.files || []).find((f) => f.type.startsWith("image/")) || null;

    if (!file) {
      for (const item of Array.from(data.items || [])) {
        if (item.type.startsWith("image/")) {
          file = item.getAsFile();
          break;
        }
      }
    }

    if (!file) return; // 不是图片，交给 Obsidian 默认处理

    evt.preventDefault();

    if (!this.isConfigured()) {
      new Notice("❌ 请先在设置中配置 R2 凭证");
      return;
    }

    const defaultName = `img-${Date.now()}`;
    new InputModal(this.app, "图片名称", defaultName, (name) => {
      if (!name) return;
      void this.doUpload(editor, file!, name);
    }).open();
  }

  // ── 命令上传 ──────────────────────────────

  private triggerUpload() {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) {
      new Notice("❌ 请先打开一个笔记");
      return;
    }
    if (!this.isConfigured()) {
      new Notice("❌ 请先在设置中配置 R2 凭证");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      new InputModal(
        this.app,
        "图片名称",
        `img-${Date.now()}`,
        (name) => {
          if (!name) return;
          void this.doUpload(editor, file, name);
        }
      ).open();
    };
    input.click();
  }

  // ── 上传执行 ──────────────────────────────

  private async doUpload(editor: Editor, file: File, name: string) {
    const notice = new Notice("📤 正在上传...", 0);
    try {
      const ext = getExtension(file.type);
      const key = buildKey(name, ext, this.settings.imagePrefix);
      const body = await file.arrayBuffer();

      await this.client.put(key, body, file.type);
      const url = this.client.getPublicUrl(key);

      editor.replaceSelection(`![${name}](${url})`);
      notice.hide();
      new Notice("✅ 上传成功");
    } catch (e) {
      notice.hide();
      new Notice(`❌ ${(e as Error).message}`);
    }
  }

  // ── 工具方法 ──────────────────────────────

  private isConfigured(): boolean {
    return !!(
      this.settings.accountId &&
      this.settings.apiToken &&
      this.settings.bucketName &&
      this.settings.publicUrl
    );
  }
}
```

---

### Task 8: 配置文件更新

**目标**：更新 package.json、manifest.json、tsconfig.json、LICENSE

**manifest.json**：
```json
{
  "id": "obsidian-r2-uploader",
  "name": "R2 Image Uploader",
  "version": "2.0.0",
  "minAppVersion": "0.15.0",
  "description": "粘贴图片自动上传到 Cloudflare R2，支持图片管理、重命名、批量替换链接",
  "author": "iFluxArt",
  "isDesktopOnly": false,
  "fundingUrl": ""
}
```

**package.json** — scripts 更新：
```json
{
  "name": "obsidian-r2-uploader",
  "version": "2.0.0",
  "description": "Obsidian plugin for Cloudflare R2 image uploads",
  "scripts": {
    "dev": "node esbuild.config.mjs --watch",
    "build": "node esbuild.config.mjs",
    "lint": "biome check src/",
    "lint:fix": "biome check --fix src/",
    "format": "biome format --write src/",
    "version": "node version-bump.mjs && git add manifest.json versions.json"
  },
  "keywords": ["obsidian", "cloudflare", "r2", "image", "upload"],
  "author": "iFluxArt",
  "license": "MIT",
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "esbuild": "^0.21.5",
    "obsidian": "^1.6.6",
    "typescript": "^5.5.3"
  }
}
```

**LICENSE** (MIT)：
```
MIT License

Copyright (c) 2026 iFluxArt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

### Task 9: 构建验证

**操作**：
```bash
cd /mnt/c/project/obsidian/obsidian-r2-uploader
pnpm install
pnpm build
pnpm lint
```

**检查**：
- `dist/main.js` 生成成功
- `dist/manifest.json` 和 `dist/styles.css` 已复制
- lint 无错误
- 文件大小合理（< 50KB）
