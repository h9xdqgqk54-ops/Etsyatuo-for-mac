import * as path from "node:path";
import dotenv from "dotenv";

dotenv.config();

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function boolEnvCompat(name: string, legacyName: string, fallback = false): boolean {
  const raw = process.env[name] ?? process.env[legacyName];
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function enumEnv<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw && (allowed as readonly string[]).includes(raw) ? raw as T : fallback;
}

function storageRootDefault(): string {
  return process.env.VERCEL ? "/tmp/etsy-agent" : "storage/etsy-agent";
}

function dataRootDefault(): string {
  return process.env.VERCEL ? "/tmp/etsy-agent-data" : "data/etsy-agent";
}

export const etsyAgentConfig = {
  envOpenaiApiKey: process.env.OPENAI_API_KEY ?? "",
  hasEnvOpenaiApiKey: Boolean(process.env.OPENAI_API_KEY),
  imageProvider: "openai",
  openaiBaseURL: process.env.OPENAI_BASE_URL ?? "",
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2",
  openaiImageSize: process.env.OPENAI_IMAGE_SIZE ?? "1024x1024",
  openaiImageQuality: process.env.OPENAI_IMAGE_QUALITY ?? "low",
  openaiImageInputFidelity: enumEnv("OPENAI_IMAGE_INPUT_FIDELITY", ["off", "low", "high"] as const, "off"),
  openaiImageMaxInputMb: numberEnv("OPENAI_IMAGE_MAX_INPUT_MB", 20),
  enableRealGeneration: boolEnvCompat("IMAGE_AGENT_ENABLE_REAL_GENERATION", "ETSY_AGENT_ENABLE_REAL_GENERATION", false),
  allowWebKeyConfig: process.env.VERCEL ? boolEnvCompat("IMAGE_AGENT_ALLOW_WEB_KEY_CONFIG", "ETSY_AGENT_ALLOW_WEB_KEY_CONFIG", false) : true,
  secureConfigPath: path.resolve(process.env.ETSY_AGENT_CONFIG_PATH ?? path.join(dataRootDefault(), "secure-config.json")),
  securityLogPath: path.resolve(process.env.ETSY_AGENT_SECURITY_LOG_PATH ?? path.join(dataRootDefault(), "security-events.log")),
  storageProvider: (process.env.ASSET_STORAGE_PROVIDER ?? "local").trim() || "local",
  isVercel: Boolean(process.env.VERCEL),
  storageRoot: path.resolve(process.env.ETSY_AGENT_STORAGE_PATH ?? storageRootDefault()),
  publicMediaPrefix: "/media/etsy-agent",
  maxUploadImages: numberEnv("ETSY_AGENT_MAX_UPLOAD_IMAGES", 80),
  maxProductGroups: numberEnv("ETSY_AGENT_MAX_PRODUCT_GROUPS", 30),
  maxReferenceImagesPerProduct: numberEnv("ETSY_AGENT_MAX_REFERENCE_IMAGES_PER_PRODUCT", 8),
  maxImagesPerProduct: numberEnv("ETSY_AGENT_MAX_GENERATIONS_PER_PRODUCT", numberEnv("ETSY_AGENT_MAX_IMAGES_PER_PRODUCT", 10)),
  maxBatchGeneratedImages: numberEnv("ETSY_AGENT_MAX_TOTAL_GENERATIONS", numberEnv("ETSY_AGENT_MAX_BATCH_GENERATED_IMAGES", 60)),
  maxConcurrentGenerations: numberEnv("ETSY_AGENT_MAX_CONCURRENCY", numberEnv("ETSY_AGENT_MAX_CONCURRENT_GENERATIONS", 2)),
  enableEtsyApiPlaceholders: boolEnv("ETSY_AGENT_ENABLE_ETSY_API_PLACEHOLDERS", true),
  maxUploadBytes: numberEnv("ETSY_AGENT_MAX_UPLOAD_BYTES", 15 * 1024 * 1024),
  maxJsonBodyBytes: numberEnv("ETSY_AGENT_MAX_JSON_BODY_BYTES", 2 * 1024 * 1024),
  maxMultipartBodyBytes: numberEnv("ETSY_AGENT_MAX_MULTIPART_BODY_BYTES", 260 * 1024 * 1024),
  targetExportSize: numberEnv("ETSY_AGENT_TARGET_EXPORT_SIZE", 2000),
};

export function publicUrlForStoragePath(filePath: string): string {
  const rel = path.relative(etsyAgentConfig.storageRoot, filePath).split(path.sep).join("/");
  return `${etsyAgentConfig.publicMediaPrefix}/${rel}`;
}

export function storagePathFromPublicUrl(url: string): string {
  const rel = decodeURIComponent(url.replace(etsyAgentConfig.publicMediaPrefix, "").replace(/^\/+/, ""));
  return path.resolve(etsyAgentConfig.storageRoot, rel);
}
