import * as fs from "node:fs";
import * as path from "node:path";
import { etsyAgentConfig } from "./config.js";
import { getDesktopBatchById, type PublicDesktopBatch } from "./desktopBatchWorkflow.js";
import { readJsonFile, writeJsonFile } from "./jsonFile.js";
import { gpt55PromptProvider } from "./promptProviders/gpt55PromptProvider.js";
import type { ListingCopyImageInput, ListingCopyImageMetaInput, ProductStyleNameResult } from "./promptProviders/types.js";
import { getProductWorkbench, updateProductWorkbenchStyleNamesFromGpt55 } from "./productWorkbenchService.js";
import { getEffectiveGpt55PromptSettings } from "./secureConfig.js";
import { loadSharp } from "./sharpRuntime.js";
import { isStructuredError, structuredError } from "./structuredErrors.js";
import type { ImagePromptErrorDetails, ProductListingRecord, ProductListingStatus } from "./types.js";
import { ensureDir, makeId, nowIso, slugify } from "./utils.js";

export interface UpdateProductListingInput {
  title?: string;
  description?: string;
  colors?: string;
  sizeInfo?: string;
  materials?: string;
  keywords?: string[] | string;
  status?: "edited" | "approved";
}

export interface ReviseProductListingSuggestionInput {
  suggestion?: string;
}

export interface ReviseProductListingSuggestionResult {
  listing: ProductListingRecord;
  workbench: ReturnType<typeof getProductWorkbench>;
}

const listingRecordsFile = etsyAgentConfig.listingRecordsPath;
const listingInputMaxEdgePx = 1024;
const listingInputJpegQuality = 85;

export function listProductListingRecords(batchId?: string): ProductListingRecord[] {
  const records = readListingRecords();
  return batchId ? records.filter((record) => record.batchId === batchId) : records;
}

export function findProductListingRecord(listingId: string): ProductListingRecord | undefined {
  return readListingRecords().find((record) => record.listingId === listingId);
}

export async function finalizeBatchListing(batchId: string): Promise<ProductListingRecord> {
  const existing = newestUsableListingRecord(batchId);
  if (existing) {
    ensureListingTextFile(existing);
    return existing;
  }
  const batch = requireBatch(batchId);
  const images = await prepareListingImagesForGpt55(batch.batchId, approvedListingImages(batch));
  const result = await gpt55PromptProvider.generateListingCopy({ batchId, images, imageMetas: listingImageMetas(batch.batchId) });
  const now = nowIso();
  const record: ProductListingRecord = {
    listingId: makeId("listing"),
    batchId,
    title: result.title,
    description: result.description,
    colors: result.colors ?? "",
    sizeInfo: result.sizeInfo ?? "",
    materials: result.materials ?? "",
    keywords: result.keywords,
    status: "generated",
    model: result.model,
    promptProviderRequestId: result.promptProviderRequestId,
    providerTraceId: result.providerTraceId,
    outputFilePath: uniqueListingOutputPath(batch.outputDir),
    createdAt: now,
    updatedAt: now,
  };
  validateListingRecord(record);
  writeListingTextFile(record);
  upsertListingRecord(record);
  return record;
}

export function updateProductListingRecord(listingId: string, input: UpdateProductListingInput): ProductListingRecord {
  const records = readListingRecords();
  const record = records.find((item) => item.listingId === listingId);
  if (!record) {
    throw structuredError({
      code: "LISTING_RECORD_NOT_FOUND",
      message: "LISTING_RECORD_NOT_FOUND：未找到商品文案记录。",
      provider: "gpt55",
    });
  }
  if (typeof input.title === "string") record.title = input.title.trim();
  if (typeof input.description === "string") record.description = input.description.trim();
  if (typeof input.colors === "string") record.colors = input.colors.trim();
  if (typeof input.sizeInfo === "string") record.sizeInfo = input.sizeInfo.trim();
  if (typeof input.materials === "string") record.materials = input.materials.trim();
  if (typeof input.keywords !== "undefined") record.keywords = normalizeKeywords(input.keywords);
  record.status = input.status ?? "edited";
  record.error = undefined;
  record.updatedAt = nowIso();
  validateListingRecord(record);
  writeListingTextFile(record);
  writeListingRecords(records);
  return record;
}

