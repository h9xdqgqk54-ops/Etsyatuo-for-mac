import * as fs from "node:fs";
import * as path from "node:path";
import { getAssetStorage } from "./assetStorage.js";
import { deleteAsset, findAsset, listAssets, saveAsset } from "./assetLibrary.js";
import { etsyAgentConfig } from "./config.js";
import { checkEtsyCompliance } from "./complianceService.js";
import { generateOpenAIImageEditFromFile } from "./imageProviders/openaiProvider.js";
import { getCurrentImageProviderSettings } from "./imageProviders/registry.js";
import { imageAgentFolders, requireInputAsset, scanInputAssets } from "./inputAssetRegistry.js";
import { readJsonFile, writeJsonFile } from "./jsonFile.js";
import { findBestPromptRecord, findImagePromptRecord, promptHash as promptRecordHash, updateImagePromptRecord } from "./promptGenerationService.js";
import { checkGeneratedImageQuality } from "./qualityService.js";
import { isStructuredError, structuredError } from "./structuredErrors.js";
import type { AssetRecord, ImagePromptStatus, InputAssetRecord, QualityStatus } from "./types.js";
import { ensureDir, makeId, nowIso, safeJoin, slugify } from "./utils.js";

export type DesktopBatchStatus = "queued" | "running" | "reviewing" | "approved" | "failed" | "cleared";
export type DesktopBatchItemStatus = "queued" | "running" | "generated" | "failed" | "approved" | "cleared";

export interface DesktopBatchItem {
  itemId: string;
  batchId: string;
  baseName: string;
  inputAssetId: string;
  inputFileName: string;
  promptFileName?: string;
  inputPath: string;
  mimeType: string;
  promptRecordId: string;
  promptTextSnapshot: string;
  negativePromptSnapshot: string;
  promptStatusAtGeneration: ImagePromptStatus;
  status: DesktopBatchItemStatus;
  error?: string;
  assetId?: string;
  publicUrl?: string;
  outputFileName?: string;
  outputFilePath?: string;
  model?: string;
  size?: string;
  quality?: string;
  promptHash?: string;
  openaiRequestId?: string;
  providerTraceId?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  approvedAt?: string;
}

export interface DesktopBatch {
  batchId: string;
  status: DesktopBatchStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  inputDir: string;
  outputDir: string;
  totalItems: number;
  generatedItems: number;
  approvedItems: number;
  failedItems: number;
  model: string;
  size: string;
  quality: string;
  items: DesktopBatchItem[];
}

export interface PublicDesktopBatchItem extends Omit<DesktopBatchItem, "inputPath"> {
  promptPreview: string;
}

export interface PublicDesktopBatch extends Omit<DesktopBatch, "items"> {
  items: PublicDesktopBatchItem[];
}

export function desktopBatchOutputImageUrl(batchId: string, itemId: string): string {
  return `/api/etsy-agent/desktop-batch/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/output-image`;
}

interface DesktopGenerationSource {
  asset: InputAssetRecord;
  promptRecordId: string;
  promptTextSnapshot: string;
  negativePromptSnapshot: string;
  promptStatusAtGeneration: ImagePromptStatus;
  promptHash: string;
}

const batchesFile = path.join(etsyAgentConfig.storageRoot, "metadata", "desktop-batches.json");
const queue: string[] = [];
const runningItems = new Set<string>();
let active = false;

export function desktopFolders(): { inputDir: string; outputDir: string } {
  return imageAgentFolders();
}

export function scanDesktopBatchFolders(): { inputDir: string; outputDir: string; assets: InputAssetRecord[]; pairs: Array<{ baseName: string; inputFileName: string; mimeType: string; inputAssetId: string; promptRecordId?: string; promptStatus?: string }> } {
  const scan = scanInputAssets();
  return {
    ...scan,
    pairs: scan.assets.map((asset) => {
      const promptRecord = findBestPromptRecord(asset.inputAssetId);
      return {
        baseName: asset.baseName,
        inputFileName: asset.fileName,
        mimeType: asset.mimeType,
        inputAssetId: asset.inputAssetId,
        promptRecordId: promptRecord?.id,
        promptStatus: promptRecord?.status,
      };
    }),
  };
}

export function getCurrentDesktopBatch(): PublicDesktopBatch | null {
  const batch = readBatches()
    .filter((item) => item.status !== "cleared")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return batch ? publicBatch(recomputeBatchCounts(batch)) : null;
}

