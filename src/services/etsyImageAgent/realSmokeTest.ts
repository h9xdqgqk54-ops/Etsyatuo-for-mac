import * as path from "node:path";
import { etsyAgentConfig, publicUrlForStoragePath } from "./config.js";
import { checkEtsyCompliance } from "./complianceService.js";
import { generateImage, getCurrentImageProviderSettings } from "./imageProviders/registry.js";
import { checkGeneratedImageQuality } from "./qualityService.js";
import { saveAsset, listAssets } from "./assetLibrary.js";
import { appendSecurityEvent, getImageProviderConfig } from "./secureConfig.js";
import type { AssetRecord } from "./types.js";
import { ensureDir, makeId, nowIso } from "./utils.js";

export interface RealImageSmokeTestResult {
  provider: string;
  model: string;
  size: string;
  quality: string;
  durationMs: number;
  estimatedCost?: string;
  assetId: string;
}

export function assertRealImageSmokeTestAllowed(): void {
  const settings = getImageProviderConfig();
  if (!settings.realGenerationEnabled) throw new Error("真实图片生成未启用。请设置 IMAGE_AGENT_ENABLE_REAL_GENERATION=true。");
  if (!settings.providers.openai.configured) {
    throw new Error("OPENAI_API_KEY_MISSING：当前选择 OpenAI Image，但未检测到 OPENAI_API_KEY。请在 .env 设置 OPENAI_API_KEY 后重启 pnpm dev。");
  }
}

export async function runRealImageSmokeTest(): Promise<RealImageSmokeTestResult> {
  assertRealImageSmokeTestAllowed();
  const settings = getCurrentImageProviderSettings();
  const started = Date.now();
  appendSecurityEvent("real_image_smoke_test_started", {
    provider: settings.provider,
    model: settings.model,
    imageSize: settings.imageSize,
    keyFingerprint: settings.keyFingerprint,
    fixedQuantity: 1,
  });

  const prompt = [
    "Generate exactly one square Etsy listing product photo smoke test image.",
    "Subject: a simple unbranded handmade ceramic tray used only for provider connection validation.",
    "Style: clean product photography, neutral background, soft studio lighting, centered composition, thumbnail friendly.",
    "Output intent: verify real image generation can write into the local Etsyauto asset library.",
    "Constraints: no logos, no watermark, no misleading brand, no text, no fake certification, do not imply an actual Etsy listing approval.",
  ].join(" ");

  try {
    const productGroupId = `${settings.provider}-smoke-test`;
    const dir = path.join(etsyAgentConfig.storageRoot, "assets", `product-${settings.provider}-smoke-test`);
    ensureDir(dir);
    const outputPath = path.join(dir, `generated-smoke-${Date.now()}.png`);
    const generation = await generateImage({
      provider: settings.provider,
      prompt: { optimizedPrompt: prompt },
      outputPath,
    });
    const quality = await checkGeneratedImageQuality(outputPath, prompt, listAssets());
    const compliance = checkEtsyCompliance(`${settings.provider} real image smoke test`, prompt, quality.reason);
    const asset = buildSmokeTestAsset({
      provider: generation.provider,
      model: generation.model,
      outputSize: generation.outputSize,
      providerQuality: generation.quality,
      productGroupId,
      outputPath,
      prompt,
      qualityStatus: quality.status,
      qualityReason: quality.reason,
      etsyComplianceStatus: compliance.status,
      etsyComplianceReason: compliance.reason,
    });
    saveAsset(asset);
    const durationMs = Date.now() - started;
    appendSecurityEvent("real_image_smoke_test_succeeded", {
      provider: settings.provider,
      model: generation.model,
      assetId: asset.assetId,
      durationMs,
      keyFingerprint: settings.keyFingerprint,
    });
    return {
      provider: generation.provider,
      model: generation.model,
      size: generation.outputSize,
      quality: quality.status,
      durationMs,
      estimatedCost: generation.estimatedCost,
      assetId: asset.assetId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendSecurityEvent("real_image_smoke_test_failed", {
      provider: settings.provider,
      model: settings.model,
      keyFingerprint: settings.keyFingerprint,
      reason: message,
    });
    throw new Error(message);
  }
}

export function buildSmokeTestAsset(input: {
  provider: AssetRecord["provider"];
  model: string;
  outputSize: string;
  providerQuality?: string;
  productGroupId: string;
  outputPath: string;
  prompt: string;
  qualityStatus: AssetRecord["qualityStatus"];
  qualityReason: string;
  etsyComplianceStatus: AssetRecord["etsyComplianceStatus"];
  etsyComplianceReason: string;
}): AssetRecord {
  return {
    assetId: makeId("asset"),
    taskId: `${input.provider}-smoke-test`,
    productGroupId: input.productGroupId,
    sourceProductGroupId: input.productGroupId,
    originalFileNames: [],
    generatedFilePath: input.outputPath,
    publicUrl: publicUrlForStoragePath(input.outputPath),
    prompt: `${input.provider} real image smoke test`,
    optimizedPrompt: input.prompt,
    provider: input.provider,
    model: input.model,
    createdAt: nowIso(),
    qualityStatus: input.qualityStatus,
    qualityReason: input.qualityReason,
    generationIndex: 0,
    platform: "etsy",
    etsyImageType: "main",
    etsyComplianceStatus: input.etsyComplianceStatus,
    etsyComplianceReason: input.etsyComplianceReason,
    recommendedListingOrder: 1,
    outputSize: input.outputSize,
    size: input.outputSize,
    providerQuality: input.providerQuality,
    aspectRatio: "1:1",
    originalityRiskLevel: "low",
  };
}
