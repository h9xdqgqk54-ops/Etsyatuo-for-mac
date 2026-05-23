import { etsyAgentConfig } from "./config.js";
import { findInputAsset, requireInputAsset, scanInputAssets } from "./inputAssetRegistry.js";
import { readJsonFile, writeJsonFile } from "./jsonFile.js";
import { gpt55PromptProvider } from "./promptProviders/gpt55PromptProvider.js";
import { getEffectiveGpt55PromptSettings, sanitizeProviderError } from "./secureConfig.js";
import { isStructuredError, structuredError } from "./structuredErrors.js";
import type { ImagePromptErrorDetails, ImagePromptRecord, ImagePromptRole, ImagePromptStatus, InputAssetRecord } from "./types.js";
import { hashBuffer, makeId, nowIso } from "./utils.js";

export interface GeneratePromptsInput {
  assetIds?: string[];
  productGroupId?: string;
  stylePreset?: "american_vintage_etsy";
  roles?: ImagePromptRole[];
  mode?: "missing" | "regenerate";
}

export interface GeneratePromptsResult {
  records: ImagePromptRecord[];
  failed: ImagePromptRecord[];
  skipped: Array<{ inputAssetId: string; reason: string; status?: ImagePromptStatus }>;
}

export interface SaveManualPromptInput {
  inputAssetId: string;
  role?: ImagePromptRole;
  promptText: string;
  negativePrompt?: string;
  productGroupId?: string;
}

export function listImagePromptRecords(inputAssetId?: string): ImagePromptRecord[] {
  const records = readPromptRecords();
  return inputAssetId ? records.filter((record) => record.inputAssetId === inputAssetId) : records;
}

export function findImagePromptRecord(promptId: string): ImagePromptRecord | undefined {
  return readPromptRecords().find((record) => record.id === promptId);
}

