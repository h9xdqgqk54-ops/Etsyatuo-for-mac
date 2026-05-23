import * as path from "node:path";
import * as os from "node:os";
import dotenv from "dotenv";

dotenv.config();

export const DEFAULT_DOUBAO_PROMPT_MODEL = "ep-20260521185934-jdcsv";
export const LEGACY_DOUBAO_PROMPT_MODEL = "doubao-1.5-vision-pro-250328";
export const DEFAULT_GPT55_MODEL = "gpt-5.5";

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

const dataRoot = path.resolve(process.env.ETSY_AGENT_DATA_PATH ?? dataRootDefault());
const desktopRoot = path.resolve(process.env.ETSY_AGENT_DESKTOP_ROOT ?? path.join(os.homedir(), "Desktop"));

function configuredDir(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return path.resolve(raw || fallback);
}

export const etsyAgentConfig = {
  envGpt55ApiKey: process.env.GPT55_API_KEY ?? "",
  envArkApiKey: process.env.ARK_API_KEY ?? "",
  eastReasoningApiKeyConfigured: Boolean(process.env.EAST_REASONING_API_KEY),
  hasEnvOpenaiApiKey: Boolean(process.env.OPENAI_API_KEY),
  imageProvider: "openai",
  promptProvider: (process.env.PROMPT_PROVIDER ?? "gpt55").trim().toLowerCase() || "gpt55",
  gpt55BaseURL: process.env.GPT55_BASE_URL ?? "",
  gpt55Model: process.env.GPT55_MODEL ?? "",
  gpt55MaxInputMb: numberEnv("GPT55_MAX_INPUT_MB", numberEnv("DOUBAO_PROMPT_MAX_INPUT_MB", 5)),
  gpt55BatchLimit: numberEnv("GPT55_BATCH_LIMIT", numberEnv("DOUBAO_PROMPT_BATCH_LIMIT", 10)),
  arkBaseURL: process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
  doubaoPromptModel: process.env.DOUBAO_PROMPT_MODEL ?? "",
  doubaoPromptMaxInputMb: numberEnv("DOUBAO_PROMPT_MAX_INPUT_MB", 5),
  doubaoPromptBatchLimit: numberEnv("DOUBAO_PROMPT_BATCH_LIMIT", 10),
  openaiBaseURL: process.env.OPENAI_BASE_URL ?? "",
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2",
  openaiImageSize: process.env.OPENAI_IMAGE_SIZE ?? "1024x1024",
  openaiImageQuality: process.env.OPENAI_IMAGE_QUALITY ?? "low",
  openaiImageInputFidelity: enumEnv("OPENAI_IMAGE_INPUT_FIDELITY", ["off", "low", "high"] as const, "off"),
  openaiImageMaxInputMb: numberEnv("OPENAI_IMAGE_MAX_INPUT_MB", 20),
  enableRealGeneration: boolEnvCompat("IMAGE_AGENT_ENABLE_REAL_GENERATION", "ETSY_AGENT_ENABLE_REAL_GENERATION", false),
  allowWebKeyConfig: process.env.VERCEL ? boolEnvCompat("IMAGE_AGENT_ALLOW_WEB_KEY_CONFIG", "ETSY_AGENT_ALLOW_WEB_KEY_CONFIG", false) : true,
  dataRoot,
  secureConfigPath: path.resolve(process.env.ETSY_AGENT_CONFIG_PATH ?? path.join(dataRoot, "secure-config.json")),
  securityLogPath: path.resolve(process.env.ETSY_AGENT_SECURITY_LOG_PATH ?? path.join(dataRoot, "security-events.log")),
  promptRecordsPath: path.resolve(process.env.ETSY_AGENT_PROMPT_RECORDS_PATH ?? path.join(dataRoot, "prompt-records.json")),
  listingRecordsPath: path.resolve(process.env.ETSY_AGENT_LISTING_RECORDS_PATH ?? path.join(dataRoot, "listing-records.json")),
  productWorkbenchRecordsPath: path.resolve(process.env.ETSY_AGENT_PRODUCT_WORKBENCH_RECORDS_PATH ?? path.join(dataRoot, "product-workbench-records.json")),
  inputAssetRecordsPath: path.resolve(process.env.ETSY_AGENT_INPUT_ASSETS_PATH ?? path.join(dataRoot, "input-assets.json")),
  folderSettingsPath: path.resolve(process.env.ETSY_AGENT_FOLDER_SETTINGS_PATH ?? path.join(dataRoot, "folder-settings.json")),
  storageProvider: (process.env.ASSET_STORAGE_PROVIDER ?? "local").trim() || "local",
  isVercel: Boolean(process.env.VERCEL),
  storageRoot: path.resolve(process.env.ETSY_AGENT_STORAGE_PATH ?? storageRootDefault()),
  inputDir: configuredDir("IMAGE_AGENT_INPUT_DIR", path.join(desktopRoot, "图片输入")),
  outputDir: configuredDir("IMAGE_AGENT_OUTPUT_DIR", path.join(desktopRoot, "图片输出")),
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
  pricingUsdCnyRate: numberEnv("ETSY_AGENT_USD_CNY_RATE", 6.8),
  pricingGbpCnyRate: numberEnv("ETSY_AGENT_GBP_CNY_RATE", 9.22),
  defaultShippingCny: numberEnv("ETSY_AGENT_DEFAULT_SHIPPING_CNY", 0),
};

export function publicUrlForStoragePath(filePath: string): string {
  const rel = path.relative(etsyAgentConfig.storageRoot, filePath).split(path.sep).join("/");
  return `${etsyAgentConfig.publicMediaPrefix}/${rel}`;
}

export function storagePathFromPublicUrl(url: string): string {
  const prefix = etsyAgentConfig.publicMediaPrefix;
  if (url !== prefix && !url.startsWith(`${prefix}/`)) {
    throw new Error("Unsafe media path: URL is outside public media prefix");
  }
  const rel = decodeURIComponent(url.slice(prefix.length).replace(/^\/+/, ""));
  const storageRoot = path.resolve(etsyAgentConfig.storageRoot);
  const resolved = path.resolve(storageRoot, rel);
  const relative = path.relative(storageRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Unsafe media path: resolved path is outside storage root");
  }
  return resolved;
}
