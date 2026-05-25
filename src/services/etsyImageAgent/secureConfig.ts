import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_DOUBAO_PROMPT_MODEL, DEFAULT_GPT55_MODEL, LEGACY_DOUBAO_PROMPT_MODEL, etsyAgentConfig } from "./config.js";
import { fetchWithTimeout, readResponseTextLimited } from "./httpUtils.js";
import type { ImageProviderId, PromptProviderId } from "./types.js";
import { ensureDir, nowIso } from "./utils.js";

export type ApiKeySource = "env" | "session" | "none" | "not_configured";
export type OpenAIBaseURLSource = "env" | "session" | "default";
export type OpenAIInputFidelity = "off" | "low" | "high";
export type OpenAIInputFidelitySource = "env" | "session" | "default";
export type OpenAIImageModelSource = "env" | "session" | "default";

export interface ImageProviderDiagnostic {
  code: string;
  severity: "info" | "warn" | "error";
  message: string;
}

export interface OpenAIProviderStatus {
  configured: boolean;
  ready: boolean;
  required: boolean;
  keySource: "env" | "session" | "none";
  maskedKey?: string;
  fingerprint?: string;
  baseURL?: string;
  baseURLSource: OpenAIBaseURLSource;
  model: string;
  modelSource: OpenAIImageModelSource;
  imageSize: string;
  imageQuality: string;
  inputFidelity: OpenAIInputFidelity;
  inputFidelitySource: OpenAIInputFidelitySource;
}

export interface ImageProviderConfig {
  selectedProvider: ImageProviderId;
  realGenerationEnabled: boolean;
  mockMode: false;
  providers: {
    openai: OpenAIProviderStatus;
  };
  diagnostics: string[];
  diagnosticsDetailed: ImageProviderDiagnostic[];
}

export interface OpenAISettingsStatus {
  configured: boolean;
  source: ApiKeySource;
  maskedKey: string;
  keyFingerprint: string;
  mode: "real";
  provider: ImageProviderId;
  selectedProvider: ImageProviderId;
  model: string;
  modelSource: OpenAIImageModelSource;
  imageSize: string;
  imageQuality: string;
  inputFidelity: OpenAIInputFidelity;
  inputFidelitySource: OpenAIInputFidelitySource;
  baseURL: string;
  baseURLSource: OpenAIBaseURLSource;
  imageProviderConfig: ImageProviderConfig;
  providers: Array<OpenAIProviderStatus & {
    id: ImageProviderId;
    label: string;
    source: ApiKeySource;
  }>;
  providersById: {
    openai: OpenAIProviderStatus;
  };
  diagnostics: ImageProviderDiagnostic[];
  maxConcurrentGenerations: number;
  maxBatchGeneratedImages: number;
  enableRealGeneration: boolean;
  flags: {
    realGenerationEnabled: boolean;
    mockMode: false;
  };
  promptProvider: PromptProviderStatus;
  allowWebKeyConfig: boolean;
  configPath: string;
}

export interface EffectiveOpenAISettings extends OpenAISettingsStatus {
  apiKey: string;
}

export interface PromptProviderStatus {
  provider: PromptProviderId;
  configured: boolean;
  ready: boolean;
  required: boolean;
  apiKeyConfigured: boolean;
  keySource: "env" | "session" | "none";
  maskedKey: string;
  fingerprint: string;
  baseURL: string;
  baseURLSource: "env" | "session" | "default";
  model: string;
  modelConfigured: boolean;
  modelSource: "env" | "session" | "default" | "none";
  modelEffectiveSource: "env" | "session" | "default" | "none";
  modelOverriddenBySession: boolean;
  pendingModel?: string;
  pendingModelSource?: "session";
  pendingBaseURL?: string;
  pendingBaseURLSource?: "session";
  recommendedModel: string;
  maxInputMb: number;
  batchLimit: number;
  supportsImageInput: "unknown" | "configured" | "validated" | "failed";
  validationStatus: "unknown" | "validated" | "failed";
  lastValidationError?: DoubaoPromptValidationError;
}

export interface DoubaoPromptValidationError {
  code: string;
  message: string;
  requestId?: string;
  statusCode?: number;
  reason?: string;
}

export interface EffectiveDoubaoPromptSettings extends PromptProviderStatus {
  apiKey: string;
}

export type PromptProviderValidationError = DoubaoPromptValidationError;

export interface EffectiveGpt55PromptSettings extends PromptProviderStatus {
  apiKey: string;
}

export interface ProviderSecret {
  apiKey: string;
  configured: boolean;
  source: "env" | "session" | "none";
  maskedKey: string;
  keyFingerprint: string;
}

let sessionOpenAIApiKey = "";
let sessionOpenAIBaseURL: string | undefined;
let sessionOpenAIImageModel = "";
let sessionOpenAIInputFidelity: OpenAIInputFidelity | undefined;
let hasSessionOpenAIInputFidelity = false;
let sessionArkApiKey = "";
let sessionArkBaseURL: string | undefined;
let sessionDoubaoPromptModel = "";
let sessionGpt55ApiKey = "";
let sessionGpt55BaseURL: string | undefined;
let sessionGpt55Model = "";
let pendingSessionArkBaseURL: string | undefined;
let hasPendingSessionArkBaseURL = false;
let pendingSessionDoubaoPromptModel = "";
let doubaoPromptValidationStatus: PromptProviderStatus["validationStatus"] = "unknown";
let doubaoPromptLastValidationError: DoubaoPromptValidationError | undefined;
let gpt55PromptValidationStatus: PromptProviderStatus["validationStatus"] = "unknown";
let gpt55PromptLastValidationError: PromptProviderValidationError | undefined;
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const DOUBAO_PROMPT_TEST_TIMEOUT_MS = 45_000;

function envOpenAIConfiguredKey(): string {
  return configuredOpenAIKey(process.env.OPENAI_API_KEY ?? "");
}

export function getImageProviderConfig(): ImageProviderConfig {
  const envOpenAIKey = envOpenAIConfiguredKey();
  const sessionKey = configuredOpenAIKey(sessionOpenAIApiKey);
  const openAIKey = envOpenAIKey || sessionKey;
  const keySource: "env" | "session" | "none" = envOpenAIKey ? "env" : sessionKey ? "session" : "none";
  const configured = Boolean(openAIKey);
  const baseURL = effectiveOpenAIBaseURL();
  const model = effectiveOpenAIImageModel();
  const inputFidelity = effectiveOpenAIInputFidelity();
  const diagnostics: string[] = configured ? [] : ["OPENAI_API_KEY_MISSING"];
  const diagnosticsDetailed = imageProviderDiagnostics(configured, etsyAgentConfig.enableRealGeneration);
  return {
    selectedProvider: "openai",
    realGenerationEnabled: etsyAgentConfig.enableRealGeneration,
    mockMode: false,
    providers: {
      openai: {
        configured,
        ready: configured,
        required: true,
        keySource,
        maskedKey: openAIKey ? maskKey(openAIKey) : undefined,
        fingerprint: openAIKey ? keyFingerprint(openAIKey) : undefined,
        baseURL: baseURL.value,
        baseURLSource: baseURL.source,
        model: model.value,
        modelSource: model.source,
        imageSize: etsyAgentConfig.openaiImageSize,
        imageQuality: etsyAgentConfig.openaiImageQuality,
        inputFidelity: inputFidelity.value,
        inputFidelitySource: inputFidelity.source,
      },
    },
    diagnostics,
    diagnosticsDetailed,
  };
}

