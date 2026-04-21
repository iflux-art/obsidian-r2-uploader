import { Modal, Notice, Setting } from "obsidian";
import type { App } from "obsidian";
import type R2Uploader from "./main";
import { ConfirmModal } from "./modals/confirm-modal";
import { InputModal } from "./modals/input-modal";
import type { R2Object } from "./types";
import { getFileName } from "./utils";

export class ImageManager extends Modal {
	private cursor = "";
	private loading = false;
	private listEl: HTMLElement | null = null;
	private searchEl: HTMLInputElement | null = null;
	private countEl: HTMLElement | null = null;
	private allObjects: R2Object[] = [];
	private selectedItems = new Set<string>();
	private selectMode = false;

	constructor(
		app: App,
		private plugin: R2Uploader,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("r2-manager");

		// 标题栏
		const header = contentEl.createDiv("r2-header");
		header.createEl("h2", { text: "R2 图片管理" });
		this.countEl = header.createSpan("r2-count");

		// 工具栏
		const toolbar = contentEl.createDiv("r2-toolbar");

		// 搜索框
		const searchWrap = toolbar.createDiv("r2-search-wrap");
		searchWrap.createSpan({ text: "🔍", cls: "r2-search-icon" });
		this.searchEl = searchWrap.createEl("input", {
			type: "text",
			placeholder: "搜索文件名...",
			cls: "r2-search-input",
		});
		this.searchEl.addEventListener("input", () => this.filterList());

		// 操作按钮组
		const toolbarActions = toolbar.createDiv("r2-toolbar-actions");
		const selectBtn = toolbarActions.createEl("button", {
			text: "☑️",
			cls: "r2-toolbar-btn",
			attr: { title: "批量选择" },
		});
		selectBtn.onclick = () => this.toggleSelectMode();

		const refreshBtn = toolbarActions.createEl("button", {
			text: "🔄",
			cls: "r2-toolbar-btn",
			attr: { title: "刷新" },
		});
		refreshBtn.onclick = () => {
			this.allObjects = [];
			this.cursor = "";
			this.selectedItems.clear();
			if (this.listEl) this.listEl.empty();
			void this.loadImages();
		};

		// 批量操作栏（隐藏，选择模式时显示）
		const batchBar = contentEl.createDiv("r2-batch-bar r2-hidden");
		const batchInfo = batchBar.createSpan("r2-batch-info");
		batchInfo.setText("已选择 0 项");
		const batchDeleteBtn = batchBar.createEl("button", {
			text: "🗑️ 批量删除",
			cls: "r2-batch-delete",
		});
		batchDeleteBtn.onclick = () => void this.handleBatchDelete();

		// 列表容器
		this.listEl = contentEl.createDiv("r2-manager-list");

		// 键盘事件
		this.scope.register([], "Escape", () => {
			if (
				this.searchEl &&
				this.searchEl ===
					this.app.workspace.containerEl.ownerDocument.activeElement
			) {
				this.searchEl.blur();
				return false;
			}
			this.close();
			return false;
		});
		this.scope.register(["Mod"], "f", () => {
			this.searchEl?.focus();
			return false;
		});

		void this.loadImages();
	}

	onClose() {
		this.contentEl.empty();
	}

	// ── 选择模式 ──────────────────────────────

	private toggleSelectMode() {
		this.selectMode = !this.selectMode;
		this.selectedItems.clear();
		this.contentEl.toggleClass("r2-select-mode", this.selectMode);
		const batchBar = this.contentEl.querySelector(".r2-batch-bar");
		if (batchBar) batchBar.toggleClass("r2-hidden", !this.selectMode);
		if (!this.selectMode) {
			for (const el of this.contentEl.querySelectorAll(".r2-checkbox")) {
				(el as HTMLInputElement).checked = false;
			}
			for (const el of this.contentEl.querySelectorAll(".r2-image-item")) {
				el.removeClass("r2-selected");
			}
		}
		this.updateBatchInfo();
	}

	private updateBatchInfo() {
		const info = this.contentEl.querySelector(".r2-batch-info");
		if (info) info.setText(`已选择 ${this.selectedItems.size} 项`);
	}

	private toggleItemSelect(key: string, itemEl: HTMLElement) {
		if (this.selectedItems.has(key)) {
			this.selectedItems.delete(key);
			itemEl.removeClass("r2-selected");
		} else {
			this.selectedItems.add(key);
			itemEl.addClass("r2-selected");
		}
		this.updateBatchInfo();
	}

	// ── 搜索过滤 ──────────────────────────────

