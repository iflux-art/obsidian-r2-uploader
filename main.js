/**
 * Obsidian R2 Uploader
 * 粘贴图片自动上传到 Cloudflare R2
 * 
 * 功能：
 * - Ctrl+V 粘贴图片 → 自动上传 → 插入 markdown 链接
 * - 侧边栏图片管理：查看、复制、重命名、删除
 * - 重命名自动搜索并替换笔记中的旧链接
 */

const { Plugin, Modal, Setting, Notice, PluginSettingTab, requestUrl } = require('obsidian');

// ==================== 默认配置 ====================

const DEFAULT_SETTINGS = {
  accountId: '',
  accessKeyId: '',
  secretAccessKey: '',
  cloudflareToken: '',
  bucketName: '',
  publicUrl: '',
  imagePrefix: '',
};

// ==================== 主插件 ====================

module.exports = class R2Uploader extends Plugin {
  async onload() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
    this.addSettingTab(new R2SettingsTab(this.app, this));

    // 粘贴事件
    this.registerEvent(this.app.workspace.on('editor-paste', this.handlePaste.bind(this)));

    // 命令
    this.addCommand({ id: 'r2-upload', name: '上传图片到 R2', callback: () => this.triggerUpload() });
    this.addCommand({ id: 'r2-manage', name: 'R2 图片管理', callback: () => this.openManager() });

    // 侧边栏图标
    this.addRibbonIcon('image', 'R2 图片管理', () => this.openManager());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ==================== 上传 ====================

  handlePaste(evt, editor) {
    const data = evt.clipboardData;
    if (!data) return;

    // 从 files 或 items 获取图片
    let file = Array.from(data.files || []).find(f => f.type.startsWith('image/'));
    if (!file) {
      for (const item of Array.from(data.items || [])) {
        if (item.type.startsWith('image/')) { file = item.getAsFile(); break; }
      }
    }
    if (!file) return;

    evt.preventDefault();
    if (!this.isConfigured()) { new Notice('❌ 请先配置 R2 凭证'); return; }

    const defaultName = `img-${Date.now()}`;
    new InputModal(this.app, '图片名称', defaultName, async (name) => {
      if (!name) return;
      const notice = new Notice('📤 正在上传...', 0);
      try {
        const url = await this.upload(file, name, this.getExt(file.type));
        editor.replaceSelection(`![${name}](${url})`);
        notice.hide();
        new Notice('✅ 上传成功');
      } catch (e) {
        notice.hide();
        new Notice(`❌ ${e.message}`);
      }
    }).open();
  }

  triggerUpload() {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) { new Notice('❌ 请先打开笔记'); return; }
    if (!this.isConfigured()) { new Notice('❌ 请先配置 R2 凭证'); return; }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      new InputModal(this.app, '图片名称', `img-${Date.now()}`, async (name) => {
        if (!name) return;
        const notice = new Notice('📤 正在上传...', 0);
        try {
          const url = await this.upload(file, name, this.getExt(file.type));
          editor.replaceSelection(`![${name}](${url})`);
          notice.hide();
          new Notice('✅ 上传成功');
        } catch (e) {
          notice.hide();
          new Notice(`❌ ${e.message}`);
        }
      }).open();
    };
    input.click();
  }

  async upload(file, name, ext) {
    const { accountId, cloudflareToken, bucketName, publicUrl, imagePrefix } = this.settings;
    const key = imagePrefix ? `${imagePrefix}/${name}.${ext}` : `${name}.${ext}`;
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`;
    await requestUrl({
      url,
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${cloudflareToken}`, 'Content-Type': file.type },
      body: await file.arrayBuffer(),
    });
    return `${publicUrl}/${key}`;
  }

  // ==================== 图片管理 ====================

  openManager() {
    if (!this.isConfigured()) { new Notice('❌ 请先配置 R2 凭证'); return; }
    new ImageManager(this.app, this).open();
  }

  async listImages(cursor = '') {
    const { accountId, cloudflareToken, bucketName, imagePrefix } = this.settings;
    let url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects`;
    url += `?prefix=${encodeURIComponent(imagePrefix ? imagePrefix + '/' : '')}&limit=100`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    const res = await requestUrl({ url, headers: { Authorization: `Bearer ${cloudflareToken}` } });
    const data = res.json;
    const objects = Array.isArray(data.result) ? data.result : (data.result?.objects || []);

    return {
      items: objects.map(o => ({ key: o.key, size: o.size, lastModified: o.last_modified })),
      cursor: data.result?.cursor || '',
      truncated: data.result?.truncated || false,
    };
  }

  async deleteImage(key) {
    const { accountId, cloudflareToken, bucketName } = this.settings;
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`;
    await requestUrl({ url, method: 'DELETE', headers: { Authorization: `Bearer ${cloudflareToken}` } });
  }

  async renameImage(oldKey, newKey) {
    const { accountId, cloudflareToken, bucketName } = this.settings;
    const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects`;

    // 下载
    const downloadRes = await requestUrl({
      url: `${base}/${encodeURIComponent(oldKey)}`,
      headers: { 'Authorization': `Bearer ${cloudflareToken}` },
    });
    const contentType = downloadRes.headers['content-type'] || 'image/png';
    const body = downloadRes.arrayBuffer;

    // 上传
    await requestUrl({
      url: `${base}/${encodeURIComponent(newKey)}`,
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${cloudflareToken}`, 'Content-Type': contentType },
      body,
    });

    // 删除
    await this.deleteImage(oldKey);
  }

  // ==================== 笔记引用 ====================

  async findNotesUsingUrl(url) {
    const files = this.app.vault.getMarkdownFiles();
    const matched = [];
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      if (content.includes(url)) matched.push({ file, content });
    }
    return matched;
  }

  async replaceUrlInNotes(notes, oldUrl, newUrl) {
    let count = 0;
    for (const { file, content } of notes) {
      const newContent = content.replaceAll(oldUrl, newUrl);
      if (newContent !== content) {
        await this.app.vault.modify(file, newContent);
        count++;
      }
    }
    return count;
  }

  // ==================== 工具方法 ====================

  isConfigured() {
    return this.settings.accountId && this.settings.accessKeyId && this.settings.cloudflareToken;
  }

  getExt(mime) {
    return { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[mime] || 'png';
  }
}