export function getEffectiveOpenAISettings(): EffectiveOpenAISettings {
  const config = getImageProviderConfig();
  const secret = getProviderSecret();
  const openai = config.providers.openai;
  return {
    apiKey: secret.apiKey,
    configured: secret.configured,
    source: secret.source === "none" ? "not_configured" : secret.source,
    maskedKey: secret.maskedKey,
    keyFingerprint: secret.keyFingerprint,
    mode: "real",
    provider: "openai",
    selectedProvider: "openai",
    model: openai.model,
    modelSource: openai.modelSource,
    imageSize: openai.imageSize,
    imageQuality: openai.imageQuality,
    inputFidelity: openai.inputFidelity,
    inputFidelitySource: openai.inputFidelitySource,
    baseURL: openai.baseURL ?? "",
    baseURLSource: openai.baseURLSource,
    imageProviderConfig: config,
    providers: providerStatusList(config),
    providersById: { openai },
    diagnostics: config.diagnosticsDetailed,
    maxConcurrentGenerations: etsyAgentConfig.maxConcurrentGenerations,
    maxBatchGeneratedImages: etsyAgentConfig.maxBatchGeneratedImages,
    enableRealGeneration: config.realGenerationEnabled,
    flags: {
      realGenerationEnabled: config.realGenerationEnabled,
      mockMode: false,
    },
    promptProvider: publicPromptProviderStatus(),
    allowWebKeyConfig: etsyAgentConfig.allowWebKeyConfig,
    configPath: etsyAgentConfig.secureConfigPath,
  };
}

export function publicPromptProviderStatus(): PromptProviderStatus {
  const { apiKey: _apiKey, ...status } = getEffectiveGpt55PromptSettings();
  return status;
}

export function getEffectiveGpt55PromptSettings(): EffectiveGpt55PromptSettings {
  const envKey = configuredGpt55Key(etsyAgentConfig.envGpt55ApiKey);
  const sessionKey = configuredGpt55Key(sessionGpt55ApiKey);
  const apiKey = envKey || sessionKey;
  const keySource: "env" | "session" | "none" = envKey ? "env" : sessionKey ? "session" : "none";
  const model = effectiveGpt55Model();
  const baseURL = effectiveGpt55BaseURL();
  const configured = Boolean(apiKey) && Boolean(model.value);
  return {
    apiKey,
    provider: "gpt55",
    configured,
    ready: configured,
    required: true,
    apiKeyConfigured: Boolean(apiKey),
    keySource,
    maskedKey: maskKey(apiKey),
    fingerprint: keyFingerprint(apiKey),
    baseURL: baseURL.value,
    baseURLSource: baseURL.source,
    model: model.value,
    modelConfigured: Boolean(model.value),
    modelSource: model.source,
    modelEffectiveSource: model.source,
    modelOverriddenBySession: model.source === "session" && Boolean(configuredGpt55Model(etsyAgentConfig.gpt55Model)),
    pendingModel: undefined,
    pendingModelSource: undefined,
    pendingBaseURL: undefined,
    pendingBaseURLSource: undefined,
    recommendedModel: DEFAULT_GPT55_MODEL,
    maxInputMb: etsyAgentConfig.gpt55MaxInputMb,
    batchLimit: etsyAgentConfig.gpt55BatchLimit,
    supportsImageInput: gpt55PromptValidationStatus === "validated" ? "validated" : gpt55PromptValidationStatus === "failed" ? "failed" : configured ? "configured" : "unknown",
    validationStatus: gpt55PromptValidationStatus,
    lastValidationError: gpt55PromptLastValidationError,
  };
}

export function getEffectiveDoubaoPromptSettings(): EffectiveDoubaoPromptSettings {
  const envArkKey = configuredArkKey(etsyAgentConfig.envArkApiKey);
  const sessionKey = configuredArkKey(sessionArkApiKey);
  const apiKey = envArkKey || sessionKey;
  const keySource: "env" | "session" | "none" = envArkKey ? "env" : sessionKey ? "session" : "none";
  const model = effectiveDoubaoPromptModel();
  const baseURL = effectiveArkBaseURL();
  const configured = Boolean(apiKey) && Boolean(model.value);
  const ready = configured;
  return {
    apiKey,
    provider: "doubao",
    configured,
    ready,
    required: true,
    apiKeyConfigured: Boolean(apiKey),
    keySource,
    maskedKey: maskKey(apiKey),
    fingerprint: keyFingerprint(apiKey),
    baseURL: baseURL.value,
    baseURLSource: baseURL.source,
    model: model.value,
    modelConfigured: Boolean(model.value),
    modelSource: model.source,
    modelEffectiveSource: model.source,
    modelOverriddenBySession: model.source === "session" && Boolean(configuredDoubaoPromptModel(etsyAgentConfig.doubaoPromptModel)),
    pendingModel: undefined,
    pendingModelSource: undefined,
    pendingBaseURL: undefined,
    pendingBaseURLSource: undefined,
    recommendedModel: DEFAULT_DOUBAO_PROMPT_MODEL,
    maxInputMb: etsyAgentConfig.doubaoPromptMaxInputMb,
    batchLimit: etsyAgentConfig.doubaoPromptBatchLimit,
    supportsImageInput: doubaoPromptValidationStatus === "validated" ? "validated" : doubaoPromptValidationStatus === "failed" ? "failed" : configured ? "configured" : "unknown",
    validationStatus: doubaoPromptValidationStatus,
    lastValidationError: doubaoPromptLastValidationError,
  };
}

function getCandidateDoubaoPromptSettings(): EffectiveDoubaoPromptSettings {
  return getEffectiveDoubaoPromptSettings();
}

export function getDoubaoPromptSecret(): { apiKey: string; configured: boolean; maskedKey: string; keyFingerprint: string } {
  const settings = getEffectiveDoubaoPromptSettings();
  return {
    apiKey: settings.apiKey,
    configured: Boolean(settings.apiKey),
    maskedKey: settings.maskedKey,
    keyFingerprint: settings.fingerprint,
  };
}

