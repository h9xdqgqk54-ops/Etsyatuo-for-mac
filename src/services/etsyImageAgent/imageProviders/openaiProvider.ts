import * as fs from "node:fs";
import * as path from "node:path";
import { isRegisteredMediaPath } from "../assetLibrary.js";
import { etsyAgentConfig } from "../config.js";
import { fetchWithTimeout, readResponseBufferLimited } from "../httpUtils.js";
import { normalizeGeneratedImage } from "../imageProcessing.js";
import { openAIFetch } from "../openaiHttpClient.js";
import { sanitizeOpenAIError } from "../secureConfig.js";
import { isStructuredError, structuredError } from "../structuredErrors.js";
import { ensureDir } from "../utils.js";
import type { UploadedImage } from "../types.js";
import type { GenerateImageInput, GenerateImageResult, ImageProvider } from "./types.js";

const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const OPENAI_IMAGE_TIMEOUT_MS = 300_000;
const RELAY_IMAGE_FIELD_NAMES = new Set(["b64_json", "base64", "image_base64", "url", "image_url"]);
const RELAY_RESPONSE_MAX_DEPTH = 5;
const RELAY_RESPONSE_MAX_NODES = 80;

export interface OpenAIImageEditFileInput {
  inputPath: string;
  mimeType: string;
  prompt: string;
  outputPath: string;
  settings: {
    apiKey: string;
    enableRealGeneration: boolean;
    baseURL?: string;
    model: string;
    imageSize: string;
    imageQuality?: string;
    inputFidelity?: "off" | "low" | "high";
  };
  requireRegisteredMediaPath?: boolean;
}

export const openaiProvider: ImageProvider = {
  id: "openai",
  async generate(input: GenerateImageInput, settings): Promise<GenerateImageResult> {
    ensureDir(path.dirname(input.outputPath));
    assertRealProviderAllowed("OpenAI", settings);
    const prompt = input.prompt.optimizedPrompt;

    if (input.imageGenerationMode === "product_reference") {
      const referenceImage = resolveSingleReferenceImage(input);
      return generateOpenAIImageEditFromFile({
        inputPath: referenceImage.storedPath,
        mimeType: referenceImage.mimeType,
        prompt,
        outputPath: input.outputPath,
        settings,
        requireRegisteredMediaPath: true,
      });
    }

    return generateOpenAITextImage(prompt, input.outputPath, settings);
  },
};

export async function generateOpenAIImageEditFromFile(input: OpenAIImageEditFileInput): Promise<GenerateImageResult> {
  ensureDir(path.dirname(input.outputPath));
  assertRealProviderAllowed("OpenAI", input.settings);
  validateReferenceImageForOpenAI({
    id: "local-reference",
    originalFileName: path.basename(input.inputPath),
    relativePath: path.basename(input.inputPath),
    storedPath: input.inputPath,
    publicUrl: "",
    mimeType: input.mimeType,
    sizeBytes: fs.existsSync(input.inputPath) ? fs.statSync(input.inputPath).size : 0,
    hash: "",
    perceptualKey: "",
    createdAt: "",
  }, input.requireRegisteredMediaPath ?? true);
  const { default: OpenAI, toFile } = await import("openai");
  const client = createOpenAIClient(OpenAI, input.settings.apiKey, input.settings.baseURL);
  let requestId: string | undefined;
  try {
    const editRequest = await buildOpenAIImageEditRequest({
      model: input.settings.model,
      image: await toFile(fs.createReadStream(input.inputPath), path.basename(input.inputPath), { type: input.mimeType }),
      prompt: input.prompt,
      size: input.settings.imageSize,
      quality: input.settings.imageQuality ?? etsyAgentConfig.openaiImageQuality,
      inputFidelity: input.settings.inputFidelity ?? etsyAgentConfig.openaiImageInputFidelity,
    });
    const editPromise = client.images.edit(editRequest as never);
    const { data, request_id } = await editPromise.withResponse();
    requestId = request_id ?? undefined;
    const imageBytes = await bytesFromImageEditResponse(data, input.settings.model, requestId);
    const output = await normalizeGeneratedImage(imageBytes, input.outputPath);
    return {
      provider: "openai",
      model: input.settings.model,
      outputSize: output.outputSize,
      quality: input.settings.imageQuality ?? etsyAgentConfig.openaiImageQuality,
      estimatedCost: "openai_dashboard_required",
      usedReferenceImage: true,
      referenceImageCount: 1,
      providerTraceId: requestId,
      openaiRequestId: requestId,
    };
  } catch (editError) {
    throw openAIImageEditError(editError, input.settings.model, requestId);
  }
}