export function getDesktopBatchById(batchId: string): PublicDesktopBatch | null {
  const batch = findBatch(batchId);
  return batch ? publicBatch(recomputeBatchCounts(batch)) : null;
}

export function startDesktopBatchGeneration(input: { confirmedCostRisk?: boolean } = {}): PublicDesktopBatch {
  const settings = getCurrentImageProviderSettings("openai");
  assertOpenAIReady(settings);
  cleanupPendingDesktopCandidates();
  const folders = desktopFolders();
  const sources = collectGenerationSources();
  if (sources.length === 0) throw new Error("DESKTOP_BATCH_EMPTY：图片输入目录没有可生成的图片。");
  if (sources.length > etsyAgentConfig.maxBatchGeneratedImages) {
    throw new Error(`DESKTOP_BATCH_TOO_LARGE：单批最多生成 ${etsyAgentConfig.maxBatchGeneratedImages} 张，当前 ${sources.length} 张。`);
  }
  const quality = settings.imageQuality ?? etsyAgentConfig.openaiImageQuality;
  if ((sources.length > 1 || quality !== "low") && !input.confirmedCostRisk) {
    throw structuredError({
      code: "OPENAI_COST_RISK_CONFIRMATION_REQUIRED",
      message: `OPENAI_COST_RISK_CONFIRMATION_REQUIRED：本批将生成 ${sources.length} 张，质量为 ${quality}。请确认成本风险后再开始。`,
      provider: "openai",
      model: settings.model,
    });
  }
  ensureDir(folders.outputDir);
  const batchId = makeId("batch");
  const now = nowIso();
  const batch: DesktopBatch = {
    batchId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    inputDir: folders.inputDir,
    outputDir: folders.outputDir,
    totalItems: sources.length,
    generatedItems: 0,
    approvedItems: 0,
    failedItems: 0,
    model: settings.model,
    size: settings.imageSize,
    quality,
    items: sources.map((source) => ({
      itemId: makeId("item"),
      batchId,
      baseName: source.asset.baseName,
      inputAssetId: source.asset.inputAssetId,
      inputFileName: source.asset.fileName,
      inputPath: source.asset.filePath,
      mimeType: source.asset.mimeType,
      promptRecordId: source.promptRecordId,
      promptTextSnapshot: source.promptTextSnapshot,
      negativePromptSnapshot: source.negativePromptSnapshot,
      promptStatusAtGeneration: source.promptStatusAtGeneration,
      status: "queued",
      promptHash: source.promptHash,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    })),
  };
  saveBatch(batch);
  enqueueBatch(batch.batchId);
  return publicBatch(batch);
}