export function saveLocalDoubaoPromptSettings(input: { apiKey?: string; baseURL?: string; model?: string }): OpenAISettingsStatus {
  ensureWebKeyConfigAllowed();
  if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    validateArkKey(input.apiKey);
    sessionArkApiKey = input.apiKey.trim();
    resetDoubaoPromptValidation();
    appendSecurityEvent("doubao_prompt_key_saved", { keyFingerprint: keyFingerprint(sessionArkApiKey), maskedKey: maskKey(sessionArkApiKey), source: "session" });
  }
  if (typeof input.baseURL === "string") {
    const normalized = normalizeArkBaseURLStrict(input.baseURL);
    sessionArkBaseURL = normalized || undefined;
    pendingSessionArkBaseURL = undefined;
    hasPendingSessionArkBaseURL = false;
    resetDoubaoPromptValidation();
    appendSecurityEvent("doubao_prompt_base_url_saved", { baseURL: normalized || "default", source: normalized ? "session" : "default" });
  }
  if (typeof input.model === "string") {
    const model = normalizeDoubaoPromptModel(input.model);
    sessionDoubaoPromptModel = isDeprecatedDoubaoPromptModel(model) ? "" : model;
    pendingSessionDoubaoPromptModel = "";
    resetDoubaoPromptValidation();
    appendSecurityEvent("doubao_prompt_model_saved", { model: sessionDoubaoPromptModel || "default", source: sessionDoubaoPromptModel ? "session" : "default" });
  }
  return publicOpenAISettingsStatus();
}

export function deleteLocalArkKey(): OpenAISettingsStatus {
  ensureWebKeyConfigAllowed();
  const fingerprint = keyFingerprint(sessionArkApiKey);
  sessionArkApiKey = "";
  appendSecurityEvent("doubao_prompt_key_deleted", { keyFingerprint: fingerprint || "not_configured", source: "session" });
  return publicOpenAISettingsStatus();
}

export async function testDoubaoPromptProviderConnection(): Promise<{ ok: boolean; status: OpenAISettingsStatus; message: string }> {
  const settings = getCandidateDoubaoPromptSettings();
  if (!settings.apiKey) {
    appendSecurityEvent("doubao_prompt_provider_test_failed", { provider: "doubao", reason: "DOUBAO_PROMPT_API_KEY_MISSING" });
    return { ok: false, status: publicOpenAISettingsStatus(), message: "DOUBAO_PROMPT_API_KEY_MISSING：豆包图片理解需要配置 ARK_API_KEY。" };
  }
  if (!settings.model.trim()) {
    appendSecurityEvent("doubao_prompt_provider_test_failed", { provider: "doubao", reason: "DOUBAO_PROMPT_MODEL_MISSING" });
    return { ok: false, status: publicOpenAISettingsStatus(), message: "DOUBAO_PROMPT_MODEL_MISSING：请配置支持图片理解的 DOUBAO_PROMPT_MODEL。" };
  }
  if (/seedream/i.test(settings.model)) {
    appendSecurityEvent("doubao_prompt_provider_test_failed", { provider: "doubao", reason: "DOUBAO_PROMPT_MODEL_INVALID" });
    return { ok: false, status: publicOpenAISettingsStatus(), message: "DOUBAO_PROMPT_MODEL_INVALID：DOUBAO_PROMPT_MODEL 必须是图片理解/多模态理解模型，不得使用 Seedream 图生图模型。" };
  }
  const textPing = await testArkChatCompletion(settings, {
    model: settings.model,
    messages: [{ role: "user", content: "只回复 OK" }],
    temperature: 0,
    max_tokens: 20,
  });
  if (!textPing.ok) return doubaoPromptValidationFailure(textPing.error, "doubao_prompt_provider_text_test_failed");

  const imagePing = await testArkChatCompletion(settings, {
    model: settings.model,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${TINY_PNG_BASE64}` } },
        { type: "text", text: "请只回复 OK" },
      ],
    }],
    temperature: 0,
    max_tokens: 20,
  });
  if (!imagePing.ok) return doubaoPromptValidationFailure(imagePing.error, "doubao_prompt_provider_vision_test_failed");

  promotePendingDoubaoPromptSettings(settings);
  doubaoPromptValidationStatus = "validated";
  doubaoPromptLastValidationError = undefined;
  appendSecurityEvent("doubao_prompt_provider_test_validated", { provider: "doubao", model: settings.model, baseURL: settings.baseURL });
  return { ok: true, status: publicOpenAISettingsStatus(), message: "豆包 Prompt Provider 已通过真实测试：文本调用成功，图片输入成功，vision validated。" };
}

export function saveLocalGpt55PromptSettings(input: { apiKey?: string; baseURL?: string; model?: string }): OpenAISettingsStatus {
  ensureWebKeyConfigAllowed();
  if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    validateGpt55Key(input.apiKey);
    sessionGpt55ApiKey = input.apiKey.trim();
    resetGpt55PromptValidation();
    appendSecurityEvent("gpt55_prompt_key_saved", { keyFingerprint: keyFingerprint(sessionGpt55ApiKey), maskedKey: maskKey(sessionGpt55ApiKey), source: "session" });
  }
  if (typeof input.baseURL === "string") {
    const normalized = normalizeOpenAIBaseURL(input.baseURL);
    sessionGpt55BaseURL = normalized || undefined;
    resetGpt55PromptValidation();
    appendSecurityEvent("gpt55_prompt_base_url_saved", { baseURL: normalized || "default", source: normalized ? "session" : "default" });
  }
  if (typeof input.model === "string") {
    sessionGpt55Model = normalizeGpt55Model(input.model);
    resetGpt55PromptValidation();
    appendSecurityEvent("gpt55_prompt_model_saved", { model: sessionGpt55Model || "default", source: sessionGpt55Model ? "session" : "default" });
  }
  return publicOpenAISettingsStatus();
}

export function deleteLocalGpt55Key(): OpenAISettingsStatus {
  ensureWebKeyConfigAllowed();
  const fingerprint = keyFingerprint(sessionGpt55ApiKey);
  sessionGpt55ApiKey = "";
  appendSecurityEvent("gpt55_prompt_key_deleted", { keyFingerprint: fingerprint || "not_configured", source: "session" });
  return publicOpenAISettingsStatus();
}

export async function testGpt55PromptProviderConnection(): Promise<{ ok: boolean; status: OpenAISettingsStatus; message: string }> {
  const settings = getEffectiveGpt55PromptSettings();
  if (!settings.apiKey) {
    const error = {
      code: "GPT55_API_KEY_MISSING",
      message: "GPT55_API_KEY_MISSING：GPT5.5 图片理解需要配置 GPT55_API_KEY。",
    };
    gpt55PromptValidationStatus = "failed";
    gpt55PromptLastValidationError = error;
    appendSecurityEvent("gpt55_prompt_provider_test_failed", { provider: "gpt55", reason: error.code });
    return { ok: false, status: publicOpenAISettingsStatus(), message: error.message };
  }
  if (!settings.model.trim()) {
    const error = {
      code: "GPT55_MODEL_MISSING",
      message: "GPT55_MODEL_MISSING：请配置 GPT55_MODEL，例如 gpt-5.5。",
    };
    gpt55PromptValidationStatus = "failed";
    gpt55PromptLastValidationError = error;
    appendSecurityEvent("gpt55_prompt_provider_test_failed", { provider: "gpt55", reason: error.code });
    return { ok: false, status: publicOpenAISettingsStatus(), message: error.message };
  }
  const textPing = await testGpt55ChatCompletion(settings, {
    model: settings.model,
    messages: [{ role: "user", content: "只回复 OK" }],
    temperature: 0,
    max_tokens: 20,
  });
  if (!textPing.ok) return gpt55PromptValidationFailure(textPing.error, "gpt55_prompt_provider_text_test_failed");

  const imagePing = await testGpt55ChatCompletion(settings, {
    model: settings.model,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${TINY_PNG_BASE64}` } },
        { type: "text", text: "请只回复 OK" },
      ],
    }],
    temperature: 0,
    max_tokens: 20,
  });
  if (!imagePing.ok) return gpt55PromptValidationFailure(imagePing.error, "gpt55_prompt_provider_vision_test_failed");

  gpt55PromptValidationStatus = "validated";
  gpt55PromptLastValidationError = undefined;
  appendSecurityEvent("gpt55_prompt_provider_test_validated", { provider: "gpt55", model: settings.model, baseURL: settings.baseURL });
  return { ok: true, status: publicOpenAISettingsStatus(), message: "GPT5.5 Prompt Provider 已通过真实测试：文本调用成功，图片输入成功，vision validated。" };
}

