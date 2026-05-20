import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAssetStorage } from "./assetStorage.js";
import { deleteAsset, findAsset, listAssets, saveAsset } from "./assetLibrary.js";
import { etsyAgentConfig } from "./config.js";
import { checkEtsyCompliance } from "./complianceService.js";
import { generateOpenAIImageEditFromFile } from "./imageProviders/openaiProvider.js";
import { getCurrentImageProviderSettings } from "./imageProviders/registry.js";
import { checkGeneratedImageQuality } from "./qualityService.js";
import { isStructuredError, structuredError } from "./structuredErrors.js";
import type { AssetRecord, QualityStatus } from "./types.js";
import { ensureDir, hashBuffer, makeId, nowIso, safeJoin, slugify } from "./utils.js";

export type DesktopBatchStatus = "queued" | "running" | "reviewing" | "approved" | "failed" | "cleared";
export type DesktopBatchItemStatus = "queued" | "running" | "generated" | "failed" | "approved" | "cleared";

export interface DesktopBatchItem {
  itemId: string;
  batchId: string;
  baseName: string;
  inputFileName: string;
  promptFileName: string;
  inputPath: string;
  promptPath: string;
  prompt: string;
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
  promptDir: string;
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

export interface PublicDesktopBatchItem extends Omit<DesktopBatchItem, "inputPath" | "promptPath" | "prompt"> {
  promptPreview: string;
}

export interface PublicDesktopBatch extends Omit<DesktopBatch, "items"> {
  items: PublicDesktopBatchItem[];
}

interface DesktopPair {
  baseName: string;
  inputFileName: string;
  promptFileName: string;
  inputPath: string;
  promptPath: string;
  mimeType: string;
  prompt: string;
}

const IMAGE_EXTENSIONS = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

const batchesFile = path.join(etsyAgentConfig.storageRoot, "metadata", "desktop-batches.json");
const queue: string[] = [];
let active = false;

export function desktopFolders(): { inputDir: string; promptDir: string; outputDir: string } {
  const root = path.resolve(process.env.ETSY_AGENT_DESKTOP_ROOT ?? path.join(os.homedir(), "Desktop"));
  return {
    inputDir: path.join(root, "图片输入"),
    promptDir: path.join(root, "提示词输入"),
    outputDir: path.join(root, "图片输出"),
  };
}

export function scanDesktopBatchFolders(): { inputDir: string; promptDir: string; outputDir: string; pairs: Array<Omit<DesktopPair, "inputPath" | "promptPath" | "prompt">> } {
  const folders = desktopFolders();
  const pairs = scanDesktopPairs(folders);
  return {
    ...folders,
    pairs: pairs.map(({ inputPath: _inputPath, promptPath: _promptPath, prompt: _prompt, ...pair }) => pair),
  };
}

export function getCurrentDesktopBatch(): PublicDesktopBatch | null {
  const batch = readBatches()
    .filter((item) => item.status !== "cleared")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return batch ? publicBatch(recomputeBatchCounts(batch)) : null;
}

export function startDesktopBatchGeneration(input: { confirmedCostRisk?: boolean } = {}): PublicDesktopBatch {
  const settings = getCurrentImageProviderSettings("openai");
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
  cleanupPendingDesktopCandidates();
  const folders = desktopFolders();
  const pairs = scanDesktopPairs(folders);
  if (pairs.length === 0) throw new Error("DESKTOP_BATCH_EMPTY：图片输入和提示词输入没有可配对的文件。");
  if (pairs.length > etsyAgentConfig.maxBatchGeneratedImages) {
    throw new Error(`DESKTOP_BATCH_TOO_LARGE：单批最多生成 ${etsyAgentConfig.maxBatchGeneratedImages} 张，当前 ${pairs.length} 张。`);
  }
  const quality = settings.imageQuality ?? etsyAgentConfig.openaiImageQuality;
  if ((pairs.length > 1 || quality !== "low") && !input.confirmedCostRisk) {
    throw structuredError({
      code: "OPENAI_COST_RISK_CONFIRMATION_REQUIRED",
      message: `OPENAI_COST_RISK_CONFIRMATION_REQUIRED：本批将生成 ${pairs.length} 张，质量为 ${quality}。请确认成本风险后再开始。`,
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
    promptDir: folders.promptDir,
    outputDir: folders.outputDir,
    totalItems: pairs.length,
    generatedItems: 0,
    approvedItems: 0,
    failedItems: 0,
    model: settings.model,
    size: settings.imageSize,
    quality,
    items: pairs.map((pair) => ({
      itemId: makeId("item"),
      batchId,
      baseName: pair.baseName,
      inputFileName: pair.inputFileName,
      promptFileName: pair.promptFileName,
      inputPath: pair.inputPath,
      promptPath: pair.promptPath,
      prompt: pair.prompt,
      status: "queued",
      promptHash: hashBuffer(Buffer.from(pair.prompt)).slice(0, 16),
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    })),
  };
  saveBatch(batch);
  enqueueBatch(batch.batchId);
  return publicBatch(batch);
}

export function approveDesktopBatchItem(itemId: string): PublicDesktopBatch {
  const batch = requireBatchForItem(itemId);
  const item = requireBatchItem(batch, itemId);
  if (!item.assetId) throw new Error("DESKTOP_BATCH_ITEM_NOT_READY：这张图还没有可通过的候选图。");
  const asset = findAsset(item.assetId);
  if (!asset || !fs.existsSync(asset.generatedFilePath)) throw new Error("DESKTOP_BATCH_ASSET_NOT_FOUND：候选图文件不存在，请重新生成。");
  ensureDir(batch.outputDir);
  const outputPath = uniqueOutputPath(batch.outputDir, item.baseName);
  fs.copyFileSync(asset.generatedFilePath, outputPath);
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
  saveBatch(recomputeBatchCounts(batch));
  enqueueBatch(batch.batchId);
  return publicBatch(batch);
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
  const concurrency = Math.max(1, etsyAgentConfig.maxConcurrentGenerations);
  while (batch.items.some((item) => item.status === "queued")) {
    const jobs = batch.items.filter((item) => item.status === "queued").slice(0, concurrency);
    await Promise.all(jobs.map((item) => runBatchItem(batch, item)));
    saveBatch(recomputeBatchCounts(batch));
  }
  const updated = recomputeBatchCounts(batch);
  updated.status = updated.generatedItems > 0 ? "reviewing" : "failed";
  updated.completedAt = nowIso();
  updated.updatedAt = updated.completedAt;
  saveBatch(updated);
}

async function runBatchItem(batch: DesktopBatch, item: DesktopBatchItem): Promise<void> {
  const settings = getCurrentImageProviderSettings("openai");
  item.status = "running";
  item.error = undefined;
  item.attempts += 1;
  item.startedAt = nowIso();
  item.updatedAt = item.startedAt;
  saveBatch(recomputeBatchCounts(batch));
  try {
    const mimeType = mimeTypeForImageFile(item.inputFileName);
    validateDesktopImage(item.inputPath, mimeType);
    const outputDir = safeJoin(etsyAgentConfig.storageRoot, `assets/desktop-${slugify(batch.batchId)}`);
    ensureDir(outputDir);
    const outputPath = path.join(outputDir, `${slugify(item.baseName, "image")}-${Date.now()}.png`);
    const generation = await generateOpenAIImageEditFromFile({
      inputPath: item.inputPath,
      mimeType,
      prompt: promptForOpenAIImageEdit(item.prompt),
      outputPath,
      settings,
      requireRegisteredMediaPath: false,
    });
    const quality = await checkGeneratedImageQuality(outputPath, item.prompt, listAssets());
    const compliance = checkEtsyCompliance(item.prompt, item.prompt, quality.reason);
    const asset: AssetRecord = {
      assetId: makeId("asset"),
      taskId: batch.batchId,
      productGroupId: item.itemId,
      sourceProductGroupId: item.itemId,
      batchId: batch.batchId,
      itemId: item.itemId,
      baseName: item.baseName,
      inputFileName: item.inputFileName,
      promptFileName: item.promptFileName,
      reviewStatus: "pending",
      originalFileNames: [item.inputFileName, item.promptFileName],
      generatedFilePath: outputPath,
      publicUrl: getAssetStorage().publicUrlForLocalPath(outputPath),
      prompt: item.prompt,
      optimizedPrompt: item.prompt,
      provider: "openai",
      imageGenerationMode: "product_reference",
      shotType: "hero_white_background",
      referenceAssetIds: [item.itemId],
      preserveProduct: true,
      usedReferenceImage: true,
      promptHash: item.promptHash,
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
    cleanupItemCandidate(item);
    saveAsset(asset);
    item.status = "generated";
    item.assetId = asset.assetId;
    item.publicUrl = asset.publicUrl;
    item.model = generation.model;
    item.size = generation.outputSize;
    item.quality = generation.quality;
    item.openaiRequestId = generation.openaiRequestId;
    item.providerTraceId = generation.providerTraceId;
    item.completedAt = nowIso();
    item.updatedAt = item.completedAt;
  } catch (error) {
    item.status = "failed";
    item.error = publicBatchItemError(error);
    if (isStructuredError(error)) {
      item.openaiRequestId = error.requestId;
      item.providerTraceId = error.requestId;
      item.model = error.model ?? settings.model;
    }
    item.updatedAt = nowIso();
  }
}

function promptForOpenAIImageEdit(userPrompt: string): string {
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
  ].join("\n");
}

function publicBatchItemError(error: unknown): string {
  if (isStructuredError(error)) {
    const reason = error.reason ? `\n${error.reason}` : "";
    const requestId = error.requestId ? `\nRequest ID: ${error.requestId}` : "";
    return `${error.code}: ${error.message}${reason}${requestId}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function scanDesktopPairs(folders: { inputDir: string; promptDir: string; outputDir: string }): DesktopPair[] {
  assertDirectory(folders.inputDir, "图片输入");
  assertDirectory(folders.promptDir, "提示词输入");
  const images = collectInputImages(folders.inputDir);
  const prompts = collectPromptFiles(folders.promptDir);
  const missingPrompts = [...images.keys()].filter((baseName) => !prompts.has(baseName));
  const missingImages = [...prompts.keys()].filter((baseName) => !images.has(baseName));
  if (missingPrompts.length > 0) throw new Error(`PROMPT_FILE_MISSING：缺少提示词文件：${missingPrompts.join(", ")}`);
  if (missingImages.length > 0) throw new Error(`INPUT_IMAGE_MISSING：缺少图片文件：${missingImages.join(", ")}`);
  return [...images.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "zh-CN", { numeric: true }))
    .map(([baseName, image]) => {
      const promptFile = prompts.get(baseName)!;
      const prompt = fs.readFileSync(promptFile.fullPath, "utf-8").trim();
      if (!prompt) throw new Error(`PROMPT_FILE_EMPTY：${promptFile.fileName} 内容为空。`);
      return {
        baseName,
        inputFileName: image.fileName,
        promptFileName: promptFile.fileName,
        inputPath: image.fullPath,
        promptPath: promptFile.fullPath,
        mimeType: image.mimeType,
        prompt,
      };
    });
}

function collectInputImages(dir: string): Map<string, { fileName: string; fullPath: string; mimeType: string }> {
  const images = new Map<string, { fileName: string; fullPath: string; mimeType: string }>();
  for (const entry of visibleFiles(dir)) {
    const ext = path.extname(entry).toLowerCase();
    const mimeType = IMAGE_EXTENSIONS.get(ext);
    if (!mimeType) continue;
    const baseName = path.basename(entry, ext);
    if (images.has(baseName)) throw new Error(`DUPLICATE_INPUT_BASENAME：图片输入中存在重复 basename：${baseName}`);
    images.set(baseName, { fileName: entry, fullPath: safeJoin(dir, entry), mimeType });
  }
  return images;
}

function collectPromptFiles(dir: string): Map<string, { fileName: string; fullPath: string }> {
  const prompts = new Map<string, { fileName: string; fullPath: string }>();
  for (const entry of visibleFiles(dir)) {
    const ext = path.extname(entry).toLowerCase();
    if (ext !== ".txt") continue;
    const baseName = path.basename(entry, ext);
    if (prompts.has(baseName)) throw new Error(`DUPLICATE_PROMPT_BASENAME：提示词输入中存在重复 basename：${baseName}`);
    prompts.set(baseName, { fileName: entry, fullPath: safeJoin(dir, entry) });
  }
  return prompts;
}

function visibleFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

function assertDirectory(dir: string, label: string): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`DESKTOP_FOLDER_NOT_FOUND：桌面“${label}”文件夹不存在。`);
  }
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

function mimeTypeForImageFile(fileName: string): string {
  const mimeType = IMAGE_EXTENSIONS.get(path.extname(fileName).toLowerCase());
  if (!mimeType) throw structuredError({ code: "UNSUPPORTED_INPUT_IMAGE_TYPE", message: "UNSUPPORTED_INPUT_IMAGE_TYPE：图片输入仅支持 JPEG、PNG 或 WebP。", provider: "openai" });
  return mimeType;
}

function cleanupItemCandidate(item: DesktopBatchItem): boolean {
  let deleted = false;
  if (item.assetId) deleted = deleteAsset(item.assetId) || deleted;
  const asset = item.assetId ? findAsset(item.assetId) : undefined;
  if (asset?.generatedFilePath && fs.existsSync(asset.generatedFilePath)) {
    fs.unlinkSync(asset.generatedFilePath);
    deleted = true;
  }
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

function saveBatch(batch: DesktopBatch): void {
  const batches = readBatches();
  const index = batches.findIndex((item) => item.batchId === batch.batchId);
  if (index >= 0) batches[index] = batch;
  else batches.unshift(batch);
  writeBatches(batches.slice(0, 50));
}

function readBatches(): DesktopBatch[] {
  try {
    return JSON.parse(fs.readFileSync(batchesFile, "utf-8")) as DesktopBatch[];
  } catch {
    return [];
  }
}

function writeBatches(batches: DesktopBatch[]): void {
  ensureDir(path.dirname(batchesFile));
  fs.writeFileSync(batchesFile, JSON.stringify(batches, null, 2), "utf-8");
}

function recomputeBatchCounts(batch: DesktopBatch): DesktopBatch {
  batch.generatedItems = batch.items.filter((item) => item.status === "generated").length;
  batch.approvedItems = batch.items.filter((item) => item.status === "approved").length;
  batch.failedItems = batch.items.filter((item) => item.status === "failed").length;
  batch.totalItems = batch.items.length;
  if (batch.approvedItems === batch.totalItems && batch.totalItems > 0) batch.status = "approved";
  return batch;
}

function publicBatch(batch: DesktopBatch): PublicDesktopBatch {
  const { items, ...rest } = recomputeBatchCounts(batch);
  return {
    ...rest,
    items: items.map(({ inputPath: _inputPath, promptPath: _promptPath, prompt, ...item }) => ({
      ...item,
      promptPreview: prompt.slice(0, 240),
    })),
  };
}