export async function buildOpenAIImageEditRequest(input: {
  model: string;
  image: unknown;
  prompt: string;
  size: string;
  quality?: string;
  inputFidelity?: string;
}): Promise<Record<string, unknown>> {
  const inputFidelity = normalizeOpenAIInputFidelity(input.inputFidelity ?? etsyAgentConfig.openaiImageInputFidelity);
  const editRequest: Record<string, unknown> = {
    model: input.model,
    image: input.image,
    prompt: input.prompt,
    size: input.size,
    quality: normalizeOpenAIQuality(input.quality ?? etsyAgentConfig.openaiImageQuality),
    output_format: "png",
    background: "opaque",
    n: 1,
  };
  if (inputFidelity !== "off") editRequest.input_fidelity = inputFidelity;
  return editRequest;
}

export function assertRealProviderAllowed(name: string, settings: { enableRealGeneration: boolean; apiKey: string }): void {
  if (!settings.enableRealGeneration) {
    throw structuredError({
      code: "REAL_GENERATION_DISABLED",
      message: `REAL_GENERATION_DISABLED：真实 ${name} 图片生成未启用。请在私有部署中设置 IMAGE_AGENT_ENABLE_REAL_GENERATION=true。`,
      provider: "openai",
    });
  }
  if (!settings.apiKey) {
    throw structuredError({
      code: "OPENAI_API_KEY_MISSING",
      message: `OPENAI_API_KEY_MISSING：${name} API Key 未配置，无法调用真实图片生成。`,
      provider: "openai",
    });
  }
}

async function bytesFromImageResponse(result: unknown, model: string, requestId?: string): Promise<Buffer> {
  const candidate = findOpenAIImageCandidate(result);
  if (!candidate) {
    throw structuredError({
      code: "OPENAI_IMAGE_EMPTY_RESPONSE",
      message: "OPENAI_IMAGE_EMPTY_RESPONSE：OpenAI 图片接口返回成功，但响应中没有可保存的图片数据。",
      provider: "openai",
      model,
      requestId,
      reason: responseShape(result),
    });
  }
  if (candidate.kind === "base64") return decodeOpenAIImageBase64(candidate.value, model, requestId, responseShape(result));
  return bytesFromOpenAIImageUrl(candidate.value, model, requestId);
}

