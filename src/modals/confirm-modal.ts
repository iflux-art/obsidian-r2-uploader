import { Modal, Setting } from "obsidian";
import type { App, TFile } from "obsidian";
import type { ConfirmAction } from "../types";

interface NoteInfo {
	file: TFile;
}

type ConfirmCallback = (action: ConfirmAction) => void;

export class ConfirmModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private oldName: string,
		private newName: string,
		private notes: NoteInfo[],
		private onSubmit: ConfirmCallback,
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
			b.setButtonText("取消").onClick(() => this.resolve("cancel")),
		);

		if (this.notes.length > 0) {
			btns.addButton((b) =>
				b.setButtonText("仅重命名").onClick(() => this.resolve("rename-only")),
			);
			btns.addButton((b) =>
				b
					.setButtonText("重命名并替换")
					.setCta()
					.onClick(() => this.resolve("rename-replace")),
			);
		} else {
			btns.addButton((b) =>
				b
					.setButtonText("确认")
					.setCta()
					.onClick(() => this.resolve("rename-only")),
			);
		}
	}

	private resolve(action: ConfirmAction) {
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
