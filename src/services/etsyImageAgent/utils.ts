import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

export function hashBuffer(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function slugify(input: string, fallback = "product"): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return slug || fallback;
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function safeJoin(root: string, candidate: string): string {
  const normalized = path.normalize(candidate).replace(/^(\.\.[/\\])+/, "");
  const resolved = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (!resolved.startsWith(rootResolved)) {
    throw new Error("Unsafe path rejected");
  }
  return resolved;
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export function safeDisplayName(input: string | undefined, fallback: string): string {
  const cleaned = (input ?? "").trim().replace(/\s+/g, " ");
  if (!cleaned || isLikelyMojibake(cleaned)) return fallback;
  return cleaned;
}

export function isLikelyMojibake(input: string): boolean {
  if (input.includes("\uFFFD")) return true;
  const suspicious = input.match(/[ÃÂ�]|â€|â€“|â€”|å|æ|ç|ä¸|äº|ã/g);
  return (suspicious?.length ?? 0) >= 2;
}

export function tokensFromPath(filePath: string): string[] {
  return filePath
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[\/\\_\-\s()[\].]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .filter((t) => !["img", "image", "photo", "pic", "copy", "front", "side", "back", "detail", "main", "角度", "主图"].includes(t));
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