// ==================== 图片管理面板 ====================

class ImageManager extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.cursor = '';
    this.loading = false;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('r2-manager');
    contentEl.createEl('h2', { text: 'R2 图片管理' });
    this.listEl = contentEl.createDiv('r2-manager-list');
    this.loadImages();
  }

  async loadImages(append = false) {
    if (this.loading) return;
    this.loading = true;

    if (!append) this.listEl.empty();
    const loading = this.listEl.createDiv('r2-loading');
    loading.setText('加载中...');

    try {
      const result = await this.plugin.listImages(this.cursor);
      loading.remove();

      if (!append && result.items.length === 0) {
        this.listEl.createDiv('r2-empty').setText('暂无图片');
        this.loading = false;
        return;
      }

      for (const img of result.items) this.renderItem(img);
      this.cursor = result.cursor;

      if (result.truncated) {
        const btn = this.listEl.createEl('button', { text: '加载更多...', cls: 'r2-load-more' });
        btn.onclick = () => { btn.remove(); this.loadImages(true); };
      }
    } catch (e) {
      loading.setText(`❌ ${e.message}`);
    }

    this.loading = false;
  }

  renderItem(img) {
    const item = this.listEl.createDiv('r2-image-item');
    const name = img.key.split('/').pop();
    const publicUrl = `${this.plugin.settings.publicUrl}/${img.key}`;
    const sizeKB = (img.size / 1024).toFixed(1);
    const date = new Date(img.lastModified).toLocaleDateString('zh-CN');

    // 预览
    const preview = item.createEl('img', { cls: 'r2-preview' });
    preview.src = publicUrl;
    preview.alt = name;
    preview.onerror = () => { preview.alt = '❌'; preview.style.opacity = '0.3'; };

    // 信息
    const info = item.createDiv('r2-info');
    info.createDiv('r2-name').setText(name);
    info.createDiv('r2-path').setText(img.key);
    info.createDiv('r2-meta').setText(`${sizeKB} KB · ${date}`);

    // 操作
    const actions = item.createDiv('r2-actions');

    actions.createEl('button', { text: '📋', cls: 'r2-btn', attr: { title: '复制 markdown' } })
      .onclick = () => {
        navigator.clipboard.writeText(`![${name}](${publicUrl})`);
        new Notice('✅ 已复制');
      };

    actions.createEl('button', { text: '🔗', cls: 'r2-btn', attr: { title: '复制 URL' } })
      .onclick = () => {
        navigator.clipboard.writeText(publicUrl);
        new Notice('✅ 已复制');
      };

    actions.createEl('button', { text: '✏️', cls: 'r2-btn', attr: { title: '重命名' } })
      .onclick = () => this.handleRename(img, item);

    actions.createEl('button', { text: '🗑️', cls: 'r2-btn r2-btn-danger', attr: { title: '删除' } })
      .onclick = async () => {
        if (!confirm(`确定删除 ${name} ？`)) return;
        try {
          await this.plugin.deleteImage(img.key);
          item.remove();
          new Notice('✅ 已删除');
        } catch (e) {
          new Notice(`❌ ${e.message}`);
        }
      };
  }

  async handleRename(img, itemEl) {
    const oldName = img.key.split('/').pop();
    const oldUrl = `${this.plugin.settings.publicUrl}/${img.key}`;

    // 输入新名称
    const newName = await new Promise(resolve => {
      new InputModal(this.app, '重命名', oldName.replace(/\.[^.]+$/, ''), resolve).open();
    });
    if (!newName || newName === oldName.replace(/\.[^.]+$/, '')) return;

    const ext = oldName.split('.').pop();
    const newKey = img.key.replace(oldName, `${newName}.${ext}`);
    const newUrl = `${this.plugin.settings.publicUrl}/${newKey}`;

    // 搜索引用
    const notice = new Notice('🔍 正在搜索引用...', 0);
    const notes = await this.plugin.findNotesUsingUrl(oldUrl);
    notice.hide();

    // 确认
    const shouldReplace = await new Promise(resolve => {
      new ConfirmModal(this.app, oldName, newName, notes, resolve).open();
    });
    if (shouldReplace === null) return;

    // 执行重命名
    const renameNotice = new Notice('✏️ 正在重命名...', 0);
    try {
      await this.plugin.renameImage(img.key, newKey);
      if (notes.length > 0 && shouldReplace) {
        const count = await this.plugin.replaceUrlInNotes(notes, oldUrl, newUrl);
        renameNotice.hide();
        new Notice(`✅ 重命名成功，已更新 ${count} 个笔记`);
      } else {
        renameNotice.hide();
        new Notice('✅ 重命名成功');
      }
      this.listEl.empty();
      this.cursor = '';
      this.loadImages();
    } catch (e) {
      renameNotice.hide();
      new Notice(`❌ ${e.message}`);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ==================== 输入弹窗 ====================

class InputModal extends Modal {
  constructor(app, title, defaultValue, onSubmit) {
    super(app);
    this.title = title;
    this.defaultValue = defaultValue;
    this.onSubmit = onSubmit;
    this.result = defaultValue;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: this.title });

    new Setting(contentEl)
      .setName('名称')
      .addText((text) => {
        text
          .setPlaceholder('输入名称...')
          .setValue(this.defaultValue)
          .onChange((v) => { this.result = v.trim(); });
        setTimeout(() => text.inputEl.select(), 50);
      });

    const btns = new Setting(contentEl);
    btns.addButton((b) => b.setButtonText('取消').onClick(() => { this.onSubmit(null); this.close(); }));
    btns.addButton((b) => b.setButtonText('确认').setCta().onClick(() => { this.onSubmit(this.result || this.defaultValue); this.close(); }));

    contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.onSubmit(this.result || this.defaultValue); this.close(); }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ==================== 确认弹窗 ====================

class ConfirmModal extends Modal {
  constructor(app, oldName, newName, matchedNotes, resolve) {
    super(app);
    this.oldName = oldName;
    this.newName = newName;
    this.matchedNotes = matchedNotes;
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: '确认重命名' });
    contentEl.createEl('p', { text: `${this.oldName} → ${this.newName}` });

    if (this.matchedNotes.length > 0) {
      contentEl.createEl('p', { text: `以下 ${this.matchedNotes.length} 个笔记引用了此图片：` });
      const list = contentEl.createEl('ul', { cls: 'r2-rename-notes' });
      for (const { file } of this.matchedNotes) {
        list.createEl('li').setText(file.path);
      }
    } else {
      contentEl.createEl('p', { text: '没有笔记引用此图片', cls: 'r2-rename-empty' });
    }

    const btns = new Setting(contentEl);
    btns.addButton((b) => b.setButtonText('取消').onClick(() => { this.resolve(null); this.close(); }));

    if (this.matchedNotes.length > 0) {
      btns.addButton((b) => b.setButtonText('仅重命名').onClick(() => { this.resolve(false); this.close(); }));
      btns.addButton((b) => b.setButtonText('重命名并替换').setCta().onClick(() => { this.resolve(true); this.close(); }));
    } else {
      btns.addButton((b) => b.setButtonText('确认').setCta().onClick(() => { this.resolve(false); this.close(); }));
    }
  }

  onClose() {
    this.resolve(null);
    this.contentEl.empty();
  }
}