export function findBestPromptRecord(inputAssetId: string): ImagePromptRecord | undefined {
  const priority: Record<ImagePromptStatus, number> = { approved: 3, edited: 2, generated: 1, failed: 0 };
  return listImagePromptRecords(inputAssetId)
    .filter((record) => record.promptText.trim() && record.status !== "failed")
    .sort((a, b) => (priority[b.status] - priority[a.status]) || b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function clearStalePromptProviderFailures(): { deleted: number } {
  const records = readPromptRecords();
  const kept = records.filter((record) => !isStalePromptProviderFailure(record));
  const deleted = records.length - kept.length;
  if (deleted > 0) writePromptRecords(kept);
  return { deleted };
}

export async function generatePromptsFromImages(input: GeneratePromptsInput = {}): Promise<GeneratePromptsResult> {
  const scan = scanInputAssets();
  const assetMap = new Map(scan.assets.map((asset) => [asset.inputAssetId, asset]));
  const selectedAssets = (input.assetIds?.length ? input.assetIds.map((id) => {
    const asset = assetMap.get(id) ?? findInputAsset(id);
    if (!asset) throw structuredError({ code: "INPUT_ASSET_NOT_FOUND", message: "INPUT_ASSET_NOT_FOUND：未找到已登记的输入图片。", provider: "gpt55" });
    return asset;
  }) : scan.assets);

  const records = readPromptRecords();
  const toGenerate: Array<{ asset: InputAssetRecord; roleHint: ImagePromptRole }> = [];
  const skipped: GeneratePromptsResult["skipped"] = [];
  for (let selectedIndex = 0; selectedIndex < selectedAssets.length; selectedIndex += 1) {
    const asset = selectedAssets[selectedIndex]!;
    const existing = newestRecordForAsset(records, asset.inputAssetId);
    if (existing?.status === "edited" || existing?.status === "approved") {
      skipped.push({ inputAssetId: asset.inputAssetId, reason: "manual_prompt_preserved", status: existing.status });
      continue;
    }
    if (input.mode !== "regenerate" && existing?.status === "generated") {
      skipped.push({ inputAssetId: asset.inputAssetId, reason: "prompt_already_generated", status: existing.status });
      continue;
    }
    toGenerate.push({ asset, roleHint: input.roles?.[selectedIndex] ?? "main" });
  }

  if (toGenerate.length > etsyAgentConfig.gpt55BatchLimit) {
    throw structuredError({
      code: "PROMPT_BATCH_LIMIT_EXCEEDED",
      message: `PROMPT_BATCH_LIMIT_EXCEEDED：单次最多生成 ${etsyAgentConfig.gpt55BatchLimit} 条提示词，当前 ${toGenerate.length} 条。`,
      provider: "gpt55",
      model: etsyAgentConfig.gpt55Model,
    });
  }
  if (toGenerate.length > 0) assertPromptProviderReadyForGeneration();

  const generated: ImagePromptRecord[] = [];
  const failed: ImagePromptRecord[] = [];
  for (const { asset, roleHint } of toGenerate) {
    const existing = newestRecordForAsset(records, asset.inputAssetId);
    try {
      const providerResult = await gpt55PromptProvider.generatePrompt({
        asset,
        productGroupId: input.productGroupId ?? asset.inputAssetId,
        roleHint,
        stylePreset: input.stylePreset ?? "american_vintage_etsy",
      });
      const now = nowIso();
      const record: ImagePromptRecord = {
        id: existing && (existing.status === "generated" || existing.status === "failed") ? existing.id : makeId("prompt"),
        inputAssetId: asset.inputAssetId,
        productGroupId: input.productGroupId ?? asset.inputAssetId,
        role: providerResult.role,
        detectedProduct: providerResult.detectedProduct,
        promptText: providerResult.promptText,
        negativePrompt: providerResult.negativePrompt,
        source: "gpt55-vision",
        status: "generated",
        confidence: providerResult.confidence,
        model: providerResult.model,
        promptHash: promptHash(providerResult.promptText, providerResult.negativePrompt),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        providerTraceId: providerResult.providerTraceId,
        promptProviderRequestId: providerResult.promptProviderRequestId,
        error: undefined,
      };
      upsertPromptRecord(records, record);
      generated.push(record);
    } catch (error) {
      if (isPromptProviderConfigurationError(error)) {
        writePromptRecords(records);
        throw error;
      }
      const record = failedPromptRecord(asset, input.productGroupId ?? asset.inputAssetId, roleHint, existing, error);
      upsertPromptRecord(records, record);
      failed.push(record);
    }
  }
  writePromptRecords(records);
  return { records: generated, failed, skipped };
}

export function updateImagePromptRecord(promptId: string, input: {
  role?: ImagePromptRole;
  promptText?: string;
  negativePrompt?: string;
  status?: "edited" | "approved";
}): ImagePromptRecord {
  const records = readPromptRecords();
  const record = records.find((item) => item.id === promptId);
  if (!record) throw structuredError({ code: "PROMPT_RECORD_NOT_FOUND", message: "PROMPT_RECORD_NOT_FOUND：未找到提示词记录。", provider: "gpt55" });
  if (input.role) record.role = input.role;
  if (typeof input.promptText === "string") record.promptText = input.promptText.trim();
  if (typeof input.negativePrompt === "string") record.negativePrompt = input.negativePrompt.trim();
  if (!record.promptText) throw structuredError({ code: "PROMPT_REQUIRED", message: "PROMPT_REQUIRED：提示词不能为空。", provider: "gpt55" });
  record.status = input.status ?? "edited";
  record.promptHash = promptHash(record.promptText, record.negativePrompt);
  record.error = undefined;
  record.updatedAt = nowIso();
  writePromptRecords(records);
  return record;
}

export function saveManualImagePromptRecord(input: SaveManualPromptInput): ImagePromptRecord {
  const asset = requireInputAsset(input.inputAssetId);
  const promptText = input.promptText.trim();
  if (!promptText) throw structuredError({ code: "PROMPT_REQUIRED", message: "PROMPT_REQUIRED：提示词不能为空。", provider: "gpt55" });
  const records = readPromptRecords();
  const existing = newestRecordForAsset(records, asset.inputAssetId);
  const now = nowIso();
  const record: ImagePromptRecord = {
    id: existing && (existing.status === "generated" || existing.status === "failed" || existing.status === "edited") ? existing.id : makeId("prompt"),
    inputAssetId: asset.inputAssetId,
    productGroupId: input.productGroupId ?? existing?.productGroupId ?? asset.inputAssetId,
    role: input.role ?? existing?.role ?? "main",
    detectedProduct: existing?.detectedProduct ?? "",
    promptText,
    negativePrompt: input.negativePrompt?.trim() ?? existing?.negativePrompt ?? "",
    source: "gpt55-vision",
    status: "edited",
    confidence: existing?.confidence ?? 1,
    model: existing?.model ?? "manual",
    promptHash: promptHash(promptText, input.negativePrompt?.trim() ?? existing?.negativePrompt ?? ""),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    error: undefined,
  };
  upsertPromptRecord(records, record);
  writePromptRecords(records);
  return record;
}

export async function regenerateImagePromptRecord(promptId: string, input: { confirmedOverwrite?: boolean } = {}): Promise<ImagePromptRecord> {
  const records = readPromptRecords();
  const existing = records.find((record) => record.id === promptId);
  if (!existing) throw structuredError({ code: "PROMPT_RECORD_NOT_FOUND", message: "PROMPT_RECORD_NOT_FOUND：未找到提示词记录。", provider: "gpt55" });
  if ((existing.status === "edited" || existing.status === "approved") && !input.confirmedOverwrite) {
    throw structuredError({
      code: "PROMPT_OVERWRITE_CONFIRMATION_REQUIRED",
      message: "PROMPT_OVERWRITE_CONFIRMATION_REQUIRED：这条提示词已人工编辑或通过，重新生成需要确认覆盖。",
      provider: "gpt55",
    });
  }
  let updated: ImagePromptRecord;
  try {
    assertPromptProviderReadyForGeneration();
    const asset = requireInputAsset(existing.inputAssetId);
    const providerResult = await gpt55PromptProvider.generatePrompt({
      asset,
      productGroupId: existing.productGroupId,
      roleHint: existing.role,
      stylePreset: "american_vintage_etsy",
    });
    updated = {
      ...existing,
      role: providerResult.role,
      detectedProduct: providerResult.detectedProduct,
      promptText: providerResult.promptText,
      negativePrompt: providerResult.negativePrompt,
      status: "generated",
      confidence: providerResult.confidence,
      model: providerResult.model,
      promptHash: promptHash(providerResult.promptText, providerResult.negativePrompt),
      updatedAt: nowIso(),
      providerTraceId: providerResult.providerTraceId,
      promptProviderRequestId: providerResult.promptProviderRequestId,
      error: undefined,
    };
  } catch (error) {
    if (isPromptProviderConfigurationError(error)) throw error;
    const asset = findInputAsset(existing.inputAssetId);
    updated = failedPromptRecord(asset ?? promptAssetFallback(existing), existing.productGroupId, existing.role, existing, error);
  }
  upsertPromptRecord(records, updated);
  writePromptRecords(records);
  return updated;
}

export function promptHash(promptText: string, negativePrompt = ""): string {
  return hashBuffer(Buffer.from(`${promptText}\n---negative---\n${negativePrompt}`)).slice(0, 16);
}

function newestRecordForAsset(records: ImagePromptRecord[], inputAssetId: string): ImagePromptRecord | undefined {
  return records
    .filter((record) => record.inputAssetId === inputAssetId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

function upsertPromptRecord(records: ImagePromptRecord[], record: ImagePromptRecord): void {
  const index = records.findIndex((item) => item.id === record.id);
  if (index >= 0) records[index] = record;
  else records.unshift(record);
}

function isStalePromptProviderFailure(record: ImagePromptRecord): boolean {
  if (record.status !== "failed") return false;
  const code = typeof record.error === "string" ? record.error : record.error?.code;
  const currentModel = getEffectiveGpt55PromptSettings().model;
  if (!code || !STALE_PROMPT_PROVIDER_FAILURE_CODES.has(code)) return false;
  if (!record.promptText.trim()) return true;
  return Boolean(record.model && record.model !== currentModel);
}

const STALE_PROMPT_PROVIDER_FAILURE_CODES = new Set([
  "GPT55_MODEL_NOT_ACCESSIBLE",
  "GPT55_VISION_NOT_SUPPORTED",
  "GPT55_CONFIG_VALIDATION_FAILED",
  "GPT55_API_KEY_MISSING",
  "GPT55_AUTH_FAILED",
  "GPT55_PERMISSION_DENIED",
]);

const PROMPT_PROVIDER_CONFIGURATION_ERROR_CODES = new Set([
  "GPT55_API_KEY_MISSING",
  "GPT55_MODEL_MISSING",
  "GPT55_MODEL_NOT_ACCESSIBLE",
  "GPT55_AUTH_FAILED",
  "GPT55_PERMISSION_DENIED",
  "GPT55_VISION_NOT_SUPPORTED",
  "GPT55_CONFIG_VALIDATION_FAILED",
  "GPT55_INPUT_METHOD_UNSUPPORTED",
]);

function assertPromptProviderReadyForGeneration(): void {
  const settings = getEffectiveGpt55PromptSettings();
  if (!settings.apiKey) {
    throw structuredError({
      code: "GPT55_API_KEY_MISSING",
      message: "GPT55_API_KEY_MISSING：GPT5.5图片理解需要配置 GPT55_API_KEY。",
      provider: "gpt55",
      model: settings.model,
    });
  }
  if (!settings.model.trim()) {
    throw structuredError({
      code: "GPT55_MODEL_MISSING",
      message: "GPT55_MODEL_MISSING：请配置支持图片理解的 GPT55_MODEL。",
      provider: "gpt55",
    });
  }
  if (/seedream/i.test(settings.model)) {
    throw structuredError({
      code: "GPT55_MODEL_NOT_ACCESSIBLE",
      message: "GPT55_MODEL_NOT_ACCESSIBLE：GPT55_MODEL 必须是图片理解/多模态理解模型，不得使用 Seedream 图生图模型。",
      provider: "gpt55",
      model: settings.model,
    });
  }
}

function isPromptProviderConfigurationError(error: unknown): boolean {
  return isStructuredError(error) && PROMPT_PROVIDER_CONFIGURATION_ERROR_CODES.has(error.code);
}

function failedPromptRecord(
  asset: InputAssetRecord,
  productGroupId: string,
  roleHint: ImagePromptRole,
  existing: ImagePromptRecord | undefined,
  error: unknown,
): ImagePromptRecord {
  const details = promptErrorDetails(error);
  const now = nowIso();
  return {
    id: existing && (existing.status === "generated" || existing.status === "failed") ? existing.id : makeId("prompt"),
    inputAssetId: asset.inputAssetId,
    productGroupId,
    role: existing?.role ?? roleHint,
    detectedProduct: existing?.detectedProduct ?? "",
    promptText: existing?.promptText ?? "",
    negativePrompt: existing?.negativePrompt ?? "",
    source: "gpt55-vision",
    status: "failed",
    confidence: 0,
    model: details.model ?? getEffectiveGpt55PromptSettings().model,
    promptHash: promptHash(existing?.promptText ?? "", existing?.negativePrompt ?? ""),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    error: details,
    providerTraceId: details.requestId,
    promptProviderRequestId: details.requestId,
  };
}

function promptErrorDetails(error: unknown): ImagePromptErrorDetails {
  const model = getEffectiveGpt55PromptSettings().model;
  if (isStructuredError(error)) {
    return {
      code: error.code,
      message: error.message,
      provider: "gpt55",
      model: error.model ?? model,
      requestId: error.requestId,
      statusCode: error.statusCode,
      reason: error.reason,
    };
  }
  return {
    code: "GPT55_PROMPT_GENERATION_FAILED",
    message: "GPT55_PROMPT_GENERATION_FAILED：GPT5.5图片理解生成提示词失败。",
    provider: "gpt55",
    model,
    reason: sanitizeProviderError(error),
  };
}

function promptAssetFallback(record: ImagePromptRecord): InputAssetRecord {
  return {
    inputAssetId: record.inputAssetId,
    displayName: record.inputAssetId,
    baseName: record.inputAssetId,
    fileName: record.inputAssetId,
    filePath: "",
    mimeType: "image/jpeg",
    sizeBytes: 0,
    hash: "",
    publicUrl: "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function readPromptRecords(): ImagePromptRecord[] {
  return readJsonFile<ImagePromptRecord[]>(etsyAgentConfig.promptRecordsPath, []);
}

function writePromptRecords(records: ImagePromptRecord[]): void {
  writeJsonFile(etsyAgentConfig.promptRecordsPath, records);
}
