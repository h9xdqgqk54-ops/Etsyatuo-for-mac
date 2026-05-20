import type { GroupRequestFile } from "./types.js";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export function parseJsonBody<T>(body: Buffer): T {
  return JSON.parse(body.toString("utf-8")) as T;
}

export function parseMultipartImages(contentType: string, body: Buffer): GroupRequestFile[] {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) throw new Error("multipart boundary missing");

  const delimiter = `--${boundary}`;
  const raw = body.toString("binary");
  const parts = raw.split(delimiter).slice(1, -1);
  const files: GroupRequestFile[] = [];

  for (const part of parts) {
    const clean = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const splitIndex = clean.indexOf("\r\n\r\n");
    if (splitIndex < 0) continue;
    const headerText = clean.slice(0, splitIndex);
    const contentBinary = clean.slice(splitIndex + 4);
    const disposition = headerText.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] ?? "";
    const name = disposition.match(/name="([^"]+)"/i)?.[1] ?? "";
    if (name !== "images") continue;
    const fileIndex = files.length + 1;
    const contentTypeHeader = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() ?? "application/octet-stream";
    if (!ALLOWED_MIME.has(contentTypeHeader)) continue;
    const ext = allowedExtension("", contentTypeHeader);
    if (!ext) continue;
    const safeFileName = `product-${fileIndex}${ext}`;
    files.push({
      fileName: safeFileName,
      relativePath: safeFileName,
      mimeType: contentTypeHeader,
      data: Buffer.from(contentBinary, "binary"),
    });
  }

  return files;
}

function allowedExtension(ext: string, mimeType: string): string | undefined {
  if (ALLOWED_EXT.has(ext)) return ext;
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return undefined;
}

export function validateImageMagic(file: GroupRequestFile): boolean {
  const b = file.data;
  if (b.length < 12) return false;
  const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const isJpeg = b[0] === 0xff && b[1] === 0xd8;
  const isGif = b.slice(0, 3).toString("ascii") === "GIF";
  const isWebp = b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP";
  return isPng || isJpeg || isGif || isWebp;
}