async function bytesFromImageEditResponse(result: unknown, model: string, requestId?: string): Promise<Buffer> {
  if (isAsyncIterable(result)) {
    let final: Buffer | null = null;
    for await (const event of result as AsyncIterable<{ type?: string; b64_json?: string }>) {
      if (event.type === "image_edit.completed" && event.b64_json) {
        final = decodeOpenAIImageBase64(event.b64_json, model, requestId, "stream:image_edit.completed");
      }
    }
    if (!final) {
      throw structuredError({
        code: "OPENAI_IMAGE_EMPTY_RESPONSE",
        message: "OPENAI_IMAGE_EMPTY_RESPONSE：OpenAI 图片接口返回成功，但流式响应中没有最终图片数据。",
        provider: "openai",
        model,
        requestId,
        reason: "stream:no_image_edit_completed_b64_json",
      });
    }
    return final;
  }
  return bytesFromImageResponse(result, model, requestId);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function resolveSingleReferenceImage(input: GenerateImageInput): UploadedImage {
  const inputAssetIds = input.inputAssetIds ?? [];
  if (inputAssetIds.length === 0) {
    throw structuredError({
      code: "INPUT_REFERENCE_IMAGE_REQUIRED",
      message: "INPUT_REFERENCE_IMAGE_REQUIRED：OpenAI product_reference 需要一张已上传的商品参考图。",
      provider: "openai",
    });
  }
  if (inputAssetIds.length > 1) {
    throw structuredError({
      code: "OPENAI_MULTI_REFERENCE_NOT_SUPPORTED_YET",
      message: "OPENAI_MULTI_REFERENCE_NOT_SUPPORTED_YET：当前 OpenAI 本地图生图先支持单张参考图，请先只选择一个主图。",
      provider: "openai",
    });
  }
  const image = (input.group?.images ?? []).find((item) => item.id === inputAssetIds[0]);
  if (!image) {
    throw structuredError({
      code: "INPUT_REFERENCE_IMAGE_REQUIRED",
      message: "INPUT_REFERENCE_IMAGE_REQUIRED：任务中的 inputAssetId 没有匹配到已上传商品图。",
      provider: "openai",
    });
  }
  return image;
}

function validateReferenceImageForOpenAI(image: UploadedImage, requireRegisteredMediaPath = true): void {
  if (requireRegisteredMediaPath && !isRegisteredMediaPath(image.storedPath)) {
    throw structuredError({
      code: "INPUT_ASSET_NOT_REGISTERED",
      message: "INPUT_ASSET_NOT_REGISTERED：参考图不是 Etsyauto 已登记上传素材，已拒绝读取本机路径。",
      provider: "openai",
    });
  }
  if (!fs.existsSync(image.storedPath)) {
    throw structuredError({
      code: "INPUT_ASSET_FILE_NOT_FOUND",
      message: "INPUT_ASSET_FILE_NOT_FOUND：参考图文件不存在，请重新上传商品图。",
      provider: "openai",
    });
  }
  if (!SUPPORTED_REFERENCE_MIME_TYPES.has(image.mimeType)) {
    throw structuredError({
      code: "UNSUPPORTED_INPUT_IMAGE_TYPE",
      message: "UNSUPPORTED_INPUT_IMAGE_TYPE：OpenAI 参考图仅支持 JPEG、PNG 或 WebP。",
      provider: "openai",
    });
  }
  const sizeMb = fs.statSync(image.storedPath).size / 1024 / 1024;
  if (sizeMb > etsyAgentConfig.openaiImageMaxInputMb) {
    throw structuredError({
      code: "INPUT_IMAGE_TOO_LARGE",
      message: `INPUT_IMAGE_TOO_LARGE：参考图超过 ${etsyAgentConfig.openaiImageMaxInputMb}MB，请压缩后重新上传。`,
      provider: "openai",
    });
  }
}

async function generateOpenAITextImage(prompt: string, outputPath: string, settings: {
  apiKey: string;
  enableRealGeneration: boolean;
  baseURL?: string;
  model: string;
  imageSize: string;
  imageQuality?: string;
}): Promise<GenerateImageResult> {
  assertRealProviderAllowed("OpenAI", settings);
  const { default: OpenAI } = await import("openai");
  const client = createOpenAIClient(OpenAI, settings.apiKey, settings.baseURL);
  const genResult = await client.images.generate({
    model: settings.model,
    prompt,
    size: settings.imageSize,
    quality: normalizeOpenAIQuality(settings.imageQuality ?? etsyAgentConfig.openaiImageQuality),
    output_format: "png",
    n: 1,
  } as never).catch((error: unknown) => {
    throw openAIImageEditError(error, settings.model);
  });
  const imageBytes = await bytesFromImageResponse(genResult, settings.model);
  const output = await normalizeGeneratedImage(imageBytes, outputPath);
  return {
    provider: "openai",
    model: settings.model,
    outputSize: output.outputSize,
    quality: settings.imageQuality ?? etsyAgentConfig.openaiImageQuality,
    estimatedCost: "openai_dashboard_required",
    usedReferenceImage: false,
    referenceImageCount: 0,
  };
}

type OpenAIImageCandidate = { kind: "base64" | "url"; value: string };

function findOpenAIImageCandidate(result: unknown): OpenAIImageCandidate | null {
  return findOpenAIImageCandidateOfKind(result, "base64") ?? findOpenAIImageCandidateOfKind(result, "url");
}

function findOpenAIImageCandidateOfKind(result: unknown, kind: OpenAIImageCandidate["kind"]): OpenAIImageCandidate | null {
  let visited = 0;
  const visit = (value: unknown, depth: number, fieldName?: string): OpenAIImageCandidate | null => {
    if (depth > RELAY_RESPONSE_MAX_DEPTH || visited > RELAY_RESPONSE_MAX_NODES) return null;
    visited += 1;
    if (typeof value === "string" && fieldName && RELAY_IMAGE_FIELD_NAMES.has(fieldName)) {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const fieldKind = fieldName === "url" || fieldName === "image_url" ? "url" : "base64";
      return fieldKind === kind ? { kind, value: trimmed } : null;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const found = visit(child, depth + 1, key);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(result, 0);
}

function decodeOpenAIImageBase64(value: string, model: string, requestId?: string, reason?: string): Buffer {
  const normalized = value.replace(/^data:image\/(?:png|jpeg|jpg|webp);base64,/i, "").trim();
  if (!normalized) {
    throw structuredError({
      code: "OPENAI_IMAGE_EMPTY_RESPONSE",
      message: "OPENAI_IMAGE_EMPTY_RESPONSE：OpenAI 图片接口返回了空的图片数据。",
      provider: "openai",
      model,
      requestId,
      reason,
    });
  }
  const buffer = Buffer.from(normalized, "base64");
  if (!isSupportedImageBuffer(buffer)) {
    throw structuredError({
      code: "OPENAI_IMAGE_INVALID_RESPONSE_IMAGE",
      message: "OPENAI_IMAGE_INVALID_RESPONSE_IMAGE：OpenAI 图片接口返回的数据不是有效的 PNG、JPEG 或 WebP 图片。",
      provider: "openai",
      model,
      requestId,
      reason,
    });
  }
  return buffer;
}

async function bytesFromOpenAIImageUrl(url: string, model: string, requestId?: string): Promise<Buffer> {
  if (url.startsWith("data:image/")) return decodeOpenAIImageBase64(url, model, requestId, "data_url");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw openAIImageDownloadError("返回的图片 URL 格式不正确。", model, requestId);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw openAIImageDownloadError("返回的图片 URL 不是 http(s) 地址。", model, requestId);
  }
  try {
    const res = await fetchWithTimeout(parsed.toString(), {}, "OpenAI 图片下载");
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (contentType && !contentType.toLowerCase().startsWith("image/")) {
      throw new Error(`Content-Type ${contentType}`);
    }
    const buffer = await readResponseBufferLimited(res, "OpenAI 图片下载");
    if (!isSupportedImageBuffer(buffer)) throw new Error("下载内容不是 PNG、JPEG 或 WebP 图片");
    return buffer;
  } catch (error) {
    throw openAIImageDownloadError(error instanceof Error ? error.message : String(error), model, requestId);
  }
}

function openAIImageDownloadError(reason: string, model: string, requestId?: string): Error {
  return structuredError({
    code: "OPENAI_IMAGE_DOWNLOAD_FAILED",
    message: "OPENAI_IMAGE_DOWNLOAD_FAILED：OpenAI 返回了图片 URL，但下载或校验图片失败。",
    provider: "openai",
    model,
    requestId,
    reason,
  });
}

function isSupportedImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  const isPng = buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  const isWebp = buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return isPng || isJpeg || isWebp;
}

function responseShape(value: unknown): string {
  if (typeof value !== "object" || value === null) return `type:${typeof value}`;
  const root = value as Record<string, unknown>;
  const parts = [`keys:${Object.keys(root).slice(0, 12).join(",") || "none"}`];
  if (Array.isArray(root.data)) {
    parts.push(`dataLength:${root.data.length}`);
    const first = root.data[0];
    if (typeof first === "object" && first !== null) parts.push(`firstDataKeys:${Object.keys(first as Record<string, unknown>).slice(0, 12).join(",") || "none"}`);
  }
  if (Array.isArray(root.output)) {
    parts.push(`outputLength:${root.output.length}`);
    const first = root.output[0];
    if (typeof first === "object" && first !== null) parts.push(`firstOutputKeys:${Object.keys(first as Record<string, unknown>).slice(0, 12).join(",") || "none"}`);
  }
  return parts.join("; ");
}

function normalizeOpenAIQuality(value: string): "low" | "medium" | "high" | "auto" {
  return value === "medium" || value === "high" || value === "auto" ? value : "low";
}

function normalizeOpenAIInputFidelity(value: string): "off" | "low" | "high" {
  return value === "low" || value === "high" ? value : "off";
}

function createOpenAIClient(OpenAI: new (options: { apiKey: string; baseURL?: string; timeout: number; maxRetries: number; fetch?: typeof fetch }) => InstanceType<typeof import("openai").default>, apiKey: string, baseURL?: string): InstanceType<typeof import("openai").default> {
  const proxyFetch = openAIFetch();
  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    timeout: OPENAI_IMAGE_TIMEOUT_MS,
    maxRetries: 2,
    ...(proxyFetch ? { fetch: proxyFetch } : {}),
  });
}

