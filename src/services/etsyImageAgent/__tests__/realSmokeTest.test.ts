import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

beforeEach(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-smoke-config-"));
  process.env.ETSY_AGENT_CONFIG_PATH = path.join(tmp, "secure-config.json");
  process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(tmp, "security.log");
  process.env.ETSY_AGENT_STORAGE_PATH = path.join(tmp, "storage");
  process.env.OPENAI_IMAGE_MODEL = "gpt-image-2";
  process.env.OPENAI_IMAGE_SIZE = "1024x1024";
  process.env.OPENAI_IMAGE_QUALITY = "low";
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("realSmokeTest guards", () => {
  it("blocks real smoke test when real generation switch is disabled", async () => {
    process.env.OPENAI_API_KEY = "sk-test_abcdefghijklmnopqrstuvwxyz";
    process.env.IMAGE_AGENT_ENABLE_REAL_GENERATION = "false";
    const mod = await import("../realSmokeTest.js");
    expect(() => mod.assertRealImageSmokeTestAllowed()).toThrow(/真实图片生成未启用/);
  });

  it("blocks real smoke test when OpenAI key is missing", async () => {
    process.env.OPENAI_API_KEY = "";
    process.env.IMAGE_AGENT_ENABLE_REAL_GENERATION = "true";
    const mod = await import("../realSmokeTest.js");
    expect(() => mod.assertRealImageSmokeTestAllowed()).toThrow(/OPENAI_API_KEY_MISSING/);
  });

  it("does not write an asset when smoke test is blocked before generation", async () => {
    process.env.OPENAI_API_KEY = "sk-test_abcdefghijklmnopqrstuvwxyz";
    process.env.IMAGE_AGENT_ENABLE_REAL_GENERATION = "false";
    const smoke = await import("../realSmokeTest.js");
    const { listAssets } = await import("../assetLibrary.js");
    await expect(smoke.runRealImageSmokeTest()).rejects.toThrow(/真实图片生成未启用/);
    expect(listAssets()).toHaveLength(0);
  });
});
