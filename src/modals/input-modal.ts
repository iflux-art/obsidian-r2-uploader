import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";

type InputCallback = (value: string | null) => void;

export class InputModal extends Modal {
	private result: string;
	private submitted = false;
	private onSubmit: InputCallback;

	constructor(
		app: App,
		private title: string,
		private defaultValue: string,
		onSubmit: InputCallback,
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
					this.resolve(null);
				}),
			)
			.addButton((b) =>
				b
					.setButtonText("确认")
					.setCta()
					.onClick(() => this.submit()),
			);
	}

	private submit() {
		this.resolve(this.result || this.defaultValue);
	}

	private resolve(value: string | null) {
		if (this.submitted) return;
		this.submitted = true;
		this.onSubmit(value);
		this.close();
	}

	onClose() {
		if (!this.submitted) {
			this.submitted = true;
			this.onSubmit(null);
		}
		this.contentEl.empty();
	}
}
