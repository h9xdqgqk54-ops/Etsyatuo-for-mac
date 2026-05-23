import * as fs from "node:fs";
import * as path from "node:path";
import { etsyAgentConfig } from "./config.js";
import { structuredError } from "./structuredErrors.js";
import { ensureDir } from "./utils.js";

export type FolderSettingSource = "saved" | "env" | "default";

export interface ImageAgentFolderSettings {
  inputDir: string;
  outputDir: string;
  sources: {
    inputDir: FolderSettingSource;
    outputDir: FolderSettingSource;
  };
}

interface SavedFolderSettings {
  inputDir?: string;
  outputDir?: string;
}

export function getImageAgentFolderSettings(): ImageAgentFolderSettings {
  const saved = readSavedFolderSettings();
  const inputSaved = normalizePathValue(saved.inputDir);
  const outputSaved = normalizePathValue(saved.outputDir);
  return {
    inputDir: inputSaved ?? etsyAgentConfig.inputDir,
    outputDir: outputSaved ?? etsyAgentConfig.outputDir,
    sources: {
      inputDir: inputSaved ? "saved" : process.env.IMAGE_AGENT_INPUT_DIR?.trim() ? "env" : "default",
      outputDir: outputSaved ? "saved" : process.env.IMAGE_AGENT_OUTPUT_DIR?.trim() ? "env" : "default",
    },
  };
}

export function saveImageAgentFolderSettings(input: { inputDir?: string; outputDir?: string }): ImageAgentFolderSettings {
  const inputDir = path.resolve(requireFolderPath(input.inputDir, "inputDir"));
  const outputDir = path.resolve(requireFolderPath(input.outputDir, "outputDir"));
  validateDirectory(inputDir, "input");
  validateDirectory(outputDir, "output");
  ensureDir(path.dirname(etsyAgentConfig.folderSettingsPath));
  fs.writeFileSync(etsyAgentConfig.folderSettingsPath, JSON.stringify({ inputDir, outputDir }, null, 2), "utf-8");
  return getImageAgentFolderSettings();
}

function requireFolderPath(value: string | undefined, field: "inputDir" | "outputDir"): string {
  const text = value?.trim();
  if (!text) {
    throw structuredError({
      code: field === "inputDir" ? "FOLDER_SETTINGS_INPUT_DIR_INVALID" : "FOLDER_SETTINGS_OUTPUT_DIR_INVALID",
      message: `${field === "inputDir" ? "FOLDER_SETTINGS_INPUT_DIR_INVALID" : "FOLDER_SETTINGS_OUTPUT_DIR_INVALID"}：请选择有效的${field === "inputDir" ? "图片输入" : "图片输出"}目录。`,
      reason: field,
    });
  }
  return text;
}

function validateDirectory(dir: string, kind: "input" | "output"): void {
  const code = kind === "input" ? "FOLDER_SETTINGS_INPUT_DIR_INVALID" : "FOLDER_SETTINGS_OUTPUT_DIR_INVALID";
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error("not a directory");
    }
    fs.accessSync(dir, kind === "input" ? fs.constants.R_OK : fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    throw structuredError({
      code,
      message: `${code}：${kind === "input" ? "图片输入" : "图片输出"}目录不存在，或当前服务没有${kind === "input" ? "读取" : "读写"}权限。`,
      reason: `${dir}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function normalizePathValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? path.resolve(value.trim()) : undefined;
}

function readSavedFolderSettings(): SavedFolderSettings {
  try {
    return JSON.parse(fs.readFileSync(etsyAgentConfig.folderSettingsPath, "utf-8")) as SavedFolderSettings;
  } catch {
    return {};
  }
}
