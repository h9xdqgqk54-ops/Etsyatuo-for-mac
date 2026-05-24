import * as fs from "node:fs";
import * as path from "node:path";
import { etsyAgentConfig } from "./config.js";
import { desktopBatchOutputImageUrl, getDesktopBatchById, type PublicDesktopBatch, type PublicDesktopBatchItem } from "./desktopBatchWorkflow.js";
import { readJsonFile, writeJsonFile } from "./jsonFile.js";
import { gpt55PromptProvider } from "./promptProviders/gpt55PromptProvider.js";
import type { StyleNameImageInput } from "./promptProviders/types.js";
import { getEffectiveGpt55PromptSettings } from "./secureConfig.js";
import { loadSharp } from "./sharpRuntime.js";
import { structuredError } from "./structuredErrors.js";
import type { ProductWorkbenchImageMeta, ProductWorkbenchRecord, ProductWorkbenchStatus } from "./types.js";
import { ensureDir, nowIso, slugify } from "./utils.js";

export interface UpdateWorkbenchImageMetaInput {
  itemId: string;
  color?: string;
  size?: string;
  material?: string;
  note?: string;
}

export interface UpdateWorkbenchStyleNameInput {
  itemId: string;
  styleNameEn?: string;
}

const workbenchRecordsFile = etsyAgentConfig.productWorkbenchRecordsPath;
const workbenchInputMaxEdgePx = 1024;
const workbenchInputJpegQuality = 85;

export function getProductWorkbench(batchId: string): ProductWorkbenchRecord {
  return syncProductWorkbench(batchId);
}

export function listProductWorkbenchRecords(): ProductWorkbenchRecord[] {
  return readWorkbenchRecords();
}

export function syncProductWorkbench(batchId: string): ProductWorkbenchRecord {
  const batch = requireBatch(batchId);
  const existing = readWorkbenchRecords().find((record) => record.batchId === batchId);
  const now = nowIso();
  const approvedItems = approvedOutputItems(batch);
  const imageMetas = approvedItems.map((item) => imageMetaForItem(item, existing?.imageMetas.find((meta) => meta.itemId === item.itemId), now));
  const record: ProductWorkbenchRecord = {
    batchId,
    status: workbenchStatus(existing?.status),
    imageMetas,
    listing: existing?.listing,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  upsertWorkbenchRecord(record);
  return record;
}

export function updateProductWorkbenchImageMetas(batchId: string, updates: UpdateWorkbenchImageMetaInput[]): ProductWorkbenchRecord {
  const record = syncProductWorkbench(batchId);
  const now = nowIso();
  for (const update of updates) {
    const meta = record.imageMetas.find((item) => item.itemId === update.itemId);
    if (!meta) continue;
    if (typeof update.color === "string") meta.color = update.color.trim();
    if (typeof update.size === "string") meta.size = update.size.trim();
    if (typeof update.material === "string") meta.material = update.material.trim();
    if (typeof update.note === "string") meta.note = update.note.trim();
    meta.source = "manual";
    meta.updatedAt = now;
  }
  record.updatedAt = now;
  upsertWorkbenchRecord(record);
  return record;
}

export function updateProductWorkbenchStyleNames(batchId: string, updates: UpdateWorkbenchStyleNameInput[]): ProductWorkbenchRecord {
  return updateProductWorkbenchStyleNamesWithSource(batchId, updates, "manual");
}

export function updateProductWorkbenchStyleNamesFromGpt55(batchId: string, updates: UpdateWorkbenchStyleNameInput[]): ProductWorkbenchRecord {
  return updateProductWorkbenchStyleNamesWithSource(batchId, updates, "gpt55");
}

function updateProductWorkbenchStyleNamesWithSource(batchId: string, updates: UpdateWorkbenchStyleNameInput[], source: "manual" | "gpt55"): ProductWorkbenchRecord {
  const record = syncProductWorkbench(batchId);
  const now = nowIso();
  for (const update of updates) {
    const meta = record.imageMetas.find((item) => item.itemId === update.itemId);
    if (!meta) continue;
    if (typeof update.styleNameEn === "string") {
      meta.styleNameEn = normalizeStyleNameEn(update.styleNameEn);
      meta.styleNameSource = source;
      meta.styleNameUpdatedAt = now;
      meta.updatedAt = now;
    }
  }
  record.updatedAt = now;
  upsertWorkbenchRecord(record);
  return record;
}

export async function generateProductWorkbenchStyleNames(batchId: string): Promise<ProductWorkbenchRecord> {
  const record = syncProductWorkbench(batchId);
  const batch = requireBatch(batchId);
  const imageInputs = await prepareWorkbenchImagesForGpt55(batch.batchId, approvedOutputItems(batch), record, "style-name");
  const result = await gpt55PromptProvider.generateStyleNames({ batchId, images: imageInputs });
  const now = nowIso();
  for (const style of result.styles) {
    const meta = record.imageMetas.find((item) => item.itemId === style.itemId);
    if (!meta) continue;
    meta.styleNameEn = normalizeStyleNameEn(style.styleNameEn);
    meta.styleNameSource = "gpt55";
    meta.styleNameUpdatedAt = now;
    meta.updatedAt = now;
  }
  record.updatedAt = now;
  upsertWorkbenchRecord(record);
  return record;
}

function imageMetaForItem(item: PublicDesktopBatchItem, existing: ProductWorkbenchImageMeta | undefined, now: string): ProductWorkbenchImageMeta {
  return {
    itemId: item.itemId,
    inputFileName: item.inputFileName,
    outputFileName: item.outputFileName ?? "",
    outputFilePath: item.outputFilePath ?? "",
    publicUrl: item.publicUrl ?? (item.outputFilePath ? desktopBatchOutputImageUrl(item.batchId, item.itemId) : undefined),
    color: existing?.color ?? "",
    size: existing?.size ?? "",
    material: existing?.material ?? "",
    note: existing?.note ?? "",
    styleNameEn: existing?.styleNameEn ?? "",
    styleNameSource: existing?.styleNameSource,
    styleNameUpdatedAt: existing?.styleNameUpdatedAt,
    source: existing?.source ?? "gpt55",
    updatedAt: existing?.updatedAt ?? now,
  };
}

async function prepareWorkbenchImagesForGpt55(batchId: string, items: PublicDesktopBatchItem[], record: ProductWorkbenchRecord, purpose: "style-name"): Promise<StyleNameImageInput[]> {
  const settings = getEffectiveGpt55PromptSettings();
  const maxBytes = settings.maxInputMb * 1024 * 1024;
  const targetDir = path.join(etsyAgentConfig.dataRoot, "workbench-vision-inputs", purpose, slugify(batchId, "batch"));
  ensureDir(targetDir);
  const sharp = await loadSharp();
  return Promise.all(items.map(async (item, index) => {
    const sourcePath = item.outputFilePath!;
    const baseName = slugify(path.parse(item.outputFileName || item.inputFileName).name, `image-${index + 1}`);
    const preparedPath = path.join(targetDir, `${String(index + 1).padStart(2, "0")}-${baseName}.jpg`);
    await sharp(sourcePath)
      .rotate()
      .resize({
        width: workbenchInputMaxEdgePx,
        height: workbenchInputMaxEdgePx,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: workbenchInputJpegQuality, mozjpeg: true })
      .toFile(preparedPath);
    const preparedSize = fs.statSync(preparedPath).size;
    if (preparedSize > maxBytes) {
      throw structuredError({
        code: "GPT55_IMAGE_TOO_LARGE",
        message: `GPT55_IMAGE_TOO_LARGE：商品工作台图片自动压缩后仍超过 ${settings.maxInputMb}MB，请提高 GPT55_MAX_INPUT_MB 或减少图片数量。`,
        provider: "gpt55",
        model: settings.model,
        reason: `${item.outputFileName || item.inputFileName} compressed to ${preparedSize} bytes`,
      });
    }
    const meta = record.imageMetas.find((row) => row.itemId === item.itemId);
    return {
      itemId: item.itemId,
      inputFileName: item.inputFileName,
      outputFileName: item.outputFileName ?? path.basename(sourcePath),
      filePath: preparedPath,
      fileName: path.basename(preparedPath),
      mimeType: "image/jpeg",
      color: meta?.color,
      size: meta?.size,
      material: meta?.material,
      note: meta?.note,
    };
  }));
}

function normalizeStyleNameEn(value: string): string {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length > 20) {
    throw structuredError({
      code: "PRODUCT_STYLE_NAME_TOO_LONG",
      message: "PRODUCT_STYLE_NAME_TOO_LONG：单个英文款式名不能超过 20 个字符。",
      provider: "gpt55",
      reason: text,
    });
  }
  if (text && (!/^[\x20-\x7E]+$/.test(text) || !/[A-Za-z]/.test(text))) {
    throw structuredError({
      code: "PRODUCT_STYLE_NAME_INVALID",
      message: "PRODUCT_STYLE_NAME_INVALID：款式名必须是英文。",
      provider: "gpt55",
      reason: text,
    });
  }
  return text;
}