export function approvePromptAndGenerateImage(promptId: string, input: { confirmedCostRisk?: boolean } = {}): PublicDesktopBatch {
  const existingPrompt = findImagePromptRecord(promptId);
  if (!existingPrompt) throw structuredError({ code: "PROMPT_RECORD_NOT_FOUND", message: "PROMPT_RECORD_NOT_FOUND：未找到提示词记录。", provider: "gpt55" });
  if (!existingPrompt.promptText.trim()) throw structuredError({ code: "PROMPT_REQUIRED", message: "PROMPT_REQUIRED：提示词不能为空，不能生成图片。", provider: "gpt55" });

  const promptRecord = existingPrompt.status === "approved"
    ? existingPrompt
    : updateImagePromptRecord(promptId, { status: "approved" });
  const asset = requireInputAsset(promptRecord.inputAssetId);
  const settings = getCurrentImageProviderSettings("openai");
  assertOpenAIReady(settings);
  const quality = settings.imageQuality ?? etsyAgentConfig.openaiImageQuality;
  if (quality !== "low" && !input.confirmedCostRisk) {
    throw structuredError({
      code: "OPENAI_COST_RISK_CONFIRMATION_REQUIRED",
      message: `OPENAI_COST_RISK_CONFIRMATION_REQUIRED：本次将使用 ${quality} 质量生成 1 张图。请确认成本风险后再开始。`,
      provider: "openai",
      model: settings.model,
    });
  }

  ensureDir(desktopFolders().outputDir);
  const source = generationSourceFromPrompt(asset, promptRecord);
  const batch = getOrCreateReviewBatch(settings);
  const duplicate = batch.items.find((item) => item.inputAssetId === source.asset.inputAssetId && item.promptRecordId === source.promptRecordId && item.promptHash === source.promptHash && ["queued", "running", "generated"].includes(item.status));
  if (duplicate) return publicBatch(recomputeBatchCounts(batch));

  const currentForAsset = batch.items.find((item) => item.inputAssetId === source.asset.inputAssetId && item.status !== "approved" && item.status !== "cleared");
  if (currentForAsset) {
    if (currentForAsset.status === "queued" || currentForAsset.status === "running") return publicBatch(recomputeBatchCounts(batch));
    cleanupItemCandidate(currentForAsset);
    Object.assign(currentForAsset, desktopBatchItemFromSource(batch.batchId, source, currentForAsset.itemId, currentForAsset.attempts));
  } else {
    const activeItemCount = batch.items.filter((item) => item.status !== "cleared").length;
    if (activeItemCount >= etsyAgentConfig.maxBatchGeneratedImages) {
      throw new Error(`DESKTOP_BATCH_TOO_LARGE：单批最多生成 ${etsyAgentConfig.maxBatchGeneratedImages} 张，当前 ${activeItemCount} 张。`);
    }
    batch.items.push(desktopBatchItemFromSource(batch.batchId, source));
  }
  batch.status = "queued";
  batch.model = settings.model;
  batch.size = settings.imageSize;
  batch.quality = quality;
  batch.updatedAt = nowIso();
  const saved = saveBatch(recomputeBatchCounts(batch));
  const item = saved.items.find((candidate) => candidate.inputAssetId === source.asset.inputAssetId && candidate.promptRecordId === source.promptRecordId && candidate.promptHash === source.promptHash);
  if (item) launchBatchItemGeneration(saved.batchId, item.itemId);
  return publicBatch(findBatch(saved.batchId) ?? saved);
}

export async function approveDesktopBatchItem(itemId: string): Promise<PublicDesktopBatch> {
  const batch = requireBatchForItem(itemId);
  const item = requireBatchItem(batch, itemId);
  if (!item.assetId) throw new Error("DESKTOP_BATCH_ITEM_NOT_READY：这张图还没有可通过的候选图。");
  const asset = findAsset(item.assetId);
  if (!asset || !fs.existsSync(asset.generatedFilePath)) throw new Error("DESKTOP_BATCH_ASSET_NOT_FOUND：候选图文件不存在，请重新生成。");
  ensureDir(batch.outputDir);
  const outputPath = uniqueOutputPath(batch.outputDir, item.baseName);
  fs.copyFileSync(asset.generatedFilePath, outputPath);
  await nextTick();
  deleteAsset(asset.assetId);
  item.status = "approved";
  item.assetId = undefined;
  item.publicUrl = undefined;
  item.outputFilePath = outputPath;
  item.outputFileName = path.basename(outputPath);
  item.approvedAt = nowIso();
  item.updatedAt = item.approvedAt;
  batch.updatedAt = item.updatedAt;
  saveBatch(recomputeBatchCounts(batch));
  return publicBatch(batch);
}

export function regenerateDesktopBatchItem(itemId: string): PublicDesktopBatch {
  const batch = requireBatchForItem(itemId);
  const item = requireBatchItem(batch, itemId);
  if (item.status === "running") return publicBatch(recomputeBatchCounts(batch));
  cleanupItemCandidate(item);
  item.status = "queued";
  item.error = undefined;
  item.outputFileName = undefined;
  item.outputFilePath = undefined;
  item.startedAt = undefined;
  item.completedAt = undefined;
  item.updatedAt = nowIso();
  batch.status = "queued";
  batch.updatedAt = item.updatedAt;
  const saved = saveBatch(recomputeBatchCounts(batch));
  launchBatchItemGeneration(saved.batchId, itemId);
  return publicBatch(findBatch(saved.batchId) ?? saved);
}

function assertOpenAIReady(settings: ReturnType<typeof getCurrentImageProviderSettings>): void {
  if (!settings.configured) {
    throw structuredError({
      code: "OPENAI_API_KEY_MISSING",
      message: "OPENAI_API_KEY_MISSING：当前批量图生图只支持 OpenAI，请先配置 OPENAI_API_KEY。",
      provider: "openai",
      model: settings.model,
    });
  }
  if (!settings.enableRealGeneration) {
    throw structuredError({
      code: "REAL_GENERATION_DISABLED",
      message: "REAL_GENERATION_DISABLED：批量图生图会调用 OpenAI，请设置 IMAGE_AGENT_ENABLE_REAL_GENERATION=true。",
      provider: "openai",
      model: settings.model,
    });
  }
}

