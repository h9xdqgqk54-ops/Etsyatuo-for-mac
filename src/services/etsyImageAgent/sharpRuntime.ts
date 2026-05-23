import type sharp from "sharp";
import { structuredError } from "./structuredErrors.js";

type SharpFactory = typeof sharp;

let cachedSharp: SharpFactory | undefined;

export async function loadSharp(): Promise<SharpFactory> {
  if (cachedSharp) return cachedSharp;
  try {
    const mod = await import("sharp");
    cachedSharp = mod.default;
    return cachedSharp;
  } catch (error) {
    throw structuredError({
      code: "SHARP_RUNTIME_MISSING",
      message: "SHARP_RUNTIME_MISSING：图片处理运行时 sharp 加载失败。请使用完整的 Windows 交付包，不要只复制 Etsyauto.exe。",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