export function saveLocalOpenAIKey(apiKey: string): OpenAISettingsStatus {
  ensureWebKeyConfigAllowed();
  validateOpenAIKey(apiKey);
  sessionOpenAIApiKey = apiKey.trim();
  appendSecurityEvent("openai_key_saved", { keyFingerprint: keyFingerprint(apiKey), maskedKey: maskKey(apiKey), source: "session" });
  return publicOpenAISettingsStatus();
}

export function saveLocalOpenAIBaseURL(baseURL: string): OpenAISettingsStatus {
  ensureWebKeyConfigAllowed();
  const normalized = normalizeOpenAIBaseURL(baseURL);
  sessionOpenAIBaseURL = normalized || undefined;
  appendSecurityEvent("openai_base_url_saved", { baseURL: normalized || "default", source: normalized ? "session" : "default" });
  return publicOpenAISettingsStatus();
}

export function saveLocalOpenAIInputFidelity(inputFidelity: string): OpenAISettingsStatus {
  ensureWebKeyConfigAllowed();
  const normalized = normalizeOpenAIInputFidelity(inputFidelity);
  sessionOpenAIInputFidelity = normalized;
  hasSessionOpenAIInputFidelity = true;
  appendSecurityEvent("openai_input_fidelity_saved", { inputFidelity: normalized, source: "session" });
  return publicOpenAISettingsStatus();
}

export function saveLocalOpenAIImageModel(model: string): OpenAISettingsStatus {
  ensureWebKeyConfigAllowed();
  const normalized = normalizeOpenAIImageModel(model);
  sessionOpenAIImageModel = normalized;
  appendSecurityEvent("openai_image_model_saved", { model: normalized || "default", source: normalized ? "session" : "default" });
  return publicOpenAISettingsStatus();
}

export function deleteLocalOpenAIKey(): OpenAISettingsStatus {
  ensureWebKeyConfigAllowed();
  if (envOpenAIConfiguredKey()) {
    throw new Error("当前 OpenAI API Key 由环境变量管理，无法通过网页删除。");
  }
  const fingerprint = keyFingerprint(sessionOpenAIApiKey);
  sessionOpenAIApiKey = "";
  appendSecurityEvent("openai_key_deleted", { keyFingerprint: fingerprint || "not_configured", source: "session" });
  return publicOpenAISettingsStatus();
}

export async function testOpenAIConnection(): Promise<{ ok: boolean; status: OpenAISettingsStatus; message: string; realGenerationEnabled: boolean; selectedProvider: ImageProviderId }> {
  const config = getImageProviderConfig();
  const status = publicOpenAISettingsStatus();
  if (!config.providers.openai.configured) {
    appendSecurityEvent("image_provider_connection_test_failed", { provider: "openai", reason: "OPENAI_API_KEY_MISSING" });
    return { ok: false, status, selectedProvider: "openai", realGenerationEnabled: config.realGenerationEnabled, message: "OPENAI_API_KEY_MISSING：当前选择 OpenAI Image，但未检测到 OPENAI_API_KEY。请在 .env 设置 OPENAI_API_KEY 后重启本地服务。" };
  }
  if (!config.realGenerationEnabled) {
    appendSecurityEvent("image_provider_connection_test_config_only", { provider: "openai", realGenerationEnabled: false });
    return { ok: true, status, selectedProvider: "openai", realGenerationEnabled: false, message: "OpenAI Provider 配置可读，OPENAI_API_KEY 已配置；但真实生成未启用。需要设置 IMAGE_AGENT_ENABLE_REAL_GENERATION=true 后再用 1 图 smoke test 验证真实图片生成。" };
  }
  appendSecurityEvent("image_provider_connection_test_configured", { provider: "openai", realGenerationEnabled: true });
  return { ok: true, status, selectedProvider: "openai", realGenerationEnabled: true, message: "OpenAI Provider 配置可读。未执行真实图片生成；请用 1 图 smoke test 验证。" };
}

async function testArkChatCompletion(settings: EffectiveDoubaoPromptSettings, body: Record<string, unknown>): Promise<{ ok: true; requestId?: string } | { ok: false; error: DoubaoPromptValidationError }> {
  let requestId: string | undefined;
  try {
    const response = await fetchWithTimeout(`${settings.baseURL.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    }, "豆包配置测试", DOUBAO_PROMPT_TEST_TIMEOUT_MS);
    requestId = response.headers.get("x-request-id") ?? response.headers.get("x-tt-logid") ?? undefined;
    const text = await readResponseTextLimited(response, "豆包配置测试响应", 512 * 1024);
    if (response.ok) return { ok: true, requestId };
    return { ok: false, error: mapDoubaoPromptValidationError(response.status, text, requestId) };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "DOUBAO_PROMPT_CONFIG_VALIDATION_FAILED",
        message: "DOUBAO_PROMPT_CONFIG_VALIDATION_FAILED：豆包配置测试请求失败。",
        requestId,
        reason: sanitizeProviderError(error),
      },
    };
  }
}

async function testGpt55ChatCompletion(settings: EffectiveGpt55PromptSettings, body: Record<string, unknown>): Promise<{ ok: true; requestId?: string } | { ok: false; error: PromptProviderValidationError }> {
  let requestId: string | undefined;
  try {
    const response = await fetchWithTimeout(`${settings.baseURL.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    }, "GPT5.5 配置测试", DOUBAO_PROMPT_TEST_TIMEOUT_MS);
    requestId = response.headers.get("x-request-id") ?? response.headers.get("x-tt-logid") ?? undefined;
    const text = await readResponseTextLimited(response, "GPT5.5 配置测试响应", 512 * 1024);
    if (response.ok) return { ok: true, requestId };
    return { ok: false, error: mapGpt55PromptValidationError(response.status, text, requestId) };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "GPT55_CONFIG_VALIDATION_FAILED",
        message: "GPT55_CONFIG_VALIDATION_FAILED：GPT5.5 配置测试请求失败。",
        requestId,
        reason: sanitizeProviderError(error),
      },
    };
  }
}

