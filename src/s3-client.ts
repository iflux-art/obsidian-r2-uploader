import { requestUrl } from "obsidian";
import type { ListResult, R2Settings } from "./types";

/**
 * Cloudflare R2 S3 兼容 API 客户端
 * 使用 AWS Signature V4 签名认证
 */
export class S3Client {
	private endpoint: string;

	constructor(private settings: R2Settings) {
		this.endpoint = `https://${settings.accountId}.r2.cloudflarestorage.com`;
	}

	// ── HMAC-SHA256 ──────────────────────────

	private async hmac(
		key: ArrayBuffer | Uint8Array,
		message: string,
	): Promise<ArrayBuffer> {
		const keyBuffer = key instanceof Uint8Array ? key : new Uint8Array(key);
		const cryptoKey = await crypto.subtle.importKey(
			"raw",
			keyBuffer as unknown as BufferSource,
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		return crypto.subtle.sign(
			"HMAC",
			cryptoKey,
			new TextEncoder().encode(message),
		);
	}

	// ── SHA256 hex ───────────────────────────

	private async sha256Hex(data: string | ArrayBuffer): Promise<string> {
		const buf =
			typeof data === "string"
				? new TextEncoder().encode(data)
				: new Uint8Array(data);
		const hash = await crypto.subtle.digest("SHA-256", buf);
		return Array.from(new Uint8Array(hash))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	// ── ArrayBuffer → hex ────────────────────

	private toHex(buf: ArrayBuffer): string {
		return Array.from(new Uint8Array(buf))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	// ── 签名请求 ─────────────────────────────
	// fullPath: 完整路径含 query，如 /images?list-type=2&max-keys=5

	private async sign(
		method: string,
		fullPath: string,
		body: string,
		contentType: string,
	): Promise<Record<string, string>> {
		const now = new Date();
		const amzDate = `${now.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
		const dateStamp = amzDate.substring(0, 8);
		const region = "auto";
		const service = "s3";
		const host = new URL(this.endpoint).host;

		// 拆分 path 和 query
		const qIdx = fullPath.indexOf("?");
		const canonicalUri = qIdx >= 0 ? fullPath.substring(0, qIdx) : fullPath;
		const canonicalQuery = qIdx >= 0 ? fullPath.substring(qIdx + 1) : "";

		const payloadHash = await this.sha256Hex(body);

		// Canonical headers (必须排序)
		const headerEntries: [string, string][] = [
			["host", host],
			["x-amz-content-sha256", payloadHash],
			["x-amz-date", amzDate],
		];
		if (contentType) {
			headerEntries.push(["content-type", contentType]);
		}
		headerEntries.sort((a, b) => a[0].localeCompare(b[0]));

		const canonicalHeaders = headerEntries
			.map(([k, v]) => `${k}:${v.trim()}\n`)
			.join("");
		const signedHeaders = headerEntries.map(([k]) => k).join(";");

		// Canonical request
		const canonicalRequest = [
			method.toUpperCase(),
			canonicalUri,
			canonicalQuery,
			canonicalHeaders,
			signedHeaders,
			payloadHash,
		].join("\n");

		// String to sign
		const scope = `${dateStamp}/${region}/${service}/aws4_request`;
		const stringToSign = [
			"AWS4-HMAC-SHA256",
			amzDate,
			scope,
			await this.sha256Hex(canonicalRequest),
		].join("\n");

		// Signing key
		const kDate = await this.hmac(
			new TextEncoder().encode(`AWS4${this.settings.secretAccessKey}`),
			dateStamp,
		);
		const kRegion = await this.hmac(kDate, region);
		const kService = await this.hmac(kRegion, service);
		const kSigning = await this.hmac(kService, "aws4_request");
		const signature = this.toHex(await this.hmac(kSigning, stringToSign));

		const authorization =
			`AWS4-HMAC-SHA256 Credential=${this.settings.accessKeyId}/${scope}, ` +
			`SignedHeaders=${signedHeaders}, Signature=${signature}`;

		const headers: Record<string, string> = {
			Authorization: authorization,
			"x-amz-date": amzDate,
			"x-amz-content-sha256": payloadHash,
		};
		if (contentType) {
			headers["Content-Type"] = contentType;
		}
		return headers;
	}

	// ── 列出对象 ─────────────────────────────

	async list(cursor = "", limit = 100): Promise<ListResult> {
		const params = new URLSearchParams({
			"list-type": "2",
			"max-keys": String(limit),
		});
		if (this.settings.imagePrefix) {
			params.set("prefix", this.settings.imagePrefix);
		}
		if (cursor) {
			params.set("continuation-token", cursor);
		}

		const path = `/${this.settings.bucketName}?${params}`;
		const headers = await this.sign("GET", path, "", "");
		const url = `${this.endpoint}${path}`;

		const res = await requestUrl({ url, method: "GET", headers });

		if (res.status !== 200) {
			throw new Error(`获取列表失败: ${res.status} - ${res.text}`);
		}

		const text = res.text;
		const objects = this.parseListResult(text);
		const isTruncated = text.includes("<IsTruncated>true</IsTruncated>");
		const nextToken = isTruncated
			? this.xmlValue(text, "NextContinuationToken")
			: "";

		return {
			objects,
			cursor: nextToken,
			truncated: isTruncated,
		};
	}

	private parseListResult(xml: string): Array<{
		key: string;
		size: number;
		etag: string;
		uploaded: string;
	}> {
		const items: Array<{
			key: string;
			size: number;
			etag: string;
			uploaded: string;
		}> = [];
		const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
		let match: RegExpExecArray | null = contentsRegex.exec(xml);
		while (match !== null) {
			const block = match[1];
			items.push({
				key: this.xmlValue(block, "Key"),
				size: Number.parseInt(this.xmlValue(block, "Size") || "0", 10),
				etag: this.xmlValue(block, "ETag").replace(/"/g, ""),
				uploaded: this.xmlValue(block, "LastModified"),
			});
			match = contentsRegex.exec(xml);
		}
		return items;
	}

	private xmlValue(xml: string, tag: string): string {
		const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
		return match ? match[1] : "";
	}

	// ── 上传对象 ─────────────────────────────

	async put(
		key: string,
		body: ArrayBuffer,
		contentType: string,
	): Promise<void> {
		const path = `/${this.settings.bucketName}/${key}`;

		// 用原始二进制数据计算 hash 并签名
		const headers = await this.signWithBinaryBody(
			"PUT",
			path,
			body,
			contentType,
		);
		const url = `${this.endpoint}${path}`;

		// 直接发送 ArrayBuffer（S3 期望原始二进制）
		const res = await requestUrl({
			url,
			method: "PUT",
			headers,
			body,
		});

		if (res.status !== 200 && res.status !== 201) {
			throw new Error(`上传失败: ${res.status} - ${res.text}`);
		}
	}

	/** 使用二进制 body 签名 */
	private async signWithBinaryBody(
		method: string,
		fullPath: string,
		body: ArrayBuffer,
		contentType: string,
	): Promise<Record<string, string>> {
		const now = new Date();
		const amzDate = `${now.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
		const dateStamp = amzDate.substring(0, 8);
		const region = "auto";
		const service = "s3";
		const host = new URL(this.endpoint).host;

		const qIdx = fullPath.indexOf("?");
		const canonicalUri = qIdx >= 0 ? fullPath.substring(0, qIdx) : fullPath;
		const canonicalQuery = qIdx >= 0 ? fullPath.substring(qIdx + 1) : "";

		// 直接对 ArrayBuffer 计算 SHA256
		const hashBuf = await crypto.subtle.digest("SHA-256", new Uint8Array(body));
		const payloadHash = Array.from(new Uint8Array(hashBuf))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");

		const headerEntries: [string, string][] = [
			["content-type", contentType],
			["host", host],
			["x-amz-content-sha256", payloadHash],
			["x-amz-date", amzDate],
		];
		headerEntries.sort((a, b) => a[0].localeCompare(b[0]));

		const canonicalHeaders = headerEntries
			.map(([k, v]) => `${k}:${v.trim()}\n`)
			.join("");
		const signedHeaders = headerEntries.map(([k]) => k).join(";");

		const canonicalRequest = [
			method.toUpperCase(),
			canonicalUri,
			canonicalQuery,
			canonicalHeaders,
			signedHeaders,
			payloadHash,
		].join("\n");

		const scope = `${dateStamp}/${region}/${service}/aws4_request`;
		const stringToSign = [
			"AWS4-HMAC-SHA256",
			amzDate,
			scope,
			await this.sha256Hex(canonicalRequest),
		].join("\n");

		const kDate = await this.hmac(
			new TextEncoder().encode(`AWS4${this.settings.secretAccessKey}`),
			dateStamp,
		);
		const kRegion = await this.hmac(kDate, region);
		const kService = await this.hmac(kRegion, service);
		const kSigning = await this.hmac(kService, "aws4_request");
		const signature = this.toHex(await this.hmac(kSigning, stringToSign));

		return {
			Authorization:
				`AWS4-HMAC-SHA256 Credential=${this.settings.accessKeyId}/${scope}, ` +
				`SignedHeaders=${signedHeaders}, Signature=${signature}`,
			"Content-Type": contentType,
			"x-amz-date": amzDate,
			"x-amz-content-sha256": payloadHash,
		};
	}

	// ── 删除对象 ─────────────────────────────

	async delete(key: string): Promise<void> {
		const path = `/${this.settings.bucketName}/${key}`;
		const headers = await this.sign("DELETE", path, "", "");
		const url = `${this.endpoint}${path}`;

		const res = await requestUrl({
			url,
			method: "DELETE",
			headers,
		});

		if (res.status !== 200 && res.status !== 204) {
			throw new Error(`删除失败: ${res.status} - ${res.text}`);
		}
	}

	// ── 复制对象 ─────────────────────────────

	async copy(srcKey: string, destKey: string): Promise<void> {
		const path = `/${this.settings.bucketName}/${destKey}`;
		const copySource = `/${this.settings.bucketName}/${srcKey}`;

		const headers = await this.sign("PUT", path, "", "");
		headers["x-amz-copy-source"] = copySource;

		const url = `${this.endpoint}${path}`;

		const res = await requestUrl({
			url,
			method: "PUT",
			headers,
			body: "",
		});

		if (res.status !== 200) {
			throw new Error(`复制失败: ${res.status} - ${res.text}`);
		}
	}

	// ── 重命名 ───────────────────────────────

	async rename(oldKey: string, newKey: string): Promise<void> {
		await this.copy(oldKey, newKey);
		await this.delete(oldKey);
	}

	// ── 公共 URL ─────────────────────────────

	getPublicUrl(key: string): string {
		const base = this.settings.publicUrl.replace(/\/+$/, "");
		return `${base}/${key}`;
	}
}
