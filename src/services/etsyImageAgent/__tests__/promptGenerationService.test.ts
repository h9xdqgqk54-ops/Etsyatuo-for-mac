import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function setupPromptRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-prompt-root-"));
  fs.mkdirSync(path.join(root, "图片输入"), { recursive: true });
  fs.mkdirSync(path.join(root, "图片输出"), { recursive: true });
  process.env.IMAGE_AGENT_INPUT_DIR = path.join(root, "图片输入");
  process.env.IMAGE_AGENT_OUTPUT_DIR = path.join(root, "图片输出");
  process.env.ETSY_AGENT_DATA_PATH = path.join(root, "data");
  process.env.ETSY_AGENT_STORAGE_PATH = path.join(root, "storage");
  process.env.ETSY_AGENT_PROMPT_RECORDS_PATH = path.join(root, "data", "prompt-records.json");
  process.env.ETSY_AGENT_INPUT_ASSETS_PATH = path.join(root, "data", "input-assets.json");
  process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(root, "data", "security.log");
  process.env.GPT55_API_KEY = "fake-gpt55-key";
  process.env.GPT55_BASE_URL = "https://ark.example.test/api/v3";
  process.env.GPT55_MODEL = "fake-vision-model";
  process.env.GPT55_MAX_INPUT_MB = "5";
  process.env.GPT55_BATCH_LIMIT = "10";
  return root;
}

function writeImage(root: string, fileName = "001.jpg", bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9])): void {
  fs.writeFileSync(path.join(root, "图片输入", fileName), bytes);
}

function mockGpt55Response(content: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    expect(String(init.body)).not.toContain("fake-gpt55-key");
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
    }), {
      status: 200,
      headers: { "x-request-id": "req_gpt55_prompt" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function validatePromptProvider(): Promise<void> {
  const secureConfig = await import("../secureConfig.js");
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: "OK" } }],
  }), { status: 200, headers: { "x-request-id": "req_validation_ok" } }));
  vi.stubGlobal("fetch", fetchMock);
  const result = await secureConfig.testGpt55PromptProviderConnection();
  expect(result.ok).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  vi.unstubAllGlobals();
}

