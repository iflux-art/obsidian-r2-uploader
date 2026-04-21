import type { App } from "obsidian";
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

	/** 替换笔记中的 URL，返回更新的笔记数 */
	async replaceUrlInNotes(
		notes: NoteRef[],
		oldUrl: string,
		newUrl: string,
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

	/** 删除笔记中引用指定 URL 的 markdown 图片语法，返回更新的笔记数 */
	async removeImageRefs(notes: NoteRef[], url: string): Promise<number> {
		let count = 0;
		const escaped = this.escapeRegex(url);

		for (const note of notes) {
			// 匹配 ![任意内容](url)，替换为空行
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
