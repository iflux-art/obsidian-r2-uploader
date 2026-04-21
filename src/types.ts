import type { TFile } from "obsidian";

/** 插件设置 */
export interface R2Settings {
	accountId: string; // Cloudflare Account ID
	accessKeyId: string; // S3 Access Key ID
	secretAccessKey: string; // S3 Secret Access Key
	bucketName: string;
	publicUrl: string; // 公共访问域名
	imagePrefix: string; // 上传目录前缀
}

export const DEFAULT_SETTINGS: R2Settings = {
	accountId: "",
	accessKeyId: "",
	secretAccessKey: "",
	bucketName: "",
	publicUrl: "",
	imagePrefix: "",
};

/** R2 对象元数据 */
export interface R2Object {
	key: string;
	size: number;
	etag: string;
	uploaded: string; // ISO 日期
}

/** 列表结果（分页） */
export interface ListResult {
	objects: R2Object[];
	cursor: string;
	truncated: boolean;
}

/** 笔记引用 */
export interface NoteRef {
	file: TFile;
	content: string;
}

/** 确认弹窗的操作类型 */
export type ConfirmAction = "cancel" | "rename-only" | "rename-replace";
