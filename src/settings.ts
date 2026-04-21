import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import type R2Uploader from "./main";

export class R2SettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: R2Uploader,
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
					}),
			);

		// Access Key ID
		new Setting(containerEl)
			.setName("Access Key ID")
			.setDesc("R2 → 管理 R2 API 令牌 → 创建 S3 凭证后获得")
			.addText((t) =>
				t
					.setPlaceholder("b462a44e...")
					.setValue(this.plugin.settings.accessKeyId)
					.onChange(async (v) => {
						this.plugin.settings.accessKeyId = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		// Secret Access Key
		new Setting(containerEl)
			.setName("Secret Access Key")
			.setDesc("S3 凭证的机密访问密钥")
			.addText((t) => {
				t.inputEl.type = "password";
				t.setPlaceholder("20a9a389...")
					.setValue(this.plugin.settings.secretAccessKey)
					.onChange(async (v) => {
						this.plugin.settings.secretAccessKey = v.trim();
						await this.plugin.saveSettings();
					});
			});

		// Bucket Name
		new Setting(containerEl)
			.setName("存储桶名称")
			.setDesc("R2 中的存储桶名称")
			.addText((t) =>
				t
					.setPlaceholder("images")
					.setValue(this.plugin.settings.bucketName)
					.onChange(async (v) => {
						this.plugin.settings.bucketName = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		// Public URL
		new Setting(containerEl)
			.setName("自定义域")
			.setDesc("绑定到 R2 存储桶的自定义域名")
			.addText((t) =>
				t
					.setPlaceholder("https://img.example.com")
					.setValue(this.plugin.settings.publicUrl)
					.onChange(async (v) => {
						this.plugin.settings.publicUrl = v.trim();
						await this.plugin.saveSettings();
					}),
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
					}),
			);

		// 测试连接
		new Setting(containerEl)
			.setName("测试连接")
			.setDesc("验证 S3 凭证和存储桶配置是否正确")
			.addButton((b) =>
				b.setButtonText("测试").onClick(async () => {
					b.setButtonText("测试中...");
					b.setDisabled(true);
					try {
						await this.plugin.client.list("", 1);
						new Notice("✅ 连接成功");
					} catch (e) {
						new Notice(`❌ ${(e as Error).message}`, 8000);
					}
					b.setButtonText("测试");
					b.setDisabled(false);
				}),
			);

		// 使用说明
		containerEl.createEl("h3", { text: "使用方法" });
		containerEl.createEl("p", {
			text: "• 粘贴图片 (Ctrl+V) → 输入名称 → 自动上传并插入链接",
		});
		containerEl.createEl("p", {
			text: "• 命令面板 → 「上传图片到 R2」→ 选择文件 → 上传",
		});
		containerEl.createEl("p", {
			text: "• 侧边栏图标 → 图片管理（查看/复制/重命名/删除）",
		});

		// R2 配置说明
		containerEl.createEl("h3", { text: "R2 配置步骤" });
		containerEl.createEl("p", {
			text: "1. Cloudflare → R2 → 概览 → 创建存储桶",
		});
		containerEl.createEl("p", {
			text: "2. R2 → 管理 R2 API 令牌 → 创建 S3 凭证",
		});
		containerEl.createEl("p", {
			text: "3. 复制 Access Key ID 和 Secret Access Key 填入上方",
		});
		containerEl.createEl("p", {
			text: "4. 存储桶 → 设置 → 公开访问 → 连接自定义域",
		});
	}
}