export async function regenerateProductListingRecord(listingId: string): Promise<ProductListingRecord> {
  const existing = findProductListingRecord(listingId);
  if (!existing) {
    throw structuredError({
      code: "LISTING_RECORD_NOT_FOUND",
      message: "LISTING_RECORD_NOT_FOUND：未找到商品文案记录。",
      provider: "gpt55",
    });
  }
  const batch = requireBatch(existing.batchId);
  const images = await prepareListingImagesForGpt55(batch.batchId, approvedListingImages(batch));
  const result = await gpt55PromptProvider.generateListingCopy({ batchId: existing.batchId, images, imageMetas: listingImageMetas(batch.batchId) });
  const updated: ProductListingRecord = {
    ...existing,
    title: result.title,
    description: result.description,
    colors: result.colors ?? "",
    sizeInfo: result.sizeInfo ?? "",
    materials: result.materials ?? "",
    keywords: result.keywords,
    status: "generated",
    model: result.model,
    promptProviderRequestId: result.promptProviderRequestId,
    providerTraceId: result.providerTraceId,
    error: undefined,
    updatedAt: nowIso(),
  };
  validateListingRecord(updated);
  writeListingTextFile(updated);
  upsertListingRecord(updated);
  return updated;
}

export async function reviseProductListingWithSuggestion(listingId: string, input: ReviseProductListingSuggestionInput): Promise<ReviseProductListingSuggestionResult> {
  const suggestion = typeof input.suggestion === "string" ? input.suggestion.trim() : "";
  if (!suggestion) {
    throw structuredError({
      code: "LISTING_REVISION_SUGGESTION_REQUIRED",
      message: "LISTING_REVISION_SUGGESTION_REQUIRED：请输入中文修改建议。",
      provider: "gpt55",
    });
  }
  const records = readListingRecords();
  const record = records.find((item) => item.listingId === listingId);
  if (!record) {
    throw structuredError({
      code: "LISTING_RECORD_NOT_FOUND",
      message: "LISTING_RECORD_NOT_FOUND：未找到商品文案记录。",
      provider: "gpt55",
    });
  }
  const imageMetas = listingImageMetas(record.batchId);
  const result = await gpt55PromptProvider.reviseListingCopy({
    batchId: record.batchId,
    suggestion,
    currentListing: {
      title: record.title,
      description: record.description,
      keywords: record.keywords,
    },
    imageMetas,
  });
  assertRevisionStylesMatchMetas(imageMetas, result.styles);
  const updated: ProductListingRecord = {
    ...record,
    title: result.title,
    description: result.description,
    colors: result.colors ?? "",
    sizeInfo: result.sizeInfo ?? "",
    materials: result.materials ?? "",
    keywords: result.keywords,
    status: "edited",
    model: result.model,
    promptProviderRequestId: result.promptProviderRequestId,
    providerTraceId: result.providerTraceId,
    error: undefined,
    updatedAt: nowIso(),
  };
  validateListingRecord(updated);
  writeListingTextFile(updated);
  const index = records.findIndex((item) => item.listingId === listingId);
  records[index] = updated;
  writeListingRecords(records);
  const workbench = updateProductWorkbenchStyleNamesFromGpt55(record.batchId, result.styles);
  return { listing: updated, workbench };
}