function workbenchStatus(existing: ProductWorkbenchStatus | undefined): ProductWorkbenchStatus {
  if (existing === "listing_generated" || existing === "confirmed") return existing;
  return "draft";
}

function approvedOutputItems(batch: PublicDesktopBatch): PublicDesktopBatchItem[] {
  const outputDir = path.resolve(batch.outputDir);
  return batch.items.filter((item) => {
    if (item.status !== "approved" || !item.outputFilePath) return false;
    const filePath = path.resolve(item.outputFilePath);
    return isPathInside(outputDir, filePath) && fs.existsSync(filePath);
  });
}

function requireBatch(batchId: string): PublicDesktopBatch {
  const batch = getDesktopBatchById(batchId);
  if (!batch) {
    throw structuredError({
      code: "DESKTOP_BATCH_NOT_FOUND",
      message: "DESKTOP_BATCH_NOT_FOUND：未找到批次。",
    });
  }
  return batch;
}

function isPathInside(root: string, filePath: string): boolean {
  const rel = path.relative(root, filePath);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function upsertWorkbenchRecord(record: ProductWorkbenchRecord): void {
  const records = readWorkbenchRecords();
  const index = records.findIndex((item) => item.batchId === record.batchId);
  if (index >= 0) records[index] = record;
  else records.unshift(record);
  writeWorkbenchRecords(records);
}

function readWorkbenchRecords(): ProductWorkbenchRecord[] {
  const raw = readJsonFile<ProductWorkbenchRecord[]>(workbenchRecordsFile, []);
  return raw.map((record) => ({
    batchId: record.batchId,
    status: workbenchStatus(record.status),
    imageMetas: Array.isArray(record.imageMetas) ? record.imageMetas : [],
    listing: record.listing,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }));
}

function writeWorkbenchRecords(records: ProductWorkbenchRecord[]): void {
  writeJsonFile(workbenchRecordsFile, records);
}