function openAIImageEditError(error: unknown, model: string, fallbackRequestId?: string): Error {
  if (error instanceof Error && isStructuredError(error)) return error as Error;
  const status = (error as { status?: number })?.status;
  const code = String((error as { code?: string; error?: { code?: string } })?.code ?? (error as { error?: { code?: string } })?.error?.code ?? "");
  const type = String((error as { type?: string; error?: { type?: string } })?.type ?? (error as { error?: { type?: string } })?.error?.type ?? "");
  const param = String((error as { param?: string; error?: { param?: string } })?.param ?? (error as { error?: { param?: string } })?.error?.param ?? "");
  const requestId = String((error as { request_id?: string; _request_id?: string })?.request_id ?? (error as { _request_id?: string })?._request_id ?? fallbackRequestId ?? "") || undefined;
  const raw = openAIErrorText(error);
  const text = `${code} ${type} ${param} ${raw}`.toLowerCase();
  if (text.includes("organization") && (text.includes("verify") || text.includes("verification"))) {
    return structuredError({
      code: "OPENAI_ORG_VERIFICATION_REQUIRED",
      message: "OPENAI_ORG_VERIFICATION_REQUIRED：OpenAI 组织或账号需要完成验证后才能使用该图片模型。",
      provider: "openai",
      model,
      requestId,
      statusCode: status,
      reason: sanitizeOpenAIError(error),
    });
  }
  if (text.includes("quota") || text.includes("insufficient_quota") || text.includes("billing")) {
    return structuredError({
      code: "OPENAI_INSUFFICIENT_QUOTA",
      message: "OPENAI_INSUFFICIENT_QUOTA：OpenAI 额度或账单不可用，请检查账户额度后重试。",
      provider: "openai",
      model,
      requestId,
      statusCode: status,
      reason: sanitizeOpenAIError(error),
    });
  }
  if (status === 429 || text.includes("rate limit")) {
    return structuredError({
      code: "OPENAI_RATE_LIMITED",
      message: "OPENAI_RATE_LIMITED：OpenAI 请求触发限流，请稍后重试或降低生成数量。",
      provider: "openai",
      model,
      requestId,
      statusCode: status,
      reason: sanitizeOpenAIError(error),
    });
  }
  if (status === 408 || text.includes("timed out") || text.includes("timeout")) {
    return structuredError({
      code: "OPENAI_IMAGE_EDIT_FAILED",
      message: "OPENAI_IMAGE_EDIT_FAILED：OpenAI 图片编辑请求超时，未保存任何伪造结果。请稍后重试或降低并发。",
      provider: "openai",
      model,
      requestId,
      statusCode: status,
      reason: sanitizeOpenAIError(error),
    });
  }
  if (
    status === 400 && (
      text.includes("input_fidelity") ||
      text.includes("unsupported parameter") ||
      text.includes("unknown parameter") ||
      text.includes("invalid parameter") ||
      (text.includes("does not support") && text.includes("parameter"))
    )
  ) {
    return structuredError({
      code: "OPENAI_IMAGE_PARAMETER_UNSUPPORTED",
      message: "OPENAI_IMAGE_PARAMETER_UNSUPPORTED：当前模型或中转站不支持请求中的图片参数。请在 OpenAI 设置页将 Input fidelity 设为 off，或更换支持该参数的模型/中转站。",
      provider: "openai",
      model,
      requestId,
      statusCode: status,
      reason: sanitizeOpenAIError(error),
    });
  }
  if (
    status === 403 ||
    status === 404 ||
    (status === 400 && param === "model") ||
    text.includes("model") ||
    text.includes("not found") ||
    text.includes("not have access") ||
    text.includes("unsupported model") ||
    text.includes("invalid model")
  ) {
    return structuredError({
      code: "OPENAI_IMAGE_MODEL_UNAVAILABLE",
      message: "OPENAI_IMAGE_MODEL_UNAVAILABLE：当前 OpenAI 账号无法使用所选图片模型，请检查模型权限或组织状态。",
      provider: "openai",
      model,
      requestId,
      statusCode: status,
      reason: sanitizeOpenAIError(error),
    });
  }
  return structuredError({
    code: "OPENAI_IMAGE_EDIT_FAILED",
    message: "OPENAI_IMAGE_EDIT_FAILED：OpenAI 图片编辑失败，未保存任何伪造结果。",
    provider: "openai",
    model,
    requestId,
    statusCode: status,
    reason: sanitizeOpenAIError(error),
  });
}

function openAIErrorText(error: unknown): string {
  if (error instanceof Error) {
    const details = error as Error & { code?: string; type?: string; param?: string; error?: unknown };
    return [
      error.message,
      details.code,
      details.type,
      details.param,
      typeof details.error === "object" && details.error !== null ? JSON.stringify(details.error) : "",
    ].filter(Boolean).join(" ");
  }
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}