function getOrCreateReviewBatch(settings: ReturnType<typeof getCurrentImageProviderSettings>): DesktopBatch {
  const batches = readBatches();
  const existing = batches
    .filter((batch) => batch.status === "queued" || batch.status === "running" || batch.status === "reviewing")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (existing) return recomputeBatchCounts(existing);
  const folders = desktopFolders();
  const now = nowIso();
  return {
    batchId: makeId("batch"),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    inputDir: folders.inputDir,
    outputDir: folders.outputDir,
    totalItems: 0,
    generatedItems: 0,
    approvedItems: 0,
    failedItems: 0,
    model: settings.model,
    size: settings.imageSize,
    quality: settings.imageQuality ?? etsyAgentConfig.openaiImageQuality,
    items: [],
  };
}

function generationSourceFromPrompt(asset: InputAssetRecord, promptRecord: NonNullable<ReturnType<typeof findImagePromptRecord>>): DesktopGenerationSource {
  return {
    asset,
    promptRecordId: promptRecord.id,
    promptTextSnapshot: promptRecord.promptText,
    negativePromptSnapshot: promptRecord.negativePrompt,
    promptStatusAtGeneration: promptRecord.status,
    promptHash: promptRecord.promptHash || promptRecordHash(promptRecord.promptText, promptRecord.negativePrompt),
  };
}

function desktopBatchItemFromSource(batchId: string, source: DesktopGenerationSource, itemId = makeId("item"), attempts = 0): DesktopBatchItem {
  const now = nowIso();
  return {
    itemId,
    batchId,
    baseName: source.asset.baseName,
    inputAssetId: source.asset.inputAssetId,
    inputFileName: source.asset.fileName,
    inputPath: source.asset.filePath,
    mimeType: source.asset.mimeType,
    promptRecordId: source.promptRecordId,
    promptTextSnapshot: source.promptTextSnapshot,
    negativePromptSnapshot: source.negativePromptSnapshot,
    promptStatusAtGeneration: source.promptStatusAtGeneration,
    status: "queued",
    promptHash: source.promptHash,
    attempts,
    createdAt: now,
    updatedAt: now,
  };
}

export function cleanupPendingDesktopCandidates(): { deleted: number } {
  const batches = readBatches();
  let deleted = 0;
  for (const batch of batches) {
    let touched = false;
    for (const item of batch.items) {
      if (item.status === "approved") continue;
      if (cleanupItemCandidate(item)) deleted += 1;
      if (item.status !== "cleared") {
        item.status = "cleared";
        item.updatedAt = nowIso();
        touched = true;
      }
    }
    if (touched && batch.items.every((item) => item.status === "cleared" || item.status === "approved")) {
      batch.status = "cleared";
      batch.updatedAt = nowIso();
    }
  }
  writeBatches(batches);
  return { deleted };
}

function enqueueBatch(batchId: string): void {
  if (!queue.includes(batchId)) queue.push(batchId);
  void drainQueue();
}

async function drainQueue(): Promise<void> {
  if (active) return;
  active = true;
  try {
    while (queue.length > 0) {
      const batchId = queue.shift()!;
      const batch = findBatch(batchId);
      if (!batch) continue;
      await runBatch(batch);
    }
  } finally {
    active = false;
  }
}

async function runBatch(batch: DesktopBatch): Promise<void> {
  batch.status = "running";
  batch.updatedAt = nowIso();
  saveBatch(batch);
  const itemIds = batch.items.filter((item) => item.status === "queued").map((item) => item.itemId);
  await Promise.all(itemIds.map((itemId) => runBatchItemById(batch.batchId, itemId)));
}

function launchBatchItemGeneration(batchId: string, itemId: string): void {
  if (runningItems.has(itemId)) return;
  runningItems.add(itemId);
  const claimed = claimBatchItemForGeneration(batchId, itemId);
  if (!claimed) {
    runningItems.delete(itemId);
    return;
  }
  void Promise.resolve()
    .then(() => runClaimedBatchItem(batchId, itemId, claimed))
    .finally(() => {
      runningItems.delete(itemId);
    });
}