function doubaoPromptValidationFailure(error: DoubaoPromptValidationError, event: string): { ok: boolean; status: OpenAISettingsStatus; message: string } {
  if (doubaoPromptValidationStatus !== "validated") doubaoPromptValidationStatus = "failed";
  doubaoPromptLastValidationError = error;
  appendSecurityEvent(event, { provider: "doubao", code: error.code, statusCode: error.statusCode, requestId: error.requestId, reason: error.reason });
  return { ok: false, status: publicOpenAISettingsStatus(), message: error.message };
}

function gpt55PromptValidationFailure(error: PromptProviderValidationError, event: string): { ok: boolean; status: OpenAISettingsStatus; message: string } {
  if (gpt55PromptValidationStatus !== "validated") gpt55PromptValidationStatus = "failed";
  gpt55PromptLastValidationError = error;
  appendSecurityEvent(event, { provider: "gpt55", code: error.code, statusCode: error.statusCode, requestId: error.requestId, reason: error.reason });
  return { ok: false, status: publicOpenAISettingsStatus(), message: error.message };
}

function resetDoubaoPromptValidation(): void {
  doubaoPromptValidationStatus = "unknown";
  doubaoPromptLastValidationError = undefined;
}

function resetGpt55PromptValidation(): void {
  gpt55PromptValidationStatus = "unknown";
  gpt55PromptLastValidationError = undefined;
}

function promotePendingDoubaoPromptSettings(settings: EffectiveDoubaoPromptSettings): void {
  sessionArkBaseURL = settings.baseURL;
  if (!isDeprecatedDoubaoPromptModel(settings.model)) sessionDoubaoPromptModel = settings.model;
  pendingSessionDoubaoPromptModel = "";
  pendingSessionArkBaseURL = undefined;
  hasPendingSessionArkBaseURL = false;
}

function mapDoubaoPromptValidationError(statusCode: number, responseText: string, requestId?: string): DoubaoPromptValidationError {
  const clean = sanitizeProviderError(responseText);
  const lower = clean.toLowerCase();
  const ark = extractArkError(responseText);
  const effectiveRequestId = requestId ?? ark.requestId;
  if (statusCode === 401 || /unauthori[sz]ed|invalid api key|authentication|auth failed|鉴权|认证|api key.*无效|token.*无效/.test(lower)) {
    return { code: "DOUBAO_PROMPT_AUTH_FAILED", message: "DOUBAO_PROMPT_AUTH_FAILED：豆包 ARK_API_KEY 鉴权失败，请检查 Key 是否来自当前火山方舟账号。", statusCode, requestId: effectiveRequestId, reason: ark.code ?? clean };
  }
  if (statusCode === 403 || /permission denied|access denied|forbidden|not authorized|无权限|权限不足|未开通|未授权/.test(lower)) {
    return { code: "DOUBAO_PROMPT_PERMISSION_DENIED", message: "DOUBAO_PROMPT_PERMISSION_DENIED：当前豆包 Key 或账号无权调用该模型/接入点。", statusCode, requestId: effectiveRequestId, reason: ark.code ?? clean };
  }
  if (/modelidaccessdisabled/i.test(clean)) {
    return { code: "DOUBAO_PROMPT_ENDPOINT_ID_REQUIRED", message: "DOUBAO_PROMPT_ENDPOINT_ID_REQUIRED：当前账号不允许直接用模型 ID，请在火山方舟创建视觉推理接入点并填写 ep-...。", statusCode, requestId: effectiveRequestId, reason: ark.code ?? clean };
  }
  if (/modelnotopen/i.test(clean)) {
    return { code: "DOUBAO_PROMPT_MODEL_NOT_OPEN", message: "DOUBAO_PROMPT_MODEL_NOT_OPEN：当前账号未开通该豆包模型，请在火山方舟开通或换成已开通的 ep-...。", statusCode, requestId: effectiveRequestId, reason: ark.code ?? clean };
  }
  if (/invalidendpointormodel\.notfound/i.test(clean) || /model.*(not found|not exist|does not exist|不存在|未找到)|endpoint.*not found|模型.*(不存在|未找到)/.test(lower)) {
    return { code: "DOUBAO_PROMPT_MODEL_OR_ENDPOINT_NOT_ACCESSIBLE", message: "DOUBAO_PROMPT_MODEL_OR_ENDPOINT_NOT_ACCESSIBLE：当前模型/接入点不存在，或这个 ARK_API_KEY 没有访问权限。请填写已通过图片测试的 ep-...。", statusCode, requestId: effectiveRequestId, reason: ark.code ?? clean };
  }
  if (/llm model received multi-modal messages|multi-modal messages|multimodal messages/i.test(clean)) {
    return { code: "DOUBAO_PROMPT_VISION_NOT_SUPPORTED", message: "DOUBAO_PROMPT_VISION_NOT_SUPPORTED：当前 ep 接入点绑定的是文本模型，不支持图片输入。请创建 Doubao vision 模型接入点。", statusCode, requestId: effectiveRequestId, reason: ark.code ?? clean };
  }
  if (/image_url|base64|data:image|input method|content type|unsupported parameter|unknown parameter|invalid parameter|输入方式|参数|字段/.test(lower) && /not support|unsupported|不支持|invalid|unknown|非法|无效/.test(lower)) {
    return { code: "DOUBAO_PROMPT_INPUT_METHOD_UNSUPPORTED", message: "DOUBAO_PROMPT_INPUT_METHOD_UNSUPPORTED：当前豆包接口不支持本地 base64 图片输入方式。", statusCode, requestId: effectiveRequestId, reason: ark.code ?? clean };
  }
  return { code: "DOUBAO_PROMPT_CONFIG_VALIDATION_FAILED", message: "DOUBAO_PROMPT_CONFIG_VALIDATION_FAILED：豆包配置测试失败，请检查模型/接入点、Key 权限和 Base URL。", statusCode, requestId: effectiveRequestId, reason: ark.code ?? clean };
}

