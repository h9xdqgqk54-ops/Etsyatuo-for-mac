import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { etsyAgentConfig } from "./config.js";
import type { ImageProviderId } from "./types.js";
import { ensureDir, nowIso } from "./utils.js";

export type ApiKeySource = "env" | "session" | "none" | "not_configured";
export type OpenAIBaseURLSource = "env" | "session" | "default";
export type OpenAIInputFidelity = "off" | "low" | "high";
export type OpenAIInputFidelitySource = "env" | "session" | "default";

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
  allowWebKeyConfig: boolean;
  configPath: string;
}

export interface EffectiveOpenAISettings extends OpenAISettingsStatus {
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
let sessionOpenAIInputFidelity: OpenAIInputFidelity | undefined;
let hasSessionOpenAIInputFidelity = false;

export function getImageProviderConfig(): ImageProviderConfig {
  const envOpenAIKey = configuredOpenAIKey(etsyAgentConfig.envOpenaiApiKey);
  const sessionKey = configuredOpenAIKey(sessionOpenAIApiKey);
  const openAIKey = envOpenAIKey || sessionKey;
  const keySource: "env" | "session" | "none" = envOpenAIKey ? "env" : sessionKey ? "session" : "none";
  const configured = Boolean(openAIKey);
  const baseURL = effectiveOpenAIBaseURL();
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
        model: etsyAgentConfig.openaiImageModel,
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
    allowWebKeyConfig: etsyAgentConfig.allowWebKeyConfig,
    configPath: etsyAgentConfig.secureConfigPath,
  };
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

export function deleteLocalOpenAIKey(): OpenAISettingsStatus {
  ensureWebKeyConfigAllowed();
  if (configuredOpenAIKey(etsyAgentConfig.envOpenaiApiKey)) {
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
    return { ok: false, status, selectedProvider: "openai", realGenerationEnabled: config.realGenerationEnabled, message: "OPENAI_API_KEY_MISSING：当前选择 OpenAI Image，但未检测到 OPENAI_API_KEY。请在 .env 设置 OPENAI_API_KEY 后重启 pnpm dev。" };
  }
  if (!config.realGenerationEnabled) {
    appendSecurityEvent("image_provider_connection_test_config_only", { provider: "openai", realGenerationEnabled: false });
    return { ok: true, status, selectedProvider: "openai", realGenerationEnabled: false, message: "OpenAI Provider 配置可读，OPENAI_API_KEY 已配置；但真实生成未启用。需要设置 IMAGE_AGENT_ENABLE_REAL_GENERATION=true 后再用 1 图 smoke test 验证真实图片生成。" };
  }
  appendSecurityEvent("image_provider_connection_test_configured", { provider: "openai", realGenerationEnabled: true });
  return { ok: true, status, selectedProvider: "openai", realGenerationEnabled: true, message: "OpenAI Provider 配置可读。未执行真实图片生成；请用 1 图 smoke test 验证。" };
}

export function publicOpenAISettingsStatus(): OpenAISettingsStatus {
  const { apiKey: _apiKey, ...status } = getEffectiveOpenAISettings();
  return status;
}

export function getProviderSecret(_provider: ImageProviderId = "openai"): ProviderSecret {
  const envOpenAIKey = configuredOpenAIKey(etsyAgentConfig.envOpenaiApiKey);
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
  return { value: "", source: "default" };
}

function effectiveOpenAIInputFidelity(): { value: OpenAIInputFidelity; source: OpenAIInputFidelitySource } {
  const session = sessionOpenAIInputFidelity;
  if (hasSessionOpenAIInputFidelity && session) return { value: session, source: "session" };
  const envRaw = process.env.OPENAI_IMAGE_INPUT_FIDELITY;
  if (envRaw?.trim()) return { value: normalizeOpenAIInputFidelity(envRaw), source: "env" };
  return { value: etsyAgentConfig.openaiImageInputFidelity, source: "default" };
}

function normalizeOpenAIInputFidelity(raw: string): OpenAIInputFidelity {
  const value = raw.trim().toLowerCase();
  if (value === "off" || value === "low" || value === "high") return value;
  throw new Error("OpenAI Input fidelity 只支持 off、low 或 high。");
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
      imageSize: openai.imageSize,
      imageQuality: openai.imageQuality,
    },
  ];
}
