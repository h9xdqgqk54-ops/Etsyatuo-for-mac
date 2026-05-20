import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

beforeEach(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-provider-test-"));
  process.env.ETSY_AGENT_CONFIG_PATH = path.join(tmp, "secure-config.json");
  process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(tmp, "security.log");
  process.env.OPENAI_IMAGE_MODEL = "gpt-image-2";
  process.env.OPENAI_BASE_URL = "";
  process.env.OPENAI_IMAGE_SIZE = "1024x1024";
  process.env.OPENAI_IMAGE_QUALITY = "low";
  process.env.OPENAI_IMAGE_INPUT_FIDELITY = "";
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock("openai");
});

function openAIGroup(tmp: string, overrides: Partial<import("../types.js").UploadedImage> = {}) {
  const filePath = path.join(tmp, "reference.jpg");
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return {
    id: "g-openai",
    displayName: "high heel shoes",
    confidence: 1,
    confidenceLabel: "high" as const,
    reason: "test",
    originalFileNames: ["reference.jpg"],
    images: [{
      id: "img-openai",
      originalFileName: "reference.jpg",
      relativePath: "reference.jpg",
      storedPath: filePath,
      publicUrl: "/media/etsy-agent/originals/reference.jpg",
      mimeType: "image/jpeg",
      sizeBytes: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
      hash: "hash",
      perceptualKey: "perceptual",
      createdAt: new Date(0).toISOString(),
      ...overrides,
    }],
  };
}

async function registerOpenAIGroup(tmp: string, group: ReturnType<typeof openAIGroup>) {
  process.env.ETSY_AGENT_STORAGE_PATH = tmp;
  process.env.ETSY_AGENT_CONFIG_PATH = path.join(tmp, "secure-config.json");
  process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(tmp, "security.log");
  const { saveTask } = await import("../assetLibrary.js");
  saveTask({
    taskId: "task-openai-register",
    status: "queued",
    progress: 0,
    currentStep: "test",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    userPrompt: "test",
    templateId: "etsy-white-main",
    perProductImageCount: 1,
    totalProducts: 1,
    totalPlannedImages: 1,
    completedImages: 0,
    failedImages: 0,
    model: "gpt-image-2",
    imageGenerationMode: "product_reference",
    products: [],
    jobs: [],
    groups: [group],
    cost: { productCount: 1, referenceImageCount: 1, requestedImagesPerProduct: 1, plannedGeneratedImages: 1, estimatedOpenAICalls: 1, maxConcurrentGenerations: 1, note: "test" },
    events: [],
  });
}

function providerSettings(overrides: Partial<import("../imageProviders/types.js").ImageProviderSettings> = {}) {
  return {
    provider: "openai" as const,
    mode: "real" as const,
    apiKey: "sk-test_abcdefghijklmnopqrstuvwxyz",
    configured: true,
    enableRealGeneration: true,
    keyFingerprint: "fingerprint",
    model: "gpt-image-2",
    imageSize: "1024x1024",
    imageQuality: "low",
    ...overrides,
  };
}

