import { Notice, Plugin } from "obsidian";
import type { Editor } from "obsidian";
import { ImageManager } from "./image-manager";
import { InputModal } from "./modals/input-modal";
import { NoteOps } from "./note-ops";
import { S3Client } from "./s3-client";
import { R2SettingTab } from "./settings";
import { DEFAULT_SETTINGS } from "./types";
import type { R2Settings } from "./types";
import { buildKey, getExtension } from "./utils";

export default class R2Uploader extends Plugin {
	settings: R2Settings = { ...DEFAULT_SETTINGS };
	client!: S3Client;
	noteOps!: NoteOps;

	async onload() {
		this.settings = {
			...DEFAULT_SETTINGS,
			...(await this.loadData()),
		};

		this.initModules();
		this.addSettingTab(new R2SettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("editor-paste", this.handlePaste.bind(this)),
		);

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

		this.addRibbonIcon("image-up", "R2 图片管理", () => {
			new ImageManager(this.app, this).open();
		});
	}

	onunload() {
		// registerEvent 自动清理
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.initModules();
	}

	private initModules() {
		this.client = new S3Client(this.settings);
		this.noteOps = new NoteOps(this.app);
	}

	// ── 粘贴上传 ─────────────────────────────

	private handlePaste(evt: ClipboardEvent, editor: Editor) {
		const data = evt.clipboardData;
		if (!data) return;

		let file: File | null =
			Array.from(data.files || []).find((f) => f.type.startsWith("image/")) ||
			null;

		if (!file) {
			for (const item of Array.from(data.items || [])) {
				if (item.type.startsWith("image/")) {
					file = item.getAsFile();
					break;
				}
			}
		}

		if (!file) return;

		evt.preventDefault();

		if (!this.isConfigured()) {
			new Notice("❌ 请先在设置中配置 R2 凭证");
			return;
		}

		const defaultName = `img-${Date.now()}`;
		new InputModal(this.app, "图片名称", defaultName, (name) => {
			if (!name) return;
			void this.doUpload(editor, file as File, name);
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

			new InputModal(this.app, "图片名称", `img-${Date.now()}`, (name) => {
				if (!name) return;
				void this.doUpload(editor, file, name);
			}).open();
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

	isConfigured(): boolean {
		return !!(
			this.settings.accountId &&
			this.settings.accessKeyId &&
			this.settings.secretAccessKey &&
			this.settings.bucketName &&
			this.settings.publicUrl
		);
	}
}
