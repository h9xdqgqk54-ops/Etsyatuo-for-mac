import type sharp from "sharp";
import { createRequire } from "node:module";
import * as path from "node:path";
import { structuredError } from "./structuredErrors.js";

type SharpFactory = typeof sharp;

let cachedSharp: SharpFactory | undefined;
const SHARP_PACKAGE_NAME = "sharp";
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

export async function loadSharp(): Promise<SharpFactory> {
  if (cachedSharp) return cachedSharp;
  const errors: string[] = [];
  try {
    cachedSharp = normalizeSharpModule(await import("sharp"));
    return cachedSharp;
  } catch (error) {
    errors.push(formatSharpLoadError("dynamic import", error));
  }
  try {
    cachedSharp = loadSharpFromRequire();
    return cachedSharp;
  } catch (error) {
    errors.push(formatSharpLoadError("sidecar require", error));
    throw structuredError({
      code: "SHARP_RUNTIME_MISSING",
      message: sharpRuntimeMissingMessage(),
      reason: errors.join("\n"),
    });
  }
}

export async function diagnoseSharpRuntime(): Promise<{ sharpLoaded: true; format?: string; width?: number; height?: number }> {
  const sharp = await loadSharp();
  const meta = await sharp(Buffer.from(TINY_PNG_BASE64, "base64")).metadata();
  return {
    sharpLoaded: true,
    format: meta.format,
    width: meta.width,
    height: meta.height,
  };
}

function loadSharpFromRequire(): SharpFactory {
  const errors: string[] = [];
  for (const filename of sharpRequireFilenames()) {
    try {
      return normalizeSharpModule(createRequire(filename)(SHARP_PACKAGE_NAME));
    } catch (error) {
      errors.push(`${filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(errors.join("\n"));
}

function sharpRequireFilenames(): string[] {
  const filenames = new Set<string>();
  if (isPkgRuntime()) {
    filenames.add(path.join(path.dirname(process.execPath), "package.json"));
  }
  filenames.add(path.join(process.cwd(), "package.json"));
  return Array.from(filenames).filter((filename) => typeof filename === "string" && filename.length > 0);
}

function isPkgRuntime(): boolean {
  return Boolean((process as unknown as { pkg?: unknown }).pkg);
}

function sharpRuntimeMissingMessage(): string {
  if (process.platform === "darwin") {
    return "SHARP_RUNTIME_MISSING：图片处理运行时 sharp 加载失败。请完整解压 Etsyauto-Mac.zip，不要只复制 Etsyauto 可执行文件；并确认 node_modules 文件夹和启动脚本在同一个目录。";
  }
  if (process.platform === "win32") {
    return "SHARP_RUNTIME_MISSING：图片处理运行时 sharp 加载失败。请使用完整的 Windows 交付包，不要只复制 Etsyauto.exe；并确认 node_modules 文件夹和启动脚本在同一个目录。";
  }
  return "SHARP_RUNTIME_MISSING：图片处理运行时 sharp 加载失败。请确认 node_modules 文件夹和启动脚本在同一个目录，并重新安装依赖。";
}

function normalizeSharpModule(mod: unknown): SharpFactory {
  const direct = mod as SharpFactory;
  if (typeof direct === "function") return direct;
  const wrapped = mod as { default?: SharpFactory };
  if (typeof wrapped.default === "function") return wrapped.default;
  throw new Error("sharp module did not export a callable factory");
}

function formatSharpLoadError(strategy: string, error: unknown): string {
  return `${strategy}: ${error instanceof Error ? error.message : String(error)}`;
}
