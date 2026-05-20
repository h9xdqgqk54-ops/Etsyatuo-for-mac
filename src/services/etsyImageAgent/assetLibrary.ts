import * as fs from "node:fs";
import * as path from "node:path";
import { etsyAgentConfig } from "./config.js";
import { listGroupSessions } from "./groupSessionStore.js";
import type { AssetRecord, EtsyAgentTask } from "./types.js";
import { ensureDir } from "./utils.js";

const metadataDir = path.join(etsyAgentConfig.storageRoot, "metadata");
const assetsFile = path.join(metadataDir, "assets.json");
const tasksFile = path.join(metadataDir, "tasks.json");

export function initStorage(): void {
  ensureDir(etsyAgentConfig.storageRoot);
  ensureDir(metadataDir);
  ensureDir(path.join(etsyAgentConfig.storageRoot, "assets"));
  ensureDir(path.join(etsyAgentConfig.storageRoot, "originals"));
  if (!fs.existsSync(assetsFile)) fs.writeFileSync(assetsFile, "[]", "utf-8");
  if (!fs.existsSync(tasksFile)) fs.writeFileSync(tasksFile, "[]", "utf-8");
}

export function listAssets(): AssetRecord[] {
  initStorage();
  return readJson<AssetRecord[]>(assetsFile, []);
}

export function saveAsset(asset: AssetRecord): void {
  const assets = listAssets();
  const idx = assets.findIndex((a) => a.assetId === asset.assetId);
  if (idx >= 0) assets[idx] = asset;
  else assets.push(asset);
  writeJson(assetsFile, assets);
}

export function deleteAsset(assetId: string): boolean {
  const assets = listAssets();
  const asset = assets.find((a) => a.assetId === assetId);
  if (!asset) return false;
  if (fs.existsSync(asset.generatedFilePath)) fs.unlinkSync(asset.generatedFilePath);
  writeJson(assetsFile, assets.filter((a) => a.assetId !== assetId));
  return true;
}

export function findAsset(assetId: string): AssetRecord | undefined {
  return listAssets().find((a) => a.assetId === assetId);
}

export function listTasks(): EtsyAgentTask[] {
  initStorage();
  return readJson<EtsyAgentTask[]>(tasksFile, []);
}

export function saveTask(task: EtsyAgentTask): void {
  const tasks = listTasks();
  const idx = tasks.findIndex((t) => t.taskId === task.taskId);
  if (idx >= 0) tasks[idx] = task;
  else tasks.unshift(task);
  writeJson(tasksFile, tasks.slice(0, 200));
}

export function findTask(taskId: string): EtsyAgentTask | undefined {
  return listTasks().find((t) => t.taskId === taskId);
}

export function isRegisteredMediaPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  if (listAssets().some((asset) => path.resolve(asset.generatedFilePath) === resolved)) return true;
  if (listTasks().some((task) =>
    task.groups.some((group) =>
      group.images.some((image) => path.resolve(image.storedPath) === resolved),
    ),
  )) return true;
  return listGroupSessions().some((session) => session.images.some((image) => path.resolve(image.storedPath) === resolved));
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}