	private filterList() {
		const query = (this.searchEl?.value ?? "").toLowerCase().trim();
		const items = this.contentEl.querySelectorAll(".r2-image-item");
		let visible = 0;
		for (const item of items) {
			const name = (
				item.querySelector(".r2-name")?.textContent ?? ""
			).toLowerCase();
			const path = (
				item.querySelector(".r2-path")?.textContent ?? ""
			).toLowerCase();
			const match = !query || name.includes(query) || path.includes(query);
			(item as HTMLElement).style.display = match ? "" : "none";
			if (match) visible++;
		}
		this.updateCount(visible, this.allObjects.length);
	}

	private updateCount(visible: number, total: number) {
		if (!this.countEl) return;
		if (visible === total) {
			this.countEl.setText(`${total} 张图片`);
		} else {
			this.countEl.setText(`${visible} / ${total} 张图片`);
		}
	}

	// ── 加载列表 ──────────────────────────────

	private async loadImages(append = false) {
		if (this.loading || !this.listEl) return;
		this.loading = true;

		if (!append) this.listEl.empty();
		const loadingEl = this.listEl.createDiv("r2-loading");
		loadingEl.createDiv("r2-spinner");
		loadingEl.createSpan({ text: "加载中..." });

		try {
			const result = await this.plugin.client.list(this.cursor);
			loadingEl.remove();

			if (!append && result.objects.length === 0) {
				const empty = this.listEl.createDiv("r2-empty");
				empty.createDiv("r2-empty-icon").setText("📭");
				empty.createDiv("r2-empty-text").setText("暂无图片");
				empty.createDiv("r2-empty-hint").setText("上传图片后会显示在这里");
				this.updateCount(0, 0);
				this.loading = false;
				return;
			}

			for (const obj of result.objects) {
				this.allObjects.push(obj);
				this.renderItem(obj);
			}
			this.cursor = result.cursor;
			this.updateCount(this.allObjects.length, this.allObjects.length);

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
			loadingEl.remove();
			const errorEl = this.listEl.createDiv("r2-error");
			errorEl.createDiv("r2-error-icon").setText("❌");
			errorEl.createDiv("r2-error-text").setText((e as Error).message);
		}

		this.loading = false;
	}

	// ── 渲染单个图片卡片 ─────────────────────