describe("OpenAI image provider", () => {
  it("always selects OpenAI and exposes only OpenAI provider settings", async () => {
    process.env.IMAGE_AGENT_PROVIDER = "legacy-provider";
    process.env.IMAGE_AGENT_MOCK_MODE = "true";
    process.env.OPENAI_API_KEY = "sk-test_abcdefghijklmnopqrstuvwxyz";
    process.env.OPENAI_BASE_URL = "https://relay.example.test/v1/";
    const secure = await import("../secureConfig.js");
    const registry = await import("../imageProviders/registry.js");
    const config = secure.getImageProviderConfig();
    expect(config.selectedProvider).toBe("openai");
    expect(config.providers.openai.required).toBe(true);
    expect(config.providers.openai.configured).toBe(true);
    expect(config.providers.openai.baseURL).toBe("https://relay.example.test/v1");
    expect(config.providers.openai.baseURLSource).toBe("env");
    expect(config.providers.openai.inputFidelity).toBe("off");
    expect(config.providers.openai.inputFidelitySource).toBe("default");
    expect(config.mockMode).toBe(false);
    expect(config.diagnostics).not.toContain("OPENAI_API_KEY_MISSING");
    expect(JSON.stringify(config)).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(registry.listImageProviders()).toEqual(["openai"]);
    expect(registry.getCurrentImageProviderSettings()).toMatchObject({
      provider: "openai",
      model: "gpt-image-2",
      baseURL: "https://relay.example.test/v1",
      imageSize: "1024x1024",
      imageQuality: "low",
      inputFidelity: "off",
    });
  });

  it("reports OpenAI missing key without requiring any other provider", async () => {
    process.env.OPENAI_API_KEY = "";
    const { getImageProviderConfig } = await import("../secureConfig.js");
    const config = getImageProviderConfig();
    expect(config.selectedProvider).toBe("openai");
    expect(config.providers.openai.required).toBe(true);
    expect(config.providers.openai.configured).toBe(false);
    expect(config.diagnostics).toEqual(["OPENAI_API_KEY_MISSING"]);
  });

  it("edits a registered local input asset without public URL", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-openai-local-"));
    const group = openAIGroup(tmp);
    await registerOpenAIGroup(tmp, group);
    const editMock = vi.fn().mockReturnValue({
      withResponse: async () => ({
        data: { data: [{ b64_json: pngBase64 }] },
        request_id: "req_openai_test",
        response: new Response(),
      }),
    });
    const generateMock = vi.fn();
    const openAIConstructorMock = vi.fn();
    const toFileMock = vi.fn(async (_stream, filename, options) => ({ filename, options, mockedFile: true }));
    vi.doMock("openai", () => ({
      default: class {
        constructor(options: unknown) { openAIConstructorMock(options); }
        images = { edit: editMock, generate: generateMock };
      },
      toFile: toFileMock,
    }));
    const { buildOpenAIImageEditRequest, openaiProvider } = await import("../imageProviders/openaiProvider.js");
    await expect(buildOpenAIImageEditRequest({
      model: "gpt-image-2",
      image: { mockedFile: true },
      prompt: "same product",
      size: "1024x1024",
      quality: "low",
    })).resolves.toMatchObject({
      model: "gpt-image-2",
      prompt: "same product",
      size: "1024x1024",
      quality: "low",
      output_format: "png",
      background: "opaque",
      n: 1,
    });
    const defaultRequest = await buildOpenAIImageEditRequest({
      model: "gpt-image-2",
      image: { mockedFile: true },
      prompt: "same product",
      size: "1024x1024",
      quality: "low",
    });
    expect(defaultRequest).not.toHaveProperty("stream");
    expect(defaultRequest).not.toHaveProperty("partial_images");
    expect(defaultRequest).not.toHaveProperty("response_format");
    expect(defaultRequest).not.toHaveProperty("input_fidelity");
    const outputPath = path.join(tmp, "out.png");
    const result = await openaiProvider.generate({
      outputPath,
      imageGenerationMode: "product_reference",
      inputAssetIds: ["img-openai"],
      preserveProduct: true,
      group,
      prompt: { optimizedPrompt: "same product on a white background" },
    }, providerSettings({ baseURL: "https://relay.example.test/v1" }));
    expect(openAIConstructorMock).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://relay.example.test/v1", timeout: 300_000, maxRetries: 2 }));
    expect(editMock).toHaveBeenCalledTimes(1);
    expect(generateMock).not.toHaveBeenCalled();
    expect(toFileMock).toHaveBeenCalledWith(expect.anything(), "reference.jpg", { type: "image/jpeg" });
    expect(editMock.mock.calls[0]?.[0]).toMatchObject({
      model: "gpt-image-2",
      prompt: "same product on a white background",
      size: "1024x1024",
      quality: "low",
      output_format: "png",
      background: "opaque",
      n: 1,
    });
    expect(editMock.mock.calls[0]?.[0]).not.toHaveProperty("stream");
    expect(editMock.mock.calls[0]?.[0]).not.toHaveProperty("partial_images");
    expect(editMock.mock.calls[0]?.[0]).not.toHaveProperty("response_format");
    expect(editMock.mock.calls[0]?.[0]).not.toHaveProperty("input_fidelity");
    expect(result.usedReferenceImage).toBe(true);
    expect(result.referenceImageCount).toBe(1);
    expect(result.openaiRequestId).toBe("req_openai_test");
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it("passes OpenAI input_fidelity only when explicitly configured", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-openai-fidelity-"));
    const inputPath = path.join(tmp, "reference.jpg");
    fs.writeFileSync(inputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const editMock = vi.fn().mockReturnValue({
      withResponse: async () => ({
        data: { data: [{ b64_json: pngBase64 }] },
        request_id: "req_fidelity",
        response: new Response(),
      }),
    });
    vi.doMock("openai", () => ({
      default: class {
        images = { edit: editMock };
      },
      toFile: vi.fn(async (_stream, filename, options) => ({ filename, options, mockedFile: true })),
    }));
    const { generateOpenAIImageEditFromFile } = await import("../imageProviders/openaiProvider.js");
    await generateOpenAIImageEditFromFile({
      inputPath,
      mimeType: "image/jpeg",
      prompt: "same product",
      outputPath: path.join(tmp, "high.png"),
      settings: providerSettings({ inputFidelity: "high" }),
      requireRegisteredMediaPath: false,
    });
    await generateOpenAIImageEditFromFile({
      inputPath,
      mimeType: "image/jpeg",
      prompt: "same product",
      outputPath: path.join(tmp, "low.png"),
      settings: providerSettings({ inputFidelity: "low" }),
      requireRegisteredMediaPath: false,
    });
    expect(editMock.mock.calls[0]?.[0]).toMatchObject({ input_fidelity: "high" });
    expect(editMock.mock.calls[1]?.[0]).toMatchObject({ input_fidelity: "low" });
    expect(editMock.mock.calls[0]?.[0]).not.toHaveProperty("stream");
    expect(editMock.mock.calls[1]?.[0]).not.toHaveProperty("partial_images");
  });

  it("accepts OpenAI URL and relay-wrapped base64 image responses", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-openai-response-"));
    const inputPath = path.join(tmp, "reference.jpg");
    fs.writeFileSync(inputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const pngBytes = Buffer.from(pngBase64, "base64");
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(pngBytes);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const imageUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/out.png`;
    const editMock = vi.fn()
      .mockReturnValueOnce({
        withResponse: async () => ({
          data: { data: [{ url: imageUrl }] },
          request_id: "req_url",
          response: new Response(),
        }),
      })
      .mockReturnValueOnce({
        withResponse: async () => ({
          data: { output: [{ image_base64: pngBase64 }] },
          request_id: "req_relay",
          response: new Response(),
        }),
      });
    vi.doMock("openai", () => ({
      default: class { images = { edit: editMock }; },
      toFile: vi.fn(async (_stream, filename, options) => ({ filename, options, mockedFile: true })),
    }));
    const { generateOpenAIImageEditFromFile } = await import("../imageProviders/openaiProvider.js");
    try {
      const urlResult = await generateOpenAIImageEditFromFile({
        inputPath,
        mimeType: "image/jpeg",
        prompt: "same product",
        outputPath: path.join(tmp, "url.png"),
        settings: providerSettings(),
        requireRegisteredMediaPath: false,
      });
      const relayResult = await generateOpenAIImageEditFromFile({
        inputPath,
        mimeType: "image/jpeg",
        prompt: "same product",
        outputPath: path.join(tmp, "relay.png"),
        settings: providerSettings(),
        requireRegisteredMediaPath: false,
      });
      expect(urlResult.openaiRequestId).toBe("req_url");
      expect(relayResult.openaiRequestId).toBe("req_relay");
      expect(fs.existsSync(path.join(tmp, "url.png"))).toBe(true);
      expect(fs.existsSync(path.join(tmp, "relay.png"))).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns structured errors for empty, invalid, and failed URL image responses", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-openai-bad-response-"));
    const inputPath = path.join(tmp, "reference.jpg");
    fs.writeFileSync(inputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const editMock = vi.fn()
      .mockReturnValueOnce({ withResponse: async () => ({ data: { data: [] }, request_id: "req_empty", response: new Response() }) })
      .mockReturnValueOnce({ withResponse: async () => ({ data: { data: [{ b64_json: Buffer.from("not an image").toString("base64") }] }, request_id: "req_invalid", response: new Response() }) })
      .mockReturnValueOnce({ withResponse: async () => ({ data: { data: [{ url: "https://images.example.test/missing.png" }] }, request_id: "req_download", response: new Response() }) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404, headers: { "content-type": "text/plain" } })));
    vi.doMock("openai", () => ({
      default: class { images = { edit: editMock }; },
      toFile: vi.fn(async (_stream, filename, options) => ({ filename, options, mockedFile: true })),
    }));
    const { generateOpenAIImageEditFromFile } = await import("../imageProviders/openaiProvider.js");
    const baseInput = {
      inputPath,
      mimeType: "image/jpeg",
      prompt: "same product",
      settings: providerSettings(),
      requireRegisteredMediaPath: false,
    };
    await expect(generateOpenAIImageEditFromFile({ ...baseInput, outputPath: path.join(tmp, "empty.png") })).rejects.toMatchObject({ code: "OPENAI_IMAGE_EMPTY_RESPONSE", requestId: "req_empty" });
    await expect(generateOpenAIImageEditFromFile({ ...baseInput, outputPath: path.join(tmp, "invalid.png") })).rejects.toMatchObject({ code: "OPENAI_IMAGE_INVALID_RESPONSE_IMAGE", requestId: "req_invalid" });
    await expect(generateOpenAIImageEditFromFile({ ...baseInput, outputPath: path.join(tmp, "download.png") })).rejects.toMatchObject({ code: "OPENAI_IMAGE_DOWNLOAD_FAILED", requestId: "req_download" });
    expect(fs.existsSync(path.join(tmp, "empty.png"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "invalid.png"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "download.png"))).toBe(false);
  });

  it("rejects missing, multiple, unregistered, missing-file, oversized, and unsupported inputs", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-openai-guards-"));
    process.env.OPENAI_IMAGE_MAX_INPUT_MB = "1";
    let group = openAIGroup(tmp);
    await registerOpenAIGroup(tmp, group);
    let mod = await import("../imageProviders/openaiProvider.js");
    await expect(mod.openaiProvider.generate({ outputPath: path.join(tmp, "a.png"), imageGenerationMode: "product_reference", group, prompt: { optimizedPrompt: "x" } }, providerSettings())).rejects.toMatchObject({ code: "INPUT_REFERENCE_IMAGE_REQUIRED" });
    await expect(mod.openaiProvider.generate({ outputPath: path.join(tmp, "b.png"), imageGenerationMode: "product_reference", inputAssetIds: ["img-openai", "img-2"], group, prompt: { optimizedPrompt: "x" } }, providerSettings())).rejects.toMatchObject({ code: "OPENAI_MULTI_REFERENCE_NOT_SUPPORTED_YET" });

    group = openAIGroup(tmp, { storedPath: path.join(tmp, "not-registered.jpg") });
    fs.writeFileSync(group.images[0]!.storedPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await expect(mod.openaiProvider.generate({ outputPath: path.join(tmp, "c.png"), imageGenerationMode: "product_reference", inputAssetIds: ["img-openai"], group, prompt: { optimizedPrompt: "x" } }, providerSettings())).rejects.toMatchObject({ code: "INPUT_ASSET_NOT_REGISTERED" });

    vi.resetModules();
    process.env.OPENAI_IMAGE_MAX_INPUT_MB = "1";
    const missingPath = path.join(tmp, "missing.jpg");
    group = openAIGroup(tmp, { storedPath: missingPath });
    await registerOpenAIGroup(tmp, group);
    mod = await import("../imageProviders/openaiProvider.js");
    await expect(mod.openaiProvider.generate({ outputPath: path.join(tmp, "d.png"), imageGenerationMode: "product_reference", inputAssetIds: ["img-openai"], group, prompt: { optimizedPrompt: "x" } }, providerSettings())).rejects.toMatchObject({ code: "INPUT_ASSET_FILE_NOT_FOUND" });

    vi.resetModules();
    process.env.OPENAI_IMAGE_MAX_INPUT_MB = "0.000001";
    group = openAIGroup(tmp);
    await registerOpenAIGroup(tmp, group);
    mod = await import("../imageProviders/openaiProvider.js");
    await expect(mod.openaiProvider.generate({ outputPath: path.join(tmp, "e.png"), imageGenerationMode: "product_reference", inputAssetIds: ["img-openai"], group, prompt: { optimizedPrompt: "x" } }, providerSettings())).rejects.toMatchObject({ code: "INPUT_IMAGE_TOO_LARGE" });

    vi.resetModules();
    process.env.OPENAI_IMAGE_MAX_INPUT_MB = "1";
    group = openAIGroup(tmp, { mimeType: "image/gif" });
    await registerOpenAIGroup(tmp, group);
    mod = await import("../imageProviders/openaiProvider.js");
    await expect(mod.openaiProvider.generate({ outputPath: path.join(tmp, "f.png"), imageGenerationMode: "product_reference", inputAssetIds: ["img-openai"], group, prompt: { optimizedPrompt: "x" } }, providerSettings())).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT_IMAGE_TYPE" });
  });

  it("maps OpenAI image edit failures to structured errors without fallback", async () => {
    const cases = [
      [{ status: 400, message: "The model 'gpt-image-2' does not support the 'input_fidelity' parameter." }, "OPENAI_IMAGE_PARAMETER_UNSUPPORTED"],
      [{ status: 404, message: "model not found" }, "OPENAI_IMAGE_MODEL_UNAVAILABLE"],
      [{ status: 403, message: "organization verification required" }, "OPENAI_ORG_VERIFICATION_REQUIRED"],
      [{ status: 429, code: "insufficient_quota", message: "insufficient quota" }, "OPENAI_INSUFFICIENT_QUOTA"],
      [{ status: 429, message: "rate limit" }, "OPENAI_RATE_LIMITED"],
      [{ status: 500, message: "server exploded" }, "OPENAI_IMAGE_EDIT_FAILED"],
    ] as const;
    for (const [error, code] of cases) {
      vi.resetModules();
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-openai-error-"));
      const group = openAIGroup(tmp);
      await registerOpenAIGroup(tmp, group);
      const editMock = vi.fn().mockReturnValue({ withResponse: async () => { throw error; } });
      const generateMock = vi.fn();
      vi.doMock("openai", () => ({
        default: class { images = { edit: editMock, generate: generateMock }; },
        toFile: vi.fn(async () => ({ mockedFile: true })),
      }));
      const { openaiProvider } = await import("../imageProviders/openaiProvider.js");
      await expect(openaiProvider.generate({
        outputPath: path.join(tmp, "out.png"),
        imageGenerationMode: "product_reference",
        inputAssetIds: ["img-openai"],
        group,
        prompt: { optimizedPrompt: "same product" },
      }, providerSettings())).rejects.toMatchObject({ code });
      expect(generateMock).not.toHaveBeenCalled();
    }
  });
});
