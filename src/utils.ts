/** MIME → 扩展名映射 */
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

/** MIME 类型 → 文件扩展名 */
export function getExtension(mime: string): string {
	return MIME_MAP[mime] || "png";
}

/** 从 key 中提取文件名 */
export function getFileName(key: string): string {
	return key.split("/").pop() || key;
}

/** 生成安全的 R2 key */
export function buildKey(name: string, ext: string, prefix: string): string {
	const safeName = name.replace(/[^a-zA-Z0-9\-_.\u4e00-\u9fff]/g, "-");
	const fileName = `${safeName}.${ext}`;
	return prefix ? `${prefix.replace(/\/+$/, "")}/${fileName}` : fileName;
}

/** ArrayBuffer → base64（用于 requestUrl body） */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}
