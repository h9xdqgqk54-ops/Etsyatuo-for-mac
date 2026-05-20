import * as fs from "node:fs";
import * as path from "node:path";
import { getAssetStorage } from "./assetStorage.js";
import { etsyAgentConfig } from "./config.js";
import { getImageInfo } from "./imageProcessing.js";
import type { GroupRequestFile, ProductGroup, UploadedImage } from "./types.js";
import { ensureDir, hashBuffer, makeId, nowIso, safeDisplayName, safeJoin, slugify, stripExt, tokensFromPath } from "./utils.js";
import { validateImageMagic } from "./uploadParser.js";

export async function saveAndGroupUploads(files: GroupRequestFile[]): Promise<{ taskId: string; groups: ProductGroup[]; images: UploadedImage[] }> {
  if (files.length === 0) throw new Error("请上传至少一张商品图片。");
  if (files.length > etsyAgentConfig.maxUploadImages) {
    throw new Error(`单次最多上传 ${etsyAgentConfig.maxUploadImages} 张图片。`);
  }

  const taskId = makeId("task");
  const uploadDir = safeJoin(etsyAgentConfig.storageRoot, `originals/${taskId}`);
  ensureDir(uploadDir);
  const storage = getAssetStorage();

  const images: UploadedImage[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    if (file.data.length > etsyAgentConfig.maxUploadBytes) {
      throw new Error(`${file.fileName} 超过单图大小限制。`);
    }
    if (!validateImageMagic(file)) {
      throw new Error(`${file.fileName} 不是受支持的图片格式。`);
    }
    const ext = extensionForMime(file.mimeType, file.fileName);
    const stem = slugify(stripExt(file.fileName), `image-${i + 1}`);
    const storedPath = path.join(uploadDir, `${String(i + 1).padStart(3, "0")}-${stem}${ext}`);
    const stored = await storage.saveOriginal({
      data: file.data,
      localPath: storedPath,
      contentType: file.mimeType,
      blobPath: `etsy-agent/originals/${taskId}/${String(i + 1).padStart(3, "0")}-${stem}${ext}`,
    });
    const info = await getImageInfo(storedPath);
    if (!info.width || !info.height) {
      await fs.promises.unlink(storedPath).catch(() => undefined);
      throw new Error(`${file.fileName} 无法解码为有效图片。`);
    }
    images.push({
      id: makeId("img"),
      originalFileName: file.fileName,
      relativePath: file.relativePath || file.fileName,
      storedPath: stored.storedPath,
      publicUrl: stored.publicUrl,
      mimeType: file.mimeType,
      sizeBytes: file.data.length,
      width: info.width,
      height: info.height,
      hash: hashBuffer(file.data),
      perceptualKey: info.perceptualKey,
      createdAt: nowIso(),
    });
  }

  return { taskId, groups: groupUploadedImages(images), images };
}

export function groupUploadedImages(images: UploadedImage[]): ProductGroup[] {
  const buckets = new Map<string, UploadedImage[]>();
  for (const image of images) {
    const key = groupKeyForImage(image);
    const arr = buckets.get(key) ?? [];
    arr.push(image);
    buckets.set(key, arr);
  }

  const groups = Array.from(buckets.entries()).map(([key, bucket], index) => {
    const nameTokens = tokensFromPath(bucket[0]?.relativePath ?? bucket[0]?.originalFileName ?? key);
    const confidence = confidenceForBucket(bucket);
    return {
      id: makeId("product"),
      displayName: safeDisplayName(nameTokens.slice(0, 4).join(" "), `product-${index + 1}`),
      confidence,
      confidenceLabel: confidence >= 0.78 ? "high" : confidence >= 0.55 ? "medium" : "low",
      reason: reasonForBucket(bucket, confidence),
      images: bucket.slice(0, etsyAgentConfig.maxReferenceImagesPerProduct),
      originalFileNames: bucket.map((img, fileIndex) => safeDisplayName(img.originalFileName, `uploaded-image-${fileIndex + 1}`)),
    } satisfies ProductGroup;
  });

  return groups.sort((a, b) => b.images.length - a.images.length);
}

function groupKeyForImage(image: UploadedImage): string {
  const parts = image.relativePath.split("/");
  const parent = parts.length > 1 ? parts[parts.length - 2] : "";
  const tokens = tokensFromPath(image.relativePath);
  const likelySku = tokens.find((t) => /[a-z]*\d{2,}[a-z\d]*/i.test(t));
  const descriptive = tokens.filter((t) => !/^\d+$/.test(t)).slice(0, 2).join("-");
  if (parent && parent !== "." && !/^img|image|photo$/i.test(parent)) return `dir:${parent.toLowerCase()}`;
  if (likelySku) return `sku:${likelySku}`;
  if (descriptive) return `name:${descriptive}`;
  return `hash:${image.perceptualKey.slice(0, 12)}`;
}

function confidenceForBucket(bucket: UploadedImage[]): number {
  if (bucket.length === 1) return 0.42;
  const dirs = new Set(bucket.map((img) => img.relativePath.split("/").slice(0, -1).join("/")).filter(Boolean));
  const tokenSets = bucket.map((img) => new Set(tokensFromPath(img.relativePath)));
  let overlap = 0;
  for (let i = 1; i < tokenSets.length; i++) {
    const base = tokenSets[0] ?? new Set<string>();
    const next = tokenSets[i] ?? new Set<string>();
    overlap += Array.from(base).filter((t) => next.has(t)).length / Math.max(base.size, next.size, 1);
  }
  const tokenScore = tokenSets.length > 1 ? overlap / (tokenSets.length - 1) : 0;
  return Math.min(0.92, 0.5 + (dirs.size === 1 ? 0.22 : 0) + tokenScore * 0.25 + Math.min(bucket.length, 5) * 0.03);
}

function reasonForBucket(bucket: UploadedImage[], confidence: number): string {
  if (bucket.length === 1) return "只有一张图片，无法高置信度判断是否存在同商品多角度。";
  if (confidence < 0.55) return "基于文件名/路径的相似度较弱，建议生成前人工确认，避免合并不同 Etsy 商品。";
  return "基于路径、文件名 token 与图片基础特征归为同一商品参考组。";
}

function extensionForMime(mimeType: string, fileName: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  const ext = path.extname(fileName).toLowerCase();
  return ext === ".jpeg" ? ".jpg" : ".jpg";
}