function mapGpt55PromptValidationError(statusCode: number, responseText: string, requestId?: string): PromptProviderValidationError {
  const clean = sanitizeProviderError(responseText);
  const lower = clean.toLowerCase();
  if (statusCode === 401 || /unauthori[sz]ed|invalid api key|authentication|auth failed|鉴权|认证|api key.*无效|token.*无效/.test(lower)) {
    return { code: "GPT55_AUTH_FAILED", message: "GPT55_AUTH_FAILED：GPT5.5 API Key 鉴权失败。", statusCode, requestId, reason: clean };
  }
  if (statusCode === 403 || /permission denied|access denied|forbidden|not authorized|无权限|权限不足|未开通|未授权/.test(lower)) {
    return { code: "GPT55_PERMISSION_DENIED", message: "GPT55_PERMISSION_DENIED：当前 GPT5.5 Key 或账号无权调用该模型。", statusCode, requestId, reason: clean };
  }
  if (statusCode === 404 || /model.*(not found|not exist|does not exist|不存在|未找到)|endpoint.*not found|模型.*(不存在|未找到)/.test(lower)) {
    return { code: "GPT55_MODEL_NOT_ACCESSIBLE", message: "GPT55_MODEL_NOT_ACCESSIBLE：当前 GPT5.5 模型不存在或无访问权限。", statusCode, requestId, reason: clean };
  }
  if (/llm model received multi-modal messages|multi-modal messages|multimodal messages/i.test(clean)) {
    return { code: "GPT55_VISION_NOT_SUPPORTED", message: "GPT55_VISION_NOT_SUPPORTED：当前 GPT5.5 模型不支持图片输入。", statusCode, requestId, reason: clean };
  }
  if (/vision|image|图片|图像|多模态|视觉/i.test(clean) && /not support|unsupported|不支持|not enabled|not available|invalid|unknown/i.test(clean)) {
    return { code: "GPT55_VISION_NOT_SUPPORTED", message: "GPT55_VISION_NOT_SUPPORTED：当前 GPT5.5 模型不支持图片输入。", statusCode, requestId, reason: clean };
  }
  if (/image_url|base64|data:image|input method|content type|unsupported parameter|unknown parameter|invalid parameter|输入方式|参数|字段/.test(lower) && /not support|unsupported|不支持|invalid|unknown|非法|无效/.test(lower)) {
    return { code: "GPT55_INPUT_METHOD_UNSUPPORTED", message: "GPT55_INPUT_METHOD_UNSUPPORTED：当前 GPT5.5 接口不支持本地 base64 图片输入方式。", statusCode, requestId, reason: clean };
  }
  return { code: "GPT55_CONFIG_VALIDATION_FAILED", message: "GPT55_CONFIG_VALIDATION_FAILED：GPT5.5 配置测试失败，请检查模型、Key 权限和 Base URL。", statusCode, requestId, reason: clean };
}

function extractArkError(responseText: string): { code?: string; message?: string; requestId?: string } {
  try {
    const parsed = JSON.parse(responseText) as { error?: { code?: unknown; message?: unknown } };
    const code = typeof parsed.error?.code === "string" ? parsed.error.code : undefined;
    const message = typeof parsed.error?.message === "string" ? parsed.error.message : undefined;
    const requestId = message?.match(/request id:\s*([a-z0-9]+)/i)?.[1];
    return { code, message, requestId };
  } catch {
    const requestId = responseText.match(/request id:\s*([a-z0-9]+)/i)?.[1];
    return { requestId };
  }
}

export function publicOpenAISettingsStatus(): OpenAISettingsStatus {
  const { apiKey: _apiKey, ...status } = getEffectiveOpenAISettings();
  return status;
}

export function getProviderSecret(_provider: ImageProviderId = "openai"): ProviderSecret {
  const envOpenAIKey = envOpenAIConfiguredKey();
  const sessionKey = configuredOpenAIKey(sessionOpenAIApiKey);
  const apiKey = envOpenAIKey || sessionKey;
  const source: "env" | "session" | "none" = envOpenAIKey ? "env" : sessionKey ? "session" : "none";
  return {
    apiKey,
    configured: Boolean(apiKey),
    source,
    maskedKey: maskKey(apiKey),
    keyFingerprint: keyFingerprint(apiKey),
  };
}

export function appendSecurityEvent(event: string, details: Record<string, unknown> = {}): void {
  ensureDir(path.dirname(etsyAgentConfig.securityLogPath));
  const safeDetails = JSON.parse(JSON.stringify(details, (_key, value) => {
    if (typeof value === "string") return value
      .replace(/sk-[A-Za-z0-9_\-]+/g, (match) => maskKey(match))
      .replace(/(AKLT|volc|ark)[A-Za-z0-9_\-]{12,}/gi, (match) => maskKey(match));
    return value;
  })) as Record<string, unknown>;
  const line = JSON.stringify({ at: nowIso(), event, details: safeDetails }) + "\n";
  fs.appendFileSync(etsyAgentConfig.securityLogPath, line, { encoding: "utf-8", mode: 0o600 });
  try { fs.chmodSync(etsyAgentConfig.securityLogPath, 0o600); } catch { /* best effort */ }
}

export function sanitizeOpenAIError(error: unknown): string {
  const status = (error as { status?: number; code?: string })?.status;
  const code = (error as { code?: string })?.code;
  const raw = error instanceof Error ? error.message : String(error);
  const clean = raw
    .replace(/sk-[A-Za-z0-9_\-]+/g, "sk-...redacted")
    .replace(/(AKLT|volc|ark)[A-Za-z0-9_\-]{12,}/gi, "$1...redacted")
    .slice(0, 260);
  if (code === "insufficient_quota") return "OpenAI 额度不足或账单不可用。";
  if (status === 401) return "OpenAI API Key 无效或未授权。";
  if (status === 403) return "权限不足，当前 OpenAI API Key 可能无法访问该模型，或组织需要完成验证。";
  if (status === 404) return "OpenAI 图片模型不可用或当前账号无法访问该模型。";
  if (status === 408) return "OpenAI 请求超时，请稍后重试。";
  if (status === 413) return "图片输入过大，请压缩或减少参考图。";
  if (status === 429) return "触发 OpenAI 速率限制或额度不足，请降低并发或检查账户额度。";
  if (status && status >= 500) return "OpenAI 服务或网络暂时不可用，请稍后重试。";
  if (/input_fidelity|unsupported parameter|unknown parameter|invalid parameter|does not support.+parameter/i.test(clean)) return "当前模型或中转站不支持请求中的图片参数。";
  if (/organization.*verif|verif.*organization/i.test(clean)) return "OpenAI 组织或账号需要完成验证。";
  if (/quota|billing|insufficient/i.test(clean)) return "OpenAI 额度不足或账单不可用。";
  if (/rate limit/i.test(clean)) return "触发 OpenAI 速率限制。";
  if (/safety|policy|content/i.test(clean)) return "请求被内容安全策略拒绝，请调整 prompt 或参考图。";
  return clean || "OpenAI 请求失败。";
}

