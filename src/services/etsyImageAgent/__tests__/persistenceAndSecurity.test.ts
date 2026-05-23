import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("persistence and media path safety", () => {
  it("recovers JSON records from a valid tmp file when the target file is corrupted", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-json-recovery-"));
    const recordsPath = path.join(root, "data", "prompt-records.json");
    fs.mkdirSync(path.dirname(recordsPath), { recursive: true });
    process.env.ETSY_AGENT_PROMPT_RECORDS_PATH = recordsPath;

    const recoveredRecord = {
      id: "prompt_recovered",
      inputAssetId: "input_recovered",
      productGroupId: "input_recovered",
      role: "main",
      detectedProduct: "recovered product",
      promptText: "Recovered prompt",
      negativePrompt: "",
      source: "gpt55-vision",
      status: "generated",
      confidence: 0.9,
      model: "fake-vision-model",
      promptHash: "hash",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(recordsPath, "{ broken json", "utf-8");
    fs.writeFileSync(`${recordsPath}.tmp`, JSON.stringify([recoveredRecord], null, 2), "utf-8");

    const { listImagePromptRecords } = await import("../promptGenerationService.js");

    expect(listImagePromptRecords()).toEqual([expect.objectContaining({ id: "prompt_recovered" })]);
    expect(fs.existsSync(`${recordsPath}.tmp`)).toBe(false);
    expect(JSON.parse(fs.readFileSync(recordsPath, "utf-8"))).toEqual([recoveredRecord]);
  });

  it("rejects public media URLs that resolve outside the storage root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-media-root-"));
    process.env.ETSY_AGENT_STORAGE_PATH = path.join(root, "storage");
    const { storagePathFromPublicUrl } = await import("../config.js");

    expect(() => storagePathFromPublicUrl("/media/etsy-agent/../../secret.txt")).toThrow(/Unsafe media path/);
    expect(() => storagePathFromPublicUrl("/media/etsy-agent-copy/secret.txt")).toThrow(/Unsafe media path/);
  });
});
