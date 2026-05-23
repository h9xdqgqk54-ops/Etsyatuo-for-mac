import * as fs from "node:fs";
import { etsyAgentConfig } from "./config.js";
import { loadSharp } from "./sharpRuntime.js";

export async function getImageInfo(filePath: string): Promise<{ width?: number; height?: number; perceptualKey: string }> {
  try {
    const sharp = await loadSharp();
    const image = sharp(filePath);
    const meta = await image.metadata();
    const stat = await image
      .resize(8, 8, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer();
    const avg = stat.reduce((sum, v) => sum + v, 0) / Math.max(stat.length, 1);
    const bits = Array.from(stat).map((v) => (v > avg ? "1" : "0")).join("");
    return { width: meta.width, height: meta.height, perceptualKey: bits };
  } catch {
    return { perceptualKey: "unknown" };
  }
}

export async function normalizeGeneratedImage(input: Buffer, outputPath: string): Promise<{ width: number; height: number; outputSize: string }> {
  const target = etsyAgentConfig.targetExportSize;
  const sharp = await loadSharp();
  await sharp(input)
    .rotate()
    .resize(target, target, {
      fit: "contain",
      background: { r: 250, g: 250, b: 248, alpha: 1 },
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  return { width: target, height: target, outputSize: `${target}x${target}` };
}

export async function createMockProductImage(outputPath: string, label: string, hue: number): Promise<{ width: number; height: number; outputSize: string }> {
  const target = etsyAgentConfig.targetExportSize;
  const sharp = await loadSharp();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${target}" height="${target}" viewBox="0 0 ${target} ${target}">
    <rect width="100%" height="100%" fill="#fafaf8"/>
    <rect x="120" y="120" width="${target - 240}" height="${target - 240}" rx="36" fill="hsl(${hue}, 24%, 94%)" stroke="hsl(${hue}, 18%, 82%)" stroke-width="6"/>
    <circle cx="${target / 2}" cy="${target / 2 - 110}" r="210" fill="hsl(${hue}, 46%, 74%)" opacity="0.92"/>
    <rect x="${target / 2 - 330}" y="${target / 2 + 170}" width="660" height="34" rx="17" fill="hsl(${hue}, 20%, 70%)" opacity="0.55"/>
    <text x="${target / 2}" y="${target / 2 + 330}" text-anchor="middle" font-family="Arial, sans-serif" font-size="64" font-weight="700" fill="#30343b">${escapeSvg(label).slice(0, 34)}</text>
    <text x="${target / 2}" y="${target / 2 + 420}" text-anchor="middle" font-family="Arial, sans-serif" font-size="38" fill="#6b7280">Etsy listing mock output</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return { width: target, height: target, outputSize: `${target}x${target}` };
}

export async function readImageBuffer(filePath: string): Promise<Buffer> {
  return fs.promises.readFile(filePath);
}

function escapeSvg(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