// ==================== 设置面板 ====================

class R2SettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Cloudflare R2 配置' });

    const fields = [
      { key: 'accountId', name: 'Account ID', desc: 'Cloudflare 账户 ID', ph: '3792fd7e...' },
      { key: 'accessKeyId', name: 'Access Key ID', desc: 'R2 S3 Access Key（上传用）', ph: 'R2 Access Key' },
      { key: 'secretAccessKey', name: 'Secret Access Key', desc: 'R2 S3 Secret Key（上传用）', ph: 'R2 Secret Key', pw: true },
      { key: 'cloudflareToken', name: 'Cloudflare API Token', desc: 'API Token（列表/删除用）', ph: 'cfut_...', pw: true },
      { key: 'bucketName', name: 'Bucket', desc: 'R2 存储桶名称', ph: 'blog' },
      { key: 'publicUrl', name: 'Public URL', desc: '图片公开访问域名', ph: 'https://bk.iflux.art' },
      { key: 'imagePrefix', name: '路径前缀', desc: '上传路径前缀', ph: 'blog' },
    ];

    for (const f of fields) {
      const setting = new Setting(containerEl)
        .setName(f.name)
        .setDesc(f.desc)
        .addText((t) => {
          if (f.pw) t.inputEl.type = 'password';
          t.setPlaceholder(f.ph)
            .setValue(this.plugin.settings[f.key])
            .onChange(async (v) => {
              this.plugin.settings[f.key] = v.trim();
              await this.plugin.saveSettings();
            });
        });
    }

    containerEl.createEl('h3', { text: '使用方法' });
    containerEl.createEl('p', { text: '• 粘贴图片 (Ctrl+V) → 命名 → 上传 → 插入链接' });
    containerEl.createEl('p', { text: '• 侧边栏 🖼️ → 图片管理（查看/复制/重命名/删除）' });
    containerEl.createEl('p', { text: '• 重命名自动搜索并替换笔记中的旧链接' });

    containerEl.createEl('h3', { text: 'R2 配置说明' });
    containerEl.createEl('p', { text: '1. Cloudflare Dashboard → R2 → 创建存储桶' });
    containerEl.createEl('p', { text: '2. R2 → 管理 R2 API 令牌 → 创建 S3 凭证' });
    containerEl.createEl('p', { text: '3. 个人资料 → API 令牌 → 创建自定义令牌（R2 Storage Edit 权限）' });
    containerEl.createEl('p', { text: '4. R2 → 存储桶 → 设置 → CORS → 允许 * 的 GET/PUT/DELETE' });
  }
}