describe("prompt generation service", () => {
  it("registers input assets and generates persisted GPT5.5 prompt records", async () => {
    const root = setupPromptRoot();
    writeImage(root);
    await validatePromptProvider();
    const fetchMock = mockGpt55Response(JSON.stringify({
      role: "main",
      detectedProduct: "jellycat bunny",
      promptText: "这是 jellycat 的邦尼兔，保持产品外观不变，增加美式复古元素，生成 Etsy 电商主图。",
      negativePrompt: "不要文字、水印、logo",
      confidence: 0.91,
    }));
    const service = await import("../promptGenerationService.js");
    const result = await service.generatePromptsFromImages();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.records).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.records[0]).toMatchObject({
      source: "gpt55-vision",
      status: "generated",
      model: "fake-vision-model",
      providerTraceId: "req_gpt55_prompt",
    });
    expect(result.records[0]?.inputAssetId).toMatch(/^input_/);
    expect(result.records[0]?.promptHash).toBeTruthy();

    vi.resetModules();
    const serviceAfterRestart = await import("../promptGenerationService.js");
    expect(serviceAfterRestart.listImagePromptRecords()).toHaveLength(1);
  });

  it("parses fenced JSON from GPT5.5", async () => {
    setupPromptRoot();
    const { parseGpt55PromptJson } = await import("../promptProviders/gpt55PromptProvider.js");
    const parsed = parseGpt55PromptJson("```json\n{\"role\":\"secondary\",\"detectedProduct\":\"兔子\",\"promptText\":\"生成副图\",\"negativePrompt\":\"不要文字\",\"confidence\":0.8}\n```");
    expect(parsed).toMatchObject({ role: "secondary", promptText: "生成副图", confidence: 0.8 });
  });

  it("parses GPT5.5 style names and enforces 20 character English names", async () => {
    setupPromptRoot();
    const { parseGpt55StyleNamesJson } = await import("../promptProviders/gpt55PromptProvider.js");

    const parsed = parseGpt55StyleNamesJson(JSON.stringify({
      styles: [
        { itemId: "item_1", styleNameEn: "Pink Floral Bunny" },
        { itemId: "item_2", styleNameEn: "Gray Floral Bunny" },
      ],
    }));

    expect(parsed.styles).toEqual([
      { itemId: "item_1", styleNameEn: "Pink Floral Bunny" },
      { itemId: "item_2", styleNameEn: "Gray Floral Bunny" },
    ]);
    expect(() => parseGpt55StyleNamesJson(JSON.stringify({
      styles: [{ itemId: "item_1", styleNameEn: "Very Long Floral Bunny Name" }],
    }))).toThrow(/20/);
  });

  it("persists a failed prompt record for bad JSON without saving bad prompt text", async () => {
    const root = setupPromptRoot();
    writeImage(root);
    await validatePromptProvider();
    mockGpt55Response("不是 JSON");
    const service = await import("../promptGenerationService.js");
    const result = await service.generatePromptsFromImages();
    expect(result.records).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ status: "failed" });
    expect(result.failed[0]?.error).toMatchObject({ code: "GPT55_PROMPT_PARSE_FAILED" });
    expect(service.listImagePromptRecords()).toHaveLength(1);
    expect(service.listImagePromptRecords()[0]).toMatchObject({ status: "failed", promptText: "" });
  });

  it("treats vision unsupported errors as global config errors without writing an image record", async () => {
    const root = setupPromptRoot();
    writeImage(root);
    await validatePromptProvider();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "image input is not supported by this model" } }), { status: 400 })));
    const service = await import("../promptGenerationService.js");
    await expect(service.generatePromptsFromImages()).rejects.toMatchObject({ code: "GPT55_VISION_NOT_SUPPORTED" });
    expect(service.listImagePromptRecords()).toHaveLength(0);
  });

  it("enforces batch and input size limits", async () => {
    let root = setupPromptRoot();
    process.env.GPT55_BATCH_LIMIT = "1";
    writeImage(root, "001.jpg");
    writeImage(root, "002.jpg");
    let service = await import("../promptGenerationService.js");
    await expect(service.generatePromptsFromImages()).rejects.toMatchObject({ code: "PROMPT_BATCH_LIMIT_EXCEEDED" });

    vi.resetModules();
    root = setupPromptRoot();
    process.env.GPT55_MAX_INPUT_MB = "0.000001";
    writeImage(root, "001.jpg", Buffer.alloc(20));
    await validatePromptProvider();
    service = await import("../promptGenerationService.js");
    const result = await service.generatePromptsFromImages();
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.error).toMatchObject({ code: "GPT55_IMAGE_TOO_LARGE" });
  });

  it("keeps generating other images when one image fails", async () => {
    const root = setupPromptRoot();
    writeImage(root, "001.jpg");
    writeImage(root, "002.jpg");
    await validatePromptProvider();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "不是 JSON" } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          role: "secondary",
          detectedProduct: "bunny",
          promptText: "这是兔子，保持外观不变，生成 Etsy 副图。",
          negativePrompt: "不要文字",
          confidence: 0.8,
        }) } }],
      }), { status: 200, headers: { "x-request-id": "req_ok" } }));
    vi.stubGlobal("fetch", fetchMock);
    const service = await import("../promptGenerationService.js");
    const result = await service.generatePromptsFromImages();
    expect(result.records).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.error).toMatchObject({ code: "GPT55_PROMPT_PARSE_FAILED" });
    expect(service.listImagePromptRecords()).toHaveLength(2);
  });

  it("classifies GPT5.5 auth, permission, and missing model failures without misreporting vision support", async () => {
    const cases: Array<[number, string, string]> = [
      [401, "invalid api key", "GPT55_AUTH_FAILED"],
      [403, "permission denied for this model", "GPT55_PERMISSION_DENIED"],
      [404, "model not found", "GPT55_MODEL_NOT_ACCESSIBLE"],
    ];
    for (const [status, body, code] of cases) {
      vi.resetModules();
      vi.unstubAllGlobals();
      const root = setupPromptRoot();
      writeImage(root);
      await validatePromptProvider();
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: body } }), { status })));
      const service = await import("../promptGenerationService.js");
      await expect(service.generatePromptsFromImages()).rejects.toMatchObject({ code });
      expect(service.listImagePromptRecords()).toHaveLength(0);
    }
  });

  it("skips edited and approved records during batch generation and requires overwrite confirmation", async () => {
    const root = setupPromptRoot();
    writeImage(root, "001.jpg");
    writeImage(root, "002.jpg");
    const service = await import("../promptGenerationService.js");
    const { scanInputAssets } = await import("../inputAssetRegistry.js");
    const scan = scanInputAssets();
    const now = new Date().toISOString();
    fs.mkdirSync(path.dirname(process.env.ETSY_AGENT_PROMPT_RECORDS_PATH!), { recursive: true });
    fs.writeFileSync(process.env.ETSY_AGENT_PROMPT_RECORDS_PATH!, JSON.stringify(scan.assets.map((asset, index) => ({
      id: `prompt_${index}`,
      inputAssetId: asset.inputAssetId,
      productGroupId: asset.inputAssetId,
      role: "main",
      detectedProduct: "product",
      promptText: `manual ${index}`,
      negativePrompt: "no text",
      source: "gpt55-vision",
      status: index === 0 ? "edited" : "approved",
      confidence: 0.9,
      model: "fake-vision-model",
      promptHash: `hash_${index}`,
      createdAt: now,
      updatedAt: now,
    })), null, 2), "utf-8");
    const result = await service.generatePromptsFromImages({ mode: "regenerate" });
    expect(result.records).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
    await expect(service.regenerateImagePromptRecord("prompt_0")).rejects.toMatchObject({ code: "PROMPT_OVERWRITE_CONFIRMATION_REQUIRED" });
  });

  it("single regenerate stores a failed record instead of throwing provider failures", async () => {
    const root = setupPromptRoot();
    writeImage(root, "001.jpg");
    await validatePromptProvider();
    const service = await import("../promptGenerationService.js");
    const { scanInputAssets } = await import("../inputAssetRegistry.js");
    const [asset] = scanInputAssets().assets;
    const now = new Date().toISOString();
    fs.mkdirSync(path.dirname(process.env.ETSY_AGENT_PROMPT_RECORDS_PATH!), { recursive: true });
    fs.writeFileSync(process.env.ETSY_AGENT_PROMPT_RECORDS_PATH!, JSON.stringify([{
      id: "prompt_0",
      inputAssetId: asset!.inputAssetId,
      productGroupId: asset!.inputAssetId,
      role: "main",
      detectedProduct: "product",
      promptText: "",
      negativePrompt: "",
      source: "gpt55-vision",
      status: "failed",
      confidence: 0,
      model: "fake-vision-model",
      promptHash: "hash",
      createdAt: now,
      updatedAt: now,
    }], null, 2), "utf-8");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad json" } }), { status: 500 })));
    const record = await service.regenerateImagePromptRecord("prompt_0");
    expect(record.status).toBe("failed");
    expect(record.error).toMatchObject({ code: "GPT55_PROMPT_GENERATION_FAILED" });
  });

  it("clears stale model and vision failures without deleting manual prompt records", async () => {
    const root = setupPromptRoot();
    writeImage(root, "001.jpg");
    const service = await import("../promptGenerationService.js");
    const { scanInputAssets } = await import("../inputAssetRegistry.js");
    const [asset] = scanInputAssets().assets;
    const now = new Date().toISOString();
    fs.mkdirSync(path.dirname(process.env.ETSY_AGENT_PROMPT_RECORDS_PATH!), { recursive: true });
    fs.writeFileSync(process.env.ETSY_AGENT_PROMPT_RECORDS_PATH!, JSON.stringify([
      {
        id: "prompt_failed_old",
        inputAssetId: asset!.inputAssetId,
        productGroupId: asset!.inputAssetId,
        role: "main",
        detectedProduct: "",
        promptText: "",
        negativePrompt: "",
        source: "gpt55-vision",
        status: "failed",
        confidence: 0,
        model: "old-model",
        promptHash: "",
        createdAt: now,
        updatedAt: now,
        error: { code: "GPT55_MODEL_NOT_ACCESSIBLE", message: "old model failed" },
      },
      {
        id: "prompt_edited",
        inputAssetId: "input_manual",
        productGroupId: "input_manual",
        role: "main",
        detectedProduct: "manual",
        promptText: "人工提示词",
        negativePrompt: "不要文字",
        source: "gpt55-vision",
        status: "edited",
        confidence: 1,
        model: "old-model",
        promptHash: "manual_hash",
        createdAt: now,
        updatedAt: now,
        error: { code: "GPT55_MODEL_NOT_ACCESSIBLE", message: "should be preserved" },
      },
    ], null, 2), "utf-8");
    expect(service.clearStalePromptProviderFailures()).toEqual({ deleted: 1 });
    expect(service.listImagePromptRecords().map((record) => record.id)).toEqual(["prompt_edited"]);
  });

  it("clears empty current-model configuration failures so cards can return to manual prompt entry", async () => {
    const root = setupPromptRoot();
    writeImage(root);
    const service = await import("../promptGenerationService.js");
    const { scanInputAssets } = await import("../inputAssetRegistry.js");
    const [asset] = scanInputAssets().assets;
    const now = new Date().toISOString();
    fs.mkdirSync(path.dirname(process.env.ETSY_AGENT_PROMPT_RECORDS_PATH!), { recursive: true });
    fs.writeFileSync(process.env.ETSY_AGENT_PROMPT_RECORDS_PATH!, JSON.stringify([{
      id: "prompt_failed_current_model",
      inputAssetId: asset!.inputAssetId,
      productGroupId: asset!.inputAssetId,
      role: "main",
      detectedProduct: "",
      promptText: "",
      negativePrompt: "",
      source: "gpt55-vision",
      status: "failed",
      confidence: 0,
      model: "fake-vision-model",
      promptHash: "",
      createdAt: now,
      updatedAt: now,
      error: { code: "GPT55_MODEL_NOT_ACCESSIBLE", message: "current model failed" },
    }], null, 2), "utf-8");

    expect(service.clearStalePromptProviderFailures()).toEqual({ deleted: 1 });
    expect(service.listImagePromptRecords()).toHaveLength(0);
  });

  it("saves manual prompt records as edited and binds them to the input asset", async () => {
    const root = setupPromptRoot();
    writeImage(root, "001.jpg");
    const service = await import("../promptGenerationService.js");
    const { scanInputAssets } = await import("../inputAssetRegistry.js");
    const [asset] = scanInputAssets().assets;
    const record = service.saveManualImagePromptRecord({
      inputAssetId: asset!.inputAssetId,
      role: "secondary",
      promptText: "手动提示词：保持同一只兔子玩偶外观不变，生成 Etsy 副图。",
      negativePrompt: "不要文字、水印、logo",
    });
    expect(record).toMatchObject({
      inputAssetId: asset!.inputAssetId,
      role: "secondary",
      status: "edited",
      source: "gpt55-vision",
    });
    expect(record.promptHash).toBeTruthy();
    expect(service.findBestPromptRecord(asset!.inputAssetId)?.id).toBe(record.id);
  });
});
