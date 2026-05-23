import * as fs from "node:fs";
import * as path from "node:path";
import { etsyAgentConfig } from "./config.js";
import { getImageAgentFolderSettings } from "./folderSettings.js";
import { structuredError } from "./structuredErrors.js";
import type { InputAssetRecord } from "./types.js";
import { ensureDir, hashBuffer, nowIso, safeJoin, slugify } from "./utils.js";

const IMAGE_EXTENSIONS = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

export function imageAgentFolders(): { inputDir: string; outputDir: string } {
  const settings = getImageAgentFolderSettings();
  return {
    inputDir: settings.inputDir,
    outputDir: settings.outputDir,
  };
}

export function scanInputAssets(): { inputDir: string; outputDir: string; assets: InputAssetRecord[] } {
  const folders = imageAgentFolders();
  assertInputDirectory(folders.inputDir);
  const existing = new Map(listInputAssets().map((asset) => [asset.inputAssetId, asset]));
  const now = nowIso();
  const assets = visibleFiles(folders.inputDir)
    .map((fileName) => assetFromFile(folders.inputDir, fileName, existing, now))
    .filter((asset): asset is InputAssetRecord => Boolean(asset))
    .sort((a, b) => a.fileName.localeCompare(b.fileName, "zh-CN", { numeric: true }));
  writeInputAssets(assets);
  return { ...folders, assets };
}

export function listInputAssets(): InputAssetRecord[] {
  return readJson<InputAssetRecord[]>(etsyAgentConfig.inputAssetRecordsPath, []);
}

export function findInputAsset(inputAssetId: string): InputAssetRecord | undefined {
  return listInputAssets().find((asset) => asset.inputAssetId === inputAssetId);
}

export function requireInputAsset(inputAssetId: string): InputAssetRecord {
  const asset = findInputAsset(inputAssetId);
  if (!asset) {
    throw structuredError({
      code: "INPUT_ASSET_NOT_FOUND",
      message: "INPUT_ASSET_NOT_FOUND：未找到已登记的输入图片，请先扫描图片输入目录。",
      provider: "gpt55",
    });
  }
  return asset;
}

export function isRegisteredInputAssetPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return listInputAssets().some((asset) => path.resolve(asset.filePath) === resolved);
}

export function publicUrlForInputAsset(inputAssetId: string): string {
  return `/api/etsy-agent/input-assets/${encodeURIComponent(inputAssetId)}/image`;
}

function assetFromFile(inputDir: string, fileName: string, existing: Map<string, InputAssetRecord>, now: string): InputAssetRecord | null {
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = IMAGE_EXTENSIONS.get(ext);
  if (!mimeType) return null;
  const filePath = safeJoin(inputDir, fileName);
  const stats = fs.statSync(filePath);
  const data = fs.readFileSync(filePath);
  const contentHash = hashBuffer(data);
  const baseName = path.basename(fileName, ext);
  const inputAssetId = `input_${hashBuffer(Buffer.from(`${fileName}\0${contentHash}`)).slice(0, 18)}`;
  const previous = existing.get(inputAssetId);
  return {
    inputAssetId,
    displayName: baseName || slugify(fileName, "image"),
    baseName,
    fileName,
    filePath,
    mimeType,
    sizeBytes: stats.size,
    hash: contentHash,
    publicUrl: publicUrlForInputAsset(inputAssetId),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

function assertInputDirectory(inputDir: string): void {
  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    throw structuredError({
      code: "INPUT_DIR_NOT_FOUND",
      message: `INPUT_DIR_NOT_FOUND：图片输入目录不存在，请创建目录：${inputDir}`,
      provider: "gpt55",
      reason: inputDir,
    });
  }
}

function visibleFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeInputAssets(assets: InputAssetRecord[]): void {
  ensureDir(path.dirname(etsyAgentConfig.inputAssetRecordsPath));
  fs.writeFileSync(etsyAgentConfig.inputAssetRecordsPath, JSON.stringify(assets, null, 2), "utf-8");
}