export function sanitizeProviderError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/sk-[A-Za-z0-9_\-]+/g, "sk-...redacted")
    .replace(/(AKLT|volc|ark)[A-Za-z0-9_\-]{12,}/gi, "$1...redacted")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gi, "data:image/...;base64,...redacted")
    .slice(0, 260);
}

function validateOpenAIKey(apiKey: string): void {
  const trimmed = apiKey.trim();
  if (isPlaceholderOpenAIKey(trimmed)) throw new Error("OpenAI API Key 仍是占位符，请填入真实私有 key。");
  if (!trimmed.startsWith("sk-")) throw new Error("OpenAI API Key 格式不正确，应以 sk- 开头。");
  if (trimmed.length < 24) throw new Error("OpenAI API Key 长度异常。");
  if (/\s/.test(trimmed)) throw new Error("OpenAI API Key 不能包含空白字符。");
}

function configuredOpenAIKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  return trimmed && !isPlaceholderOpenAIKey(trimmed) ? trimmed : "";
}

function configuredArkKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  return trimmed && !isPlaceholderArkKey(trimmed) ? trimmed : "";
}

function configuredGpt55Key(apiKey: string): string {
  const trimmed = apiKey.trim();
  return trimmed && !isPlaceholderGpt55Key(trimmed) ? trimmed : "";
}

function validateArkKey(apiKey: string): void {
  const trimmed = apiKey.trim();
  if (isPlaceholderArkKey(trimmed)) throw new Error("ARK_API_KEY 仍是占位符，请填入真实私有 key。");
  if (trimmed.length < 6) throw new Error("ARK_API_KEY 长度异常。");
  if (/\s/.test(trimmed)) throw new Error("ARK_API_KEY 不能包含空白字符。");
}

function validateGpt55Key(apiKey: string): void {
  const trimmed = apiKey.trim();
  if (isPlaceholderGpt55Key(trimmed)) throw new Error("GPT55_API_KEY 仍是占位符，请填入真实私有 key。");
  if (trimmed.length < 12) throw new Error("GPT55_API_KEY 长度异常。");
  if (/\s/.test(trimmed)) throw new Error("GPT55_API_KEY 不能包含空白字符。");
}

function isPlaceholderArkKey(apiKey: string): boolean {
  const normalized = apiKey.trim().toLowerCase().replace(/[<>\s]/g, "").replace(/-/g, "_");
  return [
    "your_ark_key_here",
    "your_ark_api_key_here",
    "your_doubao_key_here",
    "ark_api_key",
    "replace_with_your_ark_key",
  ].includes(normalized);
}

function isPlaceholderGpt55Key(apiKey: string): boolean {
  const normalized = apiKey.trim().toLowerCase().replace(/[<>\s]/g, "").replace(/-/g, "_");
  return [
    "your_gpt55_key_here",
    "your_gpt55_api_key_here",
    "gpt55_api_key",
    "replace_with_your_gpt55_key",
  ].includes(normalized);
}

function isPlaceholderOpenAIKey(apiKey: string): boolean {
  const normalized = apiKey.trim().toLowerCase().replace(/[<>\s]/g, "").replace(/-/g, "_");
  return [
    "your_openai_key_here",
    "your_openai_api_key_here",
    "your_openai_api_key",
    "replace_with_your_openai_key",
    "replace_with_your_openai_api_key",
    "openai_api_key",
  ].includes(normalized);
}

function effectiveOpenAIBaseURL(): { value: string; source: OpenAIBaseURLSource } {
  const session = sessionOpenAIBaseURL;
  if (session) return { value: session, source: "session" };
  const env = normalizeOpenAIBaseURL(etsyAgentConfig.openaiBaseURL);
  if (env) return { value: env, source: "env" };
  return { value: "https://allin-api.com/v1", source: "default" };
}

function effectiveOpenAIImageModel(): { value: string; source: OpenAIImageModelSource } {
  const sessionModel = configuredOpenAIImageModel(sessionOpenAIImageModel);
  if (sessionModel) return { value: sessionModel, source: "session" };
  const envModel = configuredOpenAIImageModel(process.env.OPENAI_IMAGE_MODEL ?? "");
  if (envModel) return { value: envModel, source: "env" };
  return { value: "gpt-image-2", source: "default" };
}

function effectiveOpenAIInputFidelity(): { value: OpenAIInputFidelity; source: OpenAIInputFidelitySource } {
  const session = sessionOpenAIInputFidelity;
  if (hasSessionOpenAIInputFidelity && session) return { value: session, source: "session" };
  const envRaw = process.env.OPENAI_IMAGE_INPUT_FIDELITY;
  if (envRaw?.trim()) return { value: normalizeOpenAIInputFidelity(envRaw), source: "env" };
  return { value: etsyAgentConfig.openaiImageInputFidelity, source: "default" };
}

function effectiveGpt55BaseURL(): { value: string; source: "env" | "session" | "default" } {
  if (sessionGpt55BaseURL) return { value: sessionGpt55BaseURL, source: "session" };
  const env = normalizeOpenAIBaseURL(etsyAgentConfig.gpt55BaseURL);
  if (env) return { value: env, source: "env" };
  return { value: "https://allin-api.com/v1", source: "default" };
}

function effectiveGpt55Model(): { value: string; source: "env" | "session" | "default" | "none" } {
  const sessionModel = configuredGpt55Model(sessionGpt55Model);
  if (sessionModel) return { value: sessionModel, source: "session" };
  const envModel = configuredGpt55Model(etsyAgentConfig.gpt55Model);
  if (envModel) return { value: envModel, source: "env" };
  return { value: DEFAULT_GPT55_MODEL, source: "default" };
}

function normalizeGpt55Model(raw: string): string {
  const model = raw.trim();
  if (!model) return "";
  if (isPlaceholderGpt55Model(model)) throw new Error(`GPT55_MODEL 仍是占位符，请填写 ${DEFAULT_GPT55_MODEL}。`);
  if (/\s/.test(model)) throw new Error("GPT55_MODEL 不能包含空白字符。");
  return model;
}

function configuredGpt55Model(raw: string): string {
  const model = raw.trim();
  return model && !isPlaceholderGpt55Model(model) ? model : "";
}

function isPlaceholderGpt55Model(model: string): boolean {
  const normalized = model.trim().toLowerCase().replace(/[<>\s]/g, "").replace(/-/g, "_");
  return [
    "your_gpt55_model_here",
    "gpt55_model",
    "replace_with_your_gpt55_model",
  ].includes(normalized);
}

function normalizeOpenAIInputFidelity(raw: string): OpenAIInputFidelity {
  const value = raw.trim().toLowerCase();
  if (value === "off" || value === "low" || value === "high") return value;
  throw new Error("OpenAI Input fidelity 只支持 off、low 或 high。");
}