function assertRevisionStylesMatchMetas(imageMetas: ListingCopyImageMetaInput[], styles: ProductStyleNameResult[]): void {
  const expected = new Set(imageMetas.map((meta) => meta.itemId));
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const unknown: string[] = [];
  for (const style of styles) {
    if (seen.has(style.itemId)) duplicates.add(style.itemId);
    seen.add(style.itemId);
    if (!expected.has(style.itemId)) unknown.push(style.itemId);
  }
  const missing = [...expected].filter((itemId) => !seen.has(itemId));
  if (duplicates.size || unknown.length || missing.length || styles.length !== expected.size) {
    throw structuredError({
      code: "GPT55_LISTING_REVISION_STYLE_MISMATCH",
      message: "GPT55_LISTING_REVISION_STYLE_MISMATCH：GPT5.5 返回的款式名没有一一对应当前商品图片，未保存改写结果。",
      provider: "gpt55",
      reason: [
        duplicates.size ? `duplicate itemId: ${[...duplicates].join(", ")}` : "",
        unknown.length ? `unknown itemId: ${unknown.join(", ")}` : "",
        missing.length ? `missing itemId: ${missing.join(", ")}` : "",
      ].filter(Boolean).join("; "),
    });
  }
}

export function formatListingText(record: ProductListingRecord): string {
  return [
    `Title:\n${record.title}`,
    `Description:\n${record.description}`,
    `Keywords:\n${record.keywords.join(", ")}`,
  ].join("\n\n") + "\n";
}

function newestUsableListingRecord(batchId: string): ProductListingRecord | undefined {
  return listProductListingRecords(batchId)
    .filter((record) => record.status === "generated" || record.status === "edited" || record.status === "approved")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

function requireBatch(batchId: string): PublicDesktopBatch {
  const batch = getDesktopBatchById(batchId);
  if (!batch) {
    throw structuredError({
      code: "LISTING_RECORD_NOT_FOUND",
      message: "LISTING_RECORD_NOT_FOUND：未找到对应批次，无法生成商品文案。",
      provider: "gpt55",
    });
  }
  return batch;
}

function approvedListingImages(batch: PublicDesktopBatch): ListingCopyImageInput[] {
  if (batch.items.some((item) => item.status === "queued" || item.status === "running")) {
    throw structuredError({
      code: "LISTING_IMAGE_REVIEW_NOT_FINISHED",
      message: "LISTING_IMAGE_REVIEW_NOT_FINISHED：还有图片正在生成或排队，请完成图片审核后再生成商品文案。",
      provider: "gpt55",
    });
  }
  const outputDir = path.resolve(batch.outputDir);
  const images = batch.items
    .filter((item) => item.status === "approved" && item.outputFilePath)
    .map((item) => {
      const filePath = path.resolve(item.outputFilePath!);
      if (!isPathInside(outputDir, filePath) || !fs.existsSync(filePath)) return null;
      return {
        filePath,
        fileName: item.outputFileName || path.basename(filePath),
        mimeType: mimeTypeForPath(filePath),
      };
    })
    .filter((item): item is ListingCopyImageInput => Boolean(item));
  if (images.length === 0) {
    throw structuredError({
      code: "LISTING_APPROVED_IMAGE_REQUIRED",
      message: "LISTING_APPROVED_IMAGE_REQUIRED：至少需要 1 张已通过并保存到输出文件夹的图片才能生成商品文案。",
      provider: "gpt55",
    });
  }
  return images;
}

async function prepareListingImagesForGpt55(batchId: string, images: ListingCopyImageInput[]): Promise<ListingCopyImageInput[]> {
  const settings = getEffectiveGpt55PromptSettings();
  const maxBytes = settings.maxInputMb * 1024 * 1024;
  const targetDir = path.join(etsyAgentConfig.dataRoot, "listing-inputs", slugify(batchId, "batch"));
  ensureDir(targetDir);
  const sharp = await loadSharp();
  return Promise.all(images.map(async (image, index) => {
    const baseName = slugify(path.parse(image.fileName).name, `image-${index + 1}`);
    const preparedPath = path.join(targetDir, `${String(index + 1).padStart(2, "0")}-${baseName}.jpg`);
    await sharp(image.filePath)
      .rotate()
      .resize({
        width: listingInputMaxEdgePx,
        height: listingInputMaxEdgePx,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: listingInputJpegQuality, mozjpeg: true })
      .toFile(preparedPath);
    const preparedSize = fs.statSync(preparedPath).size;
    if (preparedSize > maxBytes) {
      throw structuredError({
        code: "GPT55_IMAGE_TOO_LARGE",
        message: `GPT55_IMAGE_TOO_LARGE：商品文案图片自动压缩后仍超过 ${settings.maxInputMb}MB，请提高 GPT55_MAX_INPUT_MB 或减少图片数量。`,
        provider: "gpt55",
        model: settings.model,
        reason: `${image.fileName} compressed to ${preparedSize} bytes`,
      });
    }
    return {
      filePath: preparedPath,
      fileName: path.basename(preparedPath),
      mimeType: "image/jpeg",
    };
  }));
}

function listingImageMetas(batchId: string): ListingCopyImageMetaInput[] {
  try {
    return getProductWorkbench(batchId).imageMetas.map((meta) => ({
      itemId: meta.itemId,
      inputFileName: meta.inputFileName,
      outputFileName: meta.outputFileName,
      styleNameEn: meta.styleNameEn,
      color: meta.color,
      size: meta.size,
      material: meta.material,
      note: meta.note,
    }));
  } catch {
    return [];
  }
}

function validateListingRecord(record: ProductListingRecord): void {
  if (!record.title.trim()) throw listingParseError("title missing");
  if (!record.description.trim()) throw listingParseError("description missing");
  if (record.keywords.length !== 13) throw listingParseError(`keywords must contain exactly 13 items, got ${record.keywords.length}`);
  const tooLong = record.keywords.find((keyword) => keyword.length > 20);
  if (tooLong) throw listingParseError(`keyword exceeds 20 characters: ${tooLong}`);
}

function listingParseError(reason: string): Error {
  return structuredError({
    code: "GPT55_LISTING_PARSE_FAILED",
    message: "GPT55_LISTING_PARSE_FAILED：商品文案字段不符合要求，未保存坏数据。",
    provider: "gpt55",
    reason,
  });
}

function normalizeKeywords(value: string[] | string): string[] {
  const raw = Array.isArray(value) ? value : value.split(",");
  return raw.map((keyword) => String(keyword).trim().replace(/\s+/g, " ")).filter(Boolean);
}

function uniqueListingOutputPath(outputDir: string): string {
  ensureDir(outputDir);
  let candidate = path.join(outputDir, "listing.txt");
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDir, `listing-${index}.txt`);
    index += 1;
  }
  return candidate;
}

