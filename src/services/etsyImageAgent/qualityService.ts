import * as fs from "node:fs";
import { loadSharp } from "./sharpRuntime.js";
import type { AssetRecord, QualityResult } from "./types.js";

export async function checkGeneratedImageQuality(filePath: string, prompt: string, existing: AssetRecord[]): Promise<QualityResult> {
  if (!fs.existsSync(filePath)) return { status: "fail", reason: "生成文件不存在。" };
  try {
    const sharp = await loadSharp();
    const meta = await sharp(filePath).metadata();
    if (!meta.width || !meta.height) return { status: "fail", reason: "无法读取图片尺寸。" };
    if (Math.abs(meta.width - meta.height) > 2) return { status: "fail", reason: "图片不是 1:1 正方形。" };
    if (meta.width < 1000 || meta.height < 1000) return { status: "warning", reason: "图片尺寸低于 Etsy 高质量 listing 建议目标。" };
    if (/text|words|label|logo|watermark/i.test(prompt)) {
      return { status: "warning", reason: "Prompt 涉及文字、logo 或水印，需检查是否存在乱码或误导标识。" };
    }
    const duplicate = existing.find((a) => a.optimizedPrompt === prompt);
    if (duplicate) return { status: "warning", reason: "该图的 prompt 与已有生成图高度相似，注意避免 listing 图片同质化。" };
    return { status: "pass", reason: "尺寸、比例和基础质量检查通过。" };
  } catch (error) {
    return { status: "fail", reason: `图片质量检查失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