function normalizeOpenAIImageModel(raw: string): string {
  const model = raw.trim();
  if (!model) return "";
  if (isPlaceholderOpenAIImageModel(model)) throw new Error("OPENAI_IMAGE_MODEL 仍是占位符，请填写你的图片模型名称。");
  if (/\s/.test(model)) throw new Error("OPENAI_IMAGE_MODEL 不能包含空白字符。");
  return model;
}

function configuredOpenAIImageModel(raw: string): string {
  const model = raw.trim();
  return model && !isPlaceholderOpenAIImageModel(model) ? model : "";
}

function isPlaceholderOpenAIImageModel(model: string): boolean {
  const normalized = model.trim().toLowerCase().replace(/[<>\s]/g, "").replace(/-/g, "_");
  return [
    "your_openai_image_model_here",
    "openai_image_model",
    "replace_with_your_openai_image_model",
  ].includes(normalized);
}

function normalizeOpenAIBaseURL(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OpenAI Base URL 格式不正确，请填写 http(s) URL，例如 https://api.openai.com/v1。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("OpenAI Base URL 只支持 http 或 https。");
  }
  if (url.username || url.password) {
    throw new Error("OpenAI Base URL 不允许包含用户名或密码。");
  }
  if (url.search || url.hash) {
    throw new Error("OpenAI Base URL 不允许包含 query 或 hash。");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.pathname === "/" ? url.origin : `${url.origin}${url.pathname}`;
}

function normalizeArkBaseURL(raw: string): string {
  const value = raw.trim() || "https://ark.cn-beijing.volces.com/api/v3";
  try {
    return normalizeArkURLObject(new URL(value));
  } catch {
    return "https://ark.cn-beijing.volces.com/api/v3";
  }
}

function normalizeArkBaseURLStrict(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ARK_BASE_URL 格式不正确，请填写 http(s) URL，例如 https://ark.cn-beijing.volces.com/api/v3。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("ARK_BASE_URL 只支持 http 或 https。");
  if (url.username || url.password) throw new Error("ARK_BASE_URL 不允许包含用户名或密码。");
  if (url.search || url.hash) throw new Error("ARK_BASE_URL 不允许包含 query 或 hash。");
  return normalizeArkURLObject(url);
}

function normalizeArkURLObject(url: URL): string {
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = url.pathname.replace(/\/chat\/completions$/i, "");
  return url.pathname === "/" ? url.origin : `${url.origin}${url.pathname}`;
}

function effectiveArkBaseURL(): { value: string; source: "env" | "session" | "default" } {
  if (sessionArkBaseURL) return { value: sessionArkBaseURL, source: "session" };
  const envRaw = process.env.ARK_BASE_URL?.trim();
  if (envRaw) return { value: normalizeArkBaseURL(envRaw), source: "env" };
  return { value: normalizeArkBaseURL(etsyAgentConfig.arkBaseURL), source: "default" };
}

function effectiveDoubaoPromptModel(): { value: string; source: "env" | "session" | "default" | "none" } {
  const sessionModel = configuredDoubaoPromptModel(sessionDoubaoPromptModel);
  if (sessionModel) return { value: sessionModel, source: "session" };
  const envModel = configuredDoubaoPromptModel(etsyAgentConfig.doubaoPromptModel);
  if (envModel) return { value: envModel, source: "env" };
  return { value: DEFAULT_DOUBAO_PROMPT_MODEL, source: "default" };
}

function normalizeDoubaoPromptModel(raw: string): string {
  const model = raw.trim();
  if (!model) return "";
  if (isPlaceholderDoubaoPromptModel(model)) throw new Error(`DOUBAO_PROMPT_MODEL 仍是占位符，请填写火山方舟视觉理解 Endpoint ID，例如 ${DEFAULT_DOUBAO_PROMPT_MODEL}。`);
  if (/\s/.test(model)) throw new Error("DOUBAO_PROMPT_MODEL 不能包含空白字符。");
  return model;
}

function configuredDoubaoPromptModel(raw: string): string {
  const model = raw.trim();
  return model && !isPlaceholderDoubaoPromptModel(model) && !isDeprecatedDoubaoPromptModel(model) ? model : "";
}

function isDeprecatedDoubaoPromptModel(model: string): boolean {
  return model.trim().toLowerCase() === LEGACY_DOUBAO_PROMPT_MODEL.toLowerCase();
}

function isPlaceholderDoubaoPromptModel(model: string): boolean {
  const normalized = model.trim().toLowerCase().replace(/[<>\s]/g, "").replace(/-/g, "_");
  return [
    "your_doubao_vision_model_here",
    "your_doubao_vision_endpoint_model_here",
    "your_doubao_prompt_model_here",
    "doubao_prompt_model",
    "replace_with_your_doubao_prompt_model",
  ].includes(normalized);
}

function ensureWebKeyConfigAllowed(): void {
  if (!etsyAgentConfig.allowWebKeyConfig) {
    throw new Error("网页配置 OpenAI API Key 未启用。请在私有部署中设置 IMAGE_AGENT_ALLOW_WEB_KEY_CONFIG=true。");
  }
}

function maskKey(apiKey: string): string {
  if (!apiKey) return "";
  const start = apiKey.slice(0, 6);
  const end = apiKey.slice(-4);
  return `${start}...${end}`;
}

function keyFingerprint(apiKey: string): string {
  if (!apiKey) return "";
  return crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

function imageProviderDiagnostics(openAIKeyConfigured: boolean, realGenerationEnabled: boolean): ImageProviderDiagnostic[] {
  const diagnostics: ImageProviderDiagnostic[] = [];
  if (!openAIKeyConfigured) {
    diagnostics.push({ code: "OPENAI_API_KEY_MISSING", severity: "error", message: "当前选择 OpenAI Image，但未检测到 OPENAI_API_KEY。" });
  }
  diagnostics.push(realGenerationEnabled
    ? { code: "IMAGE_AGENT_ENABLE_REAL_GENERATION_ENABLED", severity: "info", message: "真实图片生成开关已启用。" }
    : { code: "IMAGE_AGENT_ENABLE_REAL_GENERATION_DISABLED", severity: "warn", message: "真实图片生成未启用。批量图生图不会执行真实生成。" });
  return diagnostics;
}

function providerStatusList(config: ImageProviderConfig): OpenAISettingsStatus["providers"] {
  const openai = config.providers.openai;
  return [
    {
      id: "openai",
      label: "OpenAI 图像生成",
      configured: openai.configured,
      ready: openai.ready,
      required: true,
      source: openai.keySource === "none" ? "not_configured" : openai.keySource,
      keySource: openai.keySource,
      maskedKey: openai.maskedKey ?? "",
      fingerprint: openai.fingerprint ?? "",
      baseURL: openai.baseURL,
      baseURLSource: openai.baseURLSource,
      inputFidelity: openai.inputFidelity,
      inputFidelitySource: openai.inputFidelitySource,
      model: openai.model,
      modelSource: openai.modelSource,
      imageSize: openai.imageSize,
      imageQuality: openai.imageQuality,
    },
  ];
}