function ensureListingTextFile(record: ProductListingRecord): void {
  if (!fs.existsSync(record.outputFilePath)) writeListingTextFile(record);
}

function writeListingTextFile(record: ProductListingRecord): void {
  ensureDir(path.dirname(record.outputFilePath));
  fs.writeFileSync(record.outputFilePath, formatListingText(record), "utf-8");
}

function mimeTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function isPathInside(root: string, filePath: string): boolean {
  const rel = path.relative(root, filePath);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function upsertListingRecord(record: ProductListingRecord): void {
  const records = readListingRecords();
  const index = records.findIndex((item) => item.listingId === record.listingId);
  if (index >= 0) records[index] = record;
  else records.unshift(record);
  writeListingRecords(records);
}

function readListingRecords(): ProductListingRecord[] {
  return readJsonFile<ProductListingRecord[]>(listingRecordsFile, []);
}

function writeListingRecords(records: ProductListingRecord[]): void {
  writeJsonFile(listingRecordsFile, records);
}

export function listingErrorDetails(error: unknown): ImagePromptErrorDetails {
  if (isStructuredError(error)) {
    return {
      code: error.code,
      message: error.message,
      provider: "gpt55",
      model: error.model,
      requestId: error.requestId,
      statusCode: error.statusCode,
      reason: error.reason,
    };
  }
  return {
    code: "GPT55_LISTING_GENERATION_FAILED",
    message: error instanceof Error ? error.message : String(error),
    provider: "gpt55",
  };
}