async function runBatchItemById(batchId: string, itemId: string): Promise<void> {
  const claimed = claimBatchItemForGeneration(batchId, itemId);
  if (!claimed) return;
  await runClaimedBatchItem(batchId, itemId, claimed);
}

function claimBatchItemForGeneration(batchId: string, itemId: string): { batch: DesktopBatch; item: DesktopBatchItem } | undefined {
  return mutateBatchItem(batchId, itemId, (batch, item) => {
    if (item.status !== "queued") return false;
    item.status = "running";
    item.error = undefined;
    item.attempts += 1;
    item.startedAt = nowIso();
    item.updatedAt = item.startedAt;
    batch.status = "running";
    batch.updatedAt = item.updatedAt;
    return true;
  });
}

async function runClaimedBatchItem(batchId: string, itemId: string, claimed: { batch: DesktopBatch; item: DesktopBatchItem }): Promise<void> {
  const completed = await generateBatchItem(claimed.batch, claimed.item);
  mutateBatchItem(batchId, itemId, (_batch, item) => {
    if (item.startedAt !== claimed.item.startedAt || item.attempts !== claimed.item.attempts) return false;
    Object.assign(item, completed);
    return true;
  });
}

async function generateBatchItem(batch: DesktopBatch, item: DesktopBatchItem): Promise<DesktopBatchItem> {
  const settings = getCurrentImageProviderSettings("openai");
  const nextItem: DesktopBatchItem = { ...item };
  try {
    validateDesktopImage(nextItem.inputPath, nextItem.mimeType);
    const outputDir = safeJoin(etsyAgentConfig.storageRoot, `assets/desktop-${slugify(batch.batchId)}`);
    ensureDir(outputDir);
    const outputPath = path.join(outputDir, `${slugify(nextItem.baseName, "image")}-${Date.now()}-${slugify(nextItem.itemId, "item")}.png`);
    const optimizedPrompt = promptForOpenAIImageEdit(nextItem.promptTextSnapshot, nextItem.negativePromptSnapshot);
    const generation = await generateOpenAIImageEditFromFile({
      inputPath: nextItem.inputPath,
      mimeType: nextItem.mimeType,
      prompt: optimizedPrompt,
      outputPath,
      settings,
      requireRegisteredMediaPath: true,
    });
    const quality = await checkGeneratedImageQuality(outputPath, nextItem.promptTextSnapshot, listAssets());
    const compliance = checkEtsyCompliance(nextItem.promptTextSnapshot, optimizedPrompt, quality.reason);
    const asset: AssetRecord = {
      assetId: makeId("asset"),
      taskId: batch.batchId,
      productGroupId: nextItem.itemId,
      sourceProductGroupId: nextItem.itemId,
      batchId: batch.batchId,
      itemId: nextItem.itemId,
      baseName: nextItem.baseName,
      inputAssetId: nextItem.inputAssetId,
      inputFileName: nextItem.inputFileName,
      promptFileName: nextItem.promptFileName,
      reviewStatus: "pending",
      originalFileNames: [nextItem.inputFileName],
      generatedFilePath: outputPath,
      publicUrl: getAssetStorage().publicUrlForLocalPath(outputPath),
      prompt: nextItem.promptTextSnapshot,
      optimizedPrompt,
      provider: "openai",
      imageGenerationMode: "product_reference",
      shotType: "hero_white_background",
      referenceAssetIds: [nextItem.inputAssetId],
      preserveProduct: true,
      usedReferenceImage: true,
      promptHash: nextItem.promptHash,
      promptRecordId: nextItem.promptRecordId,
      promptTextSnapshot: nextItem.promptTextSnapshot,
      negativePromptSnapshot: nextItem.negativePromptSnapshot,
      promptStatusAtGeneration: nextItem.promptStatusAtGeneration,
      providerTraceId: generation.providerTraceId,
      openaiRequestId: generation.openaiRequestId,
      model: generation.model,
      createdAt: nowIso(),
      qualityStatus: quality.status as QualityStatus,
      qualityReason: quality.reason,
      generationIndex: 0,
      platform: "etsy",
      etsyImageType: "main",
      etsyComplianceStatus: compliance.status,
      etsyComplianceReason: compliance.reason,
      recommendedListingOrder: 1,
      outputSize: generation.outputSize,
      size: generation.outputSize,
      providerQuality: generation.quality,
      aspectRatio: "1:1",
      originalityRiskLevel: "low",
    };
    cleanupItemCandidate(nextItem);
    saveAsset(asset);
    nextItem.status = "generated";
    nextItem.assetId = asset.assetId;
    nextItem.publicUrl = asset.publicUrl;
    nextItem.model = generation.model;
    nextItem.size = generation.outputSize;
    nextItem.quality = generation.quality;
    nextItem.openaiRequestId = generation.openaiRequestId;
    nextItem.providerTraceId = generation.providerTraceId;
    nextItem.error = undefined;
    nextItem.completedAt = nowIso();
    nextItem.updatedAt = nextItem.completedAt;
  } catch (error) {
    nextItem.status = "failed";
    nextItem.error = publicBatchItemError(error);
    if (isStructuredError(error)) {
      nextItem.openaiRequestId = error.requestId;
      nextItem.providerTraceId = error.requestId;
      nextItem.model = error.model ?? settings.model;
    }
    nextItem.updatedAt = nowIso();
  }
  return nextItem;
}

