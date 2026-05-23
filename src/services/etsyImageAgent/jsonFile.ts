import * as fs from "node:fs";
import * as path from "node:path";
import { ensureDir } from "./utils.js";

export function readJsonFile<T>(filePath: string, fallback: T): T {
  const target = path.resolve(filePath);
  try {
    if (!fs.existsSync(target)) return recoverTmpJson(target, fallback);
    return JSON.parse(fs.readFileSync(target, "utf-8")) as T;
  } catch {
    return recoverTmpJson(target, fallback);
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  const target = path.resolve(filePath);
  ensureDir(path.dirname(target));
  const tmp = tmpJsonPath(target);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmp, target);
}

function recoverTmpJson<T>(target: string, fallback: T): T {
  const tmp = tmpJsonPath(target);
  if (!fs.existsSync(tmp)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(tmp, "utf-8")) as T;
    ensureDir(path.dirname(target));
    fs.renameSync(tmp, target);
    return parsed;
  } catch {
    return fallback;
  }
}

function tmpJsonPath(target: string): string {
  return `${target}.tmp`;
}