	private renderItem(obj: R2Object) {
		if (!this.listEl) return;

		const item = this.listEl.createDiv("r2-image-item");
		const name = getFileName(obj.key);
		const publicUrl = this.plugin.client.getPublicUrl(obj.key);
		const sizeKB = (obj.size / 1024).toFixed(1);
		const date = new Date(obj.uploaded).toLocaleDateString("zh-CN");

		// 批量选择复选框
		const checkbox = item.createEl("input", {
			type: "checkbox",
			cls: "r2-checkbox r2-hidden",
		});
		checkbox.addEventListener("change", () => {
			this.toggleItemSelect(obj.key, item);
		});

		// 预览图（可点击打开大图）
		const previewWrap = item.createDiv("r2-preview-wrap");
		const preview = previewWrap.createEl("img", { cls: "r2-preview" });
		preview.src = publicUrl;
		preview.alt = name;
		preview.onerror = () => {
			preview.alt = "❌";
			preview.style.opacity = "0.3";
		};
		previewWrap.onclick = () => {
			window.open(publicUrl, "_blank");
		};
		previewWrap.setAttr("title", "点击查看大图");

		// 信息
		const info = item.createDiv("r2-info");
		const nameEl = info.createDiv("r2-name");
		nameEl.setText(name);
		nameEl.setAttr("title", obj.key);
		info.createDiv("r2-path").setText(obj.key);
		info.createDiv("r2-meta").setText(`${sizeKB} KB · ${date}`);

		// 操作按钮
		const actions = item.createDiv("r2-actions");

		this.addActionBtn(actions, "📋", "复制 Markdown", () => {
			void navigator.clipboard.writeText(`![${name}](${publicUrl})`);
			new Notice("✅ 已复制 Markdown 链接");
		});

		this.addActionBtn(actions, "🔗", "复制 URL", () => {
			void navigator.clipboard.writeText(publicUrl);
			new Notice("✅ 已复制 URL");
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
		onClick: () => void,
	) {
		const btn = parent.createEl("button", {
			cls: "r2-btn",
			attr: { title, "aria-label": title },
		});
		btn.createSpan({ text: emoji });
		btn.onclick = onClick;
	}

	// ── 批量删除 ──────────────────────────────

	private async handleBatchDelete() {
		if (this.selectedItems.size === 0) {
			new Notice("请先选择要删除的图片");
			return;
		}

		const count = this.selectedItems.size;
		if (!confirm(`确定删除 ${count} 张图片？此操作不可撤销。`)) return;

		const notice = new Notice(`🗑️ 正在删除 ${count} 张图片...`, 0);
		let deleted = 0;
		let failed = 0;

		for (const key of this.selectedItems) {
			try {
				await this.plugin.client.delete(key);
				const itemEl = this.contentEl.querySelector(
					`.r2-image-item:has(.r2-path[title="${key}"], .r2-path)`,
				);
				// 查找并移除对应元素
				const allItems = this.contentEl.querySelectorAll(".r2-image-item");
				for (const el of allItems) {
					const pathEl = el.querySelector(".r2-path");
					if (pathEl?.textContent === key) {
						el.remove();
						break;
					}
				}
				this.allObjects = this.allObjects.filter((o) => o.key !== key);
				deleted++;
			} catch {
				failed++;
			}
		}

		this.selectedItems.clear();
		this.updateBatchInfo();
		this.updateCount(this.allObjects.length, this.allObjects.length);
		notice.hide();
		new Notice(
			`✅ 删除完成：${deleted} 成功${failed > 0 ? `，${failed} 失败` : ""}`,
		);
	}

	// ── 删除 ────────────────────────────────

	private async handleDelete(obj: R2Object, itemEl: HTMLElement) {
		const name = getFileName(obj.key);
		const publicUrl = this.plugin.client.getPublicUrl(obj.key);

		// 搜索引用
		const searchNotice = new Notice("🔍 正在搜索引用...", 0);
		const notes = await this.plugin.noteOps.findNotesContaining(publicUrl);
		searchNotice.hide();

		// 确认
		if (notes.length > 0) {
			const action = await new Promise<"cancel" | "clean" | "direct">(
				(resolve) => {
					const modal = new DeleteConfirmModal(
						this.app,
						name,
						notes.length,
						resolve,
					);
					modal.open();
				},
			);
			if (action === "cancel") return;
			if (action === "clean") {
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
			this.allObjects = this.allObjects.filter((o) => o.key !== obj.key);
			this.updateCount(this.allObjects.length, this.allObjects.length);
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

		const ext = oldName.includes(".")
			? (oldName.split(".").pop() ?? "png")
			: "png";
		const newKey = obj.key.replace(oldName, `${newName}.${ext}`);
		const newUrl = this.plugin.client.getPublicUrl(newKey);

		// 搜索引用
		const searchNotice = new Notice("🔍 正在搜索引用...", 0);
		const notes = await this.plugin.noteOps.findNotesContaining(oldUrl);
		searchNotice.hide();

		// 确认操作
		const action = await new Promise<
			"cancel" | "rename-only" | "rename-replace"
		>((resolve) => {
			new ConfirmModal(this.app, oldName, newName, notes, resolve).open();
		});
		if (action === "cancel") return;

		// 执行重命名（服务端 copy + delete）
		const renameNotice = new Notice("✏️ 正在重命名...", 0);
		try {
			await this.plugin.client.rename(obj.key, newKey);

			if (action === "rename-replace" && notes.length > 0) {
				const count = await this.plugin.noteOps.replaceUrlInNotes(
					notes,
					oldUrl,
					newUrl,
				);
				renameNotice.hide();
				new Notice(`✅ 重命名成功，已更新 ${count} 个笔记`);
			} else {
				renameNotice.hide();
				new Notice("✅ 重命名成功");
			}

			// 刷新列表
			if (this.listEl) this.listEl.empty();
			this.allObjects = [];
			this.cursor = "";
			await this.loadImages();
		} catch (e) {
			renameNotice.hide();
			new Notice(`❌ ${(e as Error).message}`);
		}
	}
}

// ── 删除确认弹窗 ─────────────────────────────

class DeleteConfirmModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private name: string,
		private refCount: number,
		private onSubmit: (action: "cancel" | "clean" | "direct") => void,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("r2-confirm-modal");
		contentEl.createEl("h2", { text: "确认删除" });
		contentEl.createEl("p", {
			text: `「${this.name}」被 ${this.refCount} 个笔记引用。`,
			cls: "r2-confirm-desc",
		});

		const btns = new Setting(contentEl);
		btns.addButton((b) =>
			b.setButtonText("取消").onClick(() => this.resolve("cancel")),
		);
		btns.addButton((b) =>
			b.setButtonText("仅删除").onClick(() => this.resolve("direct")),
		);
		btns.addButton((b) =>
			b
				.setButtonText("删除并清理引用")
				.setCta()
				.onClick(() => this.resolve("clean")),
		);
	}

	private resolve(action: "cancel" | "clean" | "direct") {
		if (this.resolved) return;
		this.resolved = true;
		this.onSubmit(action);
		this.close();
	}

	onClose() {
		if (!this.resolved) {
			this.resolved = true;
			this.onSubmit("cancel");
		}
		this.contentEl.empty();
	}
}