function promptForOpenAIImageEdit(userPrompt: string, negativePrompt: string): string {
  const normalized = userPrompt
    .replace(/jelly\s*cat/gi, "the same plush toy shown in the reference image")
    .replace(/jellycat/gi, "the same plush toy shown in the reference image")
    .replace(/etsy/gi, "online marketplace")
    .replace(/亚马逊|淘宝|天猫|京东|拼多多/g, "电商平台");
  return [
    "Use the uploaded reference image as the source image.",
    "Preserve the exact same physical product from the reference: category, color, material, silhouette, structure, decorative details, and quantity must remain unchanged.",
    "Do not create a new product, similar variant, new design, logo, watermark, brand text, marketplace UI, certification text, or readable label text.",
    "If the user prompt mentions a brand or marketplace, treat it only as private context and do not render brand marks or platform marks.",
    `User visual direction: ${normalized}`,
    negativePrompt.trim() ? `Avoid: ${negativePrompt.trim()}` : "",
  ].filter(Boolean).join("\n");
}

function publicBatchItemError(error: unknown): string {
  if (isStructuredError(error)) {
    const reason = error.reason ? `\n${error.reason}` : "";
    const requestId = error.requestId ? `\nRequest ID: ${error.requestId}` : "";
    return `${error.code}: ${error.message}${reason}${requestId}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function collectGenerationSources(): DesktopGenerationSource[] {
  const scan = scanInputAssets();
  const missing: string[] = [];
  const sources = scan.assets.map((asset) => {
    const promptRecord = findBestPromptRecord(asset.inputAssetId);
    if (!promptRecord) {
      missing.push(asset.fileName);
      return null;
    }
    return {
      asset,
      promptRecordId: promptRecord.id,
      promptTextSnapshot: promptRecord.promptText,
      negativePromptSnapshot: promptRecord.negativePrompt,
      promptStatusAtGeneration: promptRecord.status,
      promptHash: promptRecord.promptHash || promptRecordHash(promptRecord.promptText, promptRecord.negativePrompt),
    };
  }).filter((source): source is DesktopGenerationSource => Boolean(source));
  if (missing.length > 0) {
    throw structuredError({
      code: "PROMPT_REQUIRED",
      message: `PROMPT_REQUIRED：以下图片还没有提示词，请先点击“根据图片自动生成提示词”并人工确认：${missing.join(", ")}`,
      provider: "gpt55",
      reason: missing.join(", "),
    });
  }
  return sources;
}

function validateDesktopImage(filePath: string, mimeType: string): void {
  if (!fs.existsSync(filePath)) throw structuredError({ code: "INPUT_ASSET_FILE_NOT_FOUND", message: "INPUT_ASSET_FILE_NOT_FOUND：图片输入文件不存在。", provider: "openai" });
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw structuredError({ code: "UNSUPPORTED_INPUT_IMAGE_TYPE", message: "UNSUPPORTED_INPUT_IMAGE_TYPE：图片输入仅支持 JPEG、PNG 或 WebP。", provider: "openai" });
  }
  const maxBytes = etsyAgentConfig.openaiImageMaxInputMb * 1024 * 1024;
  if (fs.statSync(filePath).size > maxBytes) {
    throw structuredError({ code: "INPUT_IMAGE_TOO_LARGE", message: `INPUT_IMAGE_TOO_LARGE：图片超过 ${etsyAgentConfig.openaiImageMaxInputMb}MB。`, provider: "openai" });
  }
}

function cleanupItemCandidate(item: DesktopBatchItem): boolean {
  const deleted = item.assetId ? deleteAsset(item.assetId) : false;
  item.assetId = undefined;
  item.publicUrl = undefined;
  return deleted;
}

function uniqueOutputPath(outputDir: string, baseName: string): string {
  const safeBase = outputBaseName(baseName);
  let candidate = path.join(outputDir, `${safeBase}.png`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDir, `${safeBase}-${index}.png`);
    index += 1;
  }
  return candidate;
}

function outputBaseName(baseName: string): string {
  return baseName.trim().replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_").replace(/^\.+$/, "image") || "image";
}

function requireBatchForItem(itemId: string): DesktopBatch {
  const batch = readBatches().find((candidate) => candidate.items.some((item) => item.itemId === itemId));
  if (!batch) throw new Error("DESKTOP_BATCH_ITEM_NOT_FOUND：未找到这张批量生成图。");
  return batch;
}

function requireBatchItem(batch: DesktopBatch, itemId: string): DesktopBatchItem {
  const item = batch.items.find((candidate) => candidate.itemId === itemId);
  if (!item) throw new Error("DESKTOP_BATCH_ITEM_NOT_FOUND：未找到这张批量生成图。");
  return item;
}

function findBatch(batchId: string): DesktopBatch | undefined {
  return readBatches().find((batch) => batch.batchId === batchId);
}

function saveBatch(batch: DesktopBatch): DesktopBatch {
  const batches = readBatches();
  const normalized = recomputeBatchCounts(batch);
  const index = batches.findIndex((item) => item.batchId === batch.batchId);
  if (index >= 0) batches[index] = normalized;
  else batches.unshift(normalized);
  writeBatches(batches.slice(0, 50));
  return normalized;
}

function mutateBatchItem(
  batchId: string,
  itemId: string,
  mutator: (batch: DesktopBatch, item: DesktopBatchItem) => boolean | void,
): { batch: DesktopBatch; item: DesktopBatchItem } | undefined {
  const batches = readBatches();
  const batch = batches.find((candidate) => candidate.batchId === batchId);
  if (!batch) return undefined;
  const item = batch.items.find((candidate) => candidate.itemId === itemId);
  if (!item) return undefined;
  const shouldSave = mutator(batch, item);
  if (shouldSave === false) return undefined;
  batch.updatedAt = nowIso();
  const normalized = recomputeBatchCounts(batch);
  writeBatches(batches.slice(0, 50));
  return { batch: normalized, item: item };
}

function readBatches(): DesktopBatch[] {
  return readJsonFile<DesktopBatch[]>(batchesFile, []);
}

function writeBatches(batches: DesktopBatch[]): void {
  writeJsonFile(batchesFile, batches);
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function recomputeBatchCounts(batch: DesktopBatch): DesktopBatch {
  batch.generatedItems = batch.items.filter((item) => item.status === "generated").length;
  batch.approvedItems = batch.items.filter((item) => item.status === "approved").length;
  batch.failedItems = batch.items.filter((item) => item.status === "failed").length;
  batch.totalItems = batch.items.length;
  if (batch.status === "cleared") return batch;
  if (batch.approvedItems === batch.totalItems && batch.totalItems > 0) batch.status = "approved";
  else if (batch.items.some((item) => item.status === "running")) batch.status = "running";
  else if (batch.items.some((item) => item.status === "queued")) batch.status = "queued";
  else if (batch.generatedItems > 0) batch.status = "reviewing";
  else if (batch.failedItems > 0) batch.status = "failed";
  return batch;
}

function publicBatch(batch: DesktopBatch): PublicDesktopBatch {
  const { items, ...rest } = recomputeBatchCounts(batch);
  return {
    ...rest,
    items: items.map(({ inputPath: _inputPath, promptTextSnapshot, ...item }) => {
      const safePromptTextSnapshot = typeof promptTextSnapshot === "string" ? promptTextSnapshot : "";
      const publicUrl = item.publicUrl ?? (item.status === "approved" && item.outputFilePath ? desktopBatchOutputImageUrl(batch.batchId, item.itemId) : undefined);
      return {
        ...item,
        publicUrl,
        promptTextSnapshot: safePromptTextSnapshot,
        promptPreview: safePromptTextSnapshot.slice(0, 240),
      };
    }),
  };
}
