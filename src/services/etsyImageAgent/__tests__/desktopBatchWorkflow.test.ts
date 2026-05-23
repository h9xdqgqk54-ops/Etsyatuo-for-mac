import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("openai");
});

function setupDesktopRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-desktop-root-"));
  fs.mkdirSync(path.join(root, "图片输入"), { recursive: true });
  fs.mkdirSync(path.join(root, "图片输出"), { recursive: true });
  process.env.ETSY_AGENT_DESKTOP_ROOT = root;
  process.env.IMAGE_AGENT_INPUT_DIR = path.join(root, "图片输入");
  process.env.IMAGE_AGENT_OUTPUT_DIR = path.join(root, "图片输出");
  process.env.ETSY_AGENT_DATA_PATH = path.join(root, "data");
  process.env.ETSY_AGENT_STORAGE_PATH = path.join(root, "storage");
  process.env.ETSY_AGENT_PROMPT_RECORDS_PATH = path.join(root, "data", "prompt-records.json");
  process.env.ETSY_AGENT_INPUT_ASSETS_PATH = path.join(root, "data", "input-assets.json");
  process.env.ETSY_AGENT_CONFIG_PATH = path.join(root, "data", "secure-config.json");
  process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(root, "data", "security.log");
  process.env.IMAGE_AGENT_ENABLE_REAL_GENERATION = "true";
  process.env.OPENAI_API_KEY = "sk-test_abcdefghijklmnopqrstuvwxyz";
  process.env.OPENAI_BASE_URL = "";
  process.env.OPENAI_IMAGE_MODEL = "gpt-image-2";
  process.env.OPENAI_IMAGE_SIZE = "1024x1024";
  process.env.OPENAI_IMAGE_QUALITY = "low";
  process.env.OPENAI_IMAGE_INPUT_FIDELITY = "";
  process.env.OPENAI_IMAGE_MAX_INPUT_MB = "20";
  process.env.ARK_API_KEY = "fake-ark-key";
  process.env.ARK_BASE_URL = "https://ark.example.test/api/v3";
  process.env.DOUBAO_PROMPT_MODEL = "fake-vision-model";
  process.env.DOUBAO_PROMPT_MAX_INPUT_MB = "5";
  process.env.DOUBAO_PROMPT_BATCH_LIMIT = "10";
  return root;
}

function writeInputImage(root: string, baseName = "001"): void {
  fs.writeFileSync(path.join(root, "图片输入", `${baseName}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
}

async function writePromptRecord(prompt = "Use the same high heel shoes, white studio background.") {
  const { scanInputAssets } = await import("../inputAssetRegistry.js");
  const scan = scanInputAssets();
  const records = scan.assets.map((asset) => ({
    id: `prompt_${asset.inputAssetId.slice(-8)}`,
    inputAssetId: asset.inputAssetId,
    productGroupId: asset.inputAssetId,
    role: "main",
    detectedProduct: "test product",
    promptText: prompt,
    negativePrompt: "no text, no logo",
    source: "doubao-vision",
    status: "approved",
    confidence: 0.9,
    model: "fake-vision-model",
    promptHash: "prompt_hash_test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  fs.mkdirSync(path.dirname(process.env.ETSY_AGENT_PROMPT_RECORDS_PATH!), { recursive: true });
  fs.writeFileSync(process.env.ETSY_AGENT_PROMPT_RECORDS_PATH!, JSON.stringify(records, null, 2));
  return records;
}

function mockOpenAIEdit() {
  const editMock = vi.fn().mockReturnValue({
    withResponse: async () => ({
      data: { data: [{ b64_json: pngBase64 }] },
      request_id: "req_desktop_batch",
      response: new Response(),
    }),
  });
  const toFileMock = vi.fn(async (_stream, filename, options) => ({ filename, options, mockedFile: true }));
  vi.doMock("openai", () => ({
    default: class {
      images = { edit: editMock };
    },
    toFile: toFileMock,
  }));
  return { editMock, toFileMock };
}

interface MockOpenAIImageResponse {
  data: { data: Array<{ b64_json: string }> };
  request_id: string;
  response: Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mockDelayedOpenAIEdit() {
  const calls: Array<ReturnType<typeof deferred<MockOpenAIImageResponse>>> = [];
  const editMock = vi.fn().mockImplementation(() => {
    const call = deferred<MockOpenAIImageResponse>();
    calls.push(call);
    return { withResponse: () => call.promise };
  });
  const toFileMock = vi.fn(async (_stream, filename, options) => ({ filename, options, mockedFile: true }));
  vi.doMock("openai", () => ({
    default: class {
      images = { edit: editMock };
    },
    toFile: toFileMock,
  }));
  return { editMock, toFileMock, calls };
}

async function waitForExpectation(assertion: () => void, timeoutMs = 4_000) {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for expectation");
}

async function waitForBatchStatus(expected: string[], timeoutMs = 4_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { getCurrentDesktopBatch } = await import("../desktopBatchWorkflow.js");
    const batch = getCurrentDesktopBatch();
    if (batch && expected.includes(batch.status)) return batch;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for desktop batch status ${expected.join(", ")}`);
}

describe("desktop batch workflow", () => {
  it("scans input images without exposing a prompt input folder", async () => {
    const root = setupDesktopRoot();
    writeInputImage(root, "001");
    fs.writeFileSync(path.join(root, "图片输入", ".DS_Store"), "");
    await writePromptRecord();
    const { scanDesktopBatchFolders } = await import("../desktopBatchWorkflow.js");
    const scan = scanDesktopBatchFolders();
    expect(scan).toMatchObject({
      inputDir: path.join(root, "图片输入"),
      outputDir: path.join(root, "图片输出"),
    });
    expect(scan).not.toHaveProperty("promptDir");
    expect(scan.assets).toEqual([expect.objectContaining({
      baseName: "001",
      fileName: "001.jpg",
      mimeType: "image/jpeg",
    })]);
    expect(scan.pairs).toEqual([expect.objectContaining({
      baseName: "001",
      inputFileName: "001.jpg",
      mimeType: "image/jpeg",
      promptRecordId: expect.any(String),
    })]);
  });

  it("fails before OpenAI when input dir or prompt records are missing", async () => {
    let root = setupDesktopRoot();
    process.env.IMAGE_AGENT_INPUT_DIR = path.join(root, "missing-input");
    let workflow = await import("../desktopBatchWorkflow.js");
    expect(() => workflow.scanDesktopBatchFolders()).toThrow(/INPUT_DIR_NOT_FOUND/);

    vi.resetModules();
    root = setupDesktopRoot();
    writeInputImage(root, "001");
    const { editMock } = mockOpenAIEdit();
    workflow = await import("../desktopBatchWorkflow.js");
    expect(() => workflow.startDesktopBatchGeneration()).toThrow(/PROMPT_REQUIRED/);
    expect(editMock).not.toHaveBeenCalled();
  });

  it("generates one candidate per pair with local OpenAI image edit input and approves to output", async () => {
    const root = setupDesktopRoot();
    writeInputImage(root, "001");
    const promptRecords = await writePromptRecord("Use the same high heel shoes, white studio background.");
    const { editMock, toFileMock } = mockOpenAIEdit();
    const workflow = await import("../desktopBatchWorkflow.js");
    const batch = workflow.startDesktopBatchGeneration();
    expect(batch.totalItems).toBe(1);
    const done = await waitForBatchStatus(["reviewing", "failed"]);
    expect(done.status).toBe("reviewing");
    expect(editMock).toHaveBeenCalledTimes(1);
    expect(toFileMock).toHaveBeenCalledWith(expect.anything(), "001.jpg", { type: "image/jpeg" });
    expect(editMock.mock.calls[0]?.[0]).toMatchObject({
      model: "gpt-image-2",
      prompt: expect.stringContaining("Use the same high heel shoes, white studio background."),
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

    const { listAssets } = await import("../assetLibrary.js");
    const assets = listAssets();
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      provider: "openai",
      batchId: done.batchId,
      itemId: done.items[0]?.itemId,
      baseName: "001",
      inputFileName: "001.jpg",
      reviewStatus: "pending",
      usedReferenceImage: true,
      imageGenerationMode: "product_reference",
      shotType: "hero_white_background",
      model: "gpt-image-2",
      providerTraceId: "req_desktop_batch",
      openaiRequestId: "req_desktop_batch",
      promptRecordId: promptRecords[0]?.id,
      promptTextSnapshot: "Use the same high heel shoes, white studio background.",
      negativePromptSnapshot: "no text, no logo",
      promptStatusAtGeneration: "approved",
      inputAssetId: promptRecords[0]?.inputAssetId,
    });
    expect(assets[0]?.promptHash).toBeTruthy();
    expect(assets[0]?.providerQuality).toBe("low");

    expect(assets[0]?.optimizedPrompt).toContain("Use the uploaded reference image as the source image.");

    const approved = await workflow.approveDesktopBatchItem(done.items[0]!.itemId);
    const outputPath = path.join(root, "图片输出", "001.png");
    expect(approved.items[0]?.status).toBe("approved");
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(listAssets()).toHaveLength(0);
  });

  it("approves one prompt and generates only that image", async () => {
    const root = setupDesktopRoot();
    writeInputImage(root, "001");
    const promptRecords = await writePromptRecord("Use the same plush toy, warm vintage product photo.");
    const { editMock } = mockOpenAIEdit();
    const workflow = await import("../desktopBatchWorkflow.js");

    const batch = workflow.approvePromptAndGenerateImage(promptRecords[0]!.id);
    expect(batch.totalItems).toBe(1);
    expect(batch.items[0]).toMatchObject({
      inputAssetId: promptRecords[0]!.inputAssetId,
      promptRecordId: promptRecords[0]!.id,
      promptTextSnapshot: "Use the same plush toy, warm vintage product photo.",
      promptStatusAtGeneration: "approved",
      status: "running",
    });

    const done = await waitForBatchStatus(["reviewing", "failed"]);
    expect(done.status).toBe("reviewing");
    expect(editMock).toHaveBeenCalledTimes(1);
    expect(done.items[0]?.status).toBe("generated");
    expect(done.items[0]?.promptRecordId).toBe(promptRecords[0]!.id);
  });

  it("does not duplicate OpenAI calls for the same approved prompt candidate", async () => {
    const root = setupDesktopRoot();
    writeInputImage(root, "001");
    const promptRecords = await writePromptRecord("Use the same plush toy, white background.");
    const { editMock, calls } = mockDelayedOpenAIEdit();
    const workflow = await import("../desktopBatchWorkflow.js");

    workflow.approvePromptAndGenerateImage(promptRecords[0]!.id);
    const second = workflow.approvePromptAndGenerateImage(promptRecords[0]!.id);

    await waitForExpectation(() => expect(editMock).toHaveBeenCalledTimes(1));
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.status).toBe("running");
    calls[0]!.resolve({
      data: { data: [{ b64_json: pngBase64 }] },
      request_id: "req_dedup",
      response: new Response(),
    });
    const done = await waitForBatchStatus(["reviewing", "failed"]);
    expect(done.items[0]?.status).toBe("generated");
  });

  it("starts approved prompt image generations concurrently", async () => {
    const root = setupDesktopRoot();
    writeInputImage(root, "001");
    writeInputImage(root, "002");
    writeInputImage(root, "003");
    const promptRecords = await writePromptRecord("Use the same plush toy, curated product photo.");
    const { editMock, toFileMock, calls } = mockDelayedOpenAIEdit();
    const workflow = await import("../desktopBatchWorkflow.js");

    const first = workflow.approvePromptAndGenerateImage(promptRecords[0]!.id);
    const second = workflow.approvePromptAndGenerateImage(promptRecords[1]!.id);
    const third = workflow.approvePromptAndGenerateImage(promptRecords[2]!.id);

    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(2);
    expect(third.items).toHaveLength(3);
    expect(workflow.getCurrentDesktopBatch()?.items.filter((item) => item.status === "running")).toHaveLength(3);
    await waitForExpectation(() => expect(toFileMock).toHaveBeenCalledTimes(3));
    await waitForExpectation(() => expect(editMock).toHaveBeenCalledTimes(3));
    const running = workflow.getCurrentDesktopBatch();
    expect(running?.items.filter((item) => item.status === "running")).toHaveLength(3);

    for (let index = 0; index < calls.length; index += 1) {
      calls[index]!.resolve({
        data: { data: [{ b64_json: pngBase64 }] },
        request_id: `req_parallel_${index}`,
        response: new Response(),
      });
    }

    const done = await waitForBatchStatus(["reviewing", "failed"]);
    const { listAssets } = await import("../assetLibrary.js");

    expect(done.status).toBe("reviewing");
    expect(done.items).toHaveLength(3);
    expect(done.items.map((item) => item.promptRecordId).sort()).toEqual(promptRecords.map((record) => record.id).sort());
    expect(editMock).toHaveBeenCalledTimes(3);
    expect(listAssets()).toHaveLength(3);
  });

  it("keeps other concurrent image generations running when one item fails", async () => {
    const root = setupDesktopRoot();
    writeInputImage(root, "001");
    writeInputImage(root, "002");
    const promptRecords = await writePromptRecord("Use the same plush toy, curated product photo.");
    const { editMock, calls } = mockDelayedOpenAIEdit();
    const workflow = await import("../desktopBatchWorkflow.js");

    workflow.approvePromptAndGenerateImage(promptRecords[0]!.id);
    workflow.approvePromptAndGenerateImage(promptRecords[1]!.id);
    await waitForExpectation(() => expect(editMock).toHaveBeenCalledTimes(2));

    calls[0]!.reject(new Error("provider temporary failure"));
    calls[1]!.resolve({
      data: { data: [{ b64_json: pngBase64 }] },
      request_id: "req_other_success",
      response: new Response(),
    });

    const done = await waitForExpectation(() => {
      const batch = workflow.getCurrentDesktopBatch();
      expect(batch?.items.some((item) => item.status === "failed")).toBe(true);
      expect(batch?.items.some((item) => item.status === "generated")).toBe(true);
    }).then(() => workflow.getCurrentDesktopBatch());

    expect(done?.items.filter((item) => item.status === "failed")).toHaveLength(1);
    expect(done?.items.filter((item) => item.status === "generated")).toHaveLength(1);
  });

  it("regenerates a single item by deleting the old candidate and keeping only the newest one", async () => {
    const root = setupDesktopRoot();
    writeInputImage(root, "001");
    await writePromptRecord();
    const { editMock } = mockOpenAIEdit();
    const workflow = await import("../desktopBatchWorkflow.js");
    workflow.startDesktopBatchGeneration();
    let done = await waitForBatchStatus(["reviewing", "failed"]);
    const { listAssets } = await import("../assetLibrary.js");
    const firstAsset = listAssets()[0]!;
    const firstPath = firstAsset.generatedFilePath;

    workflow.regenerateDesktopBatchItem(done.items[0]!.itemId);
    done = await waitForBatchStatus(["reviewing", "failed"]);
    const assets = listAssets();
    expect(done.status).toBe("reviewing");
    expect(editMock).toHaveBeenCalledTimes(2);
    expect(assets).toHaveLength(1);
    expect(assets[0]?.assetId).not.toBe(firstAsset.assetId);
    expect(fs.existsSync(firstPath)).toBe(false);
  });

  it("cleans pending candidates without deleting approved output files", async () => {
    const root = setupDesktopRoot();
    writeInputImage(root, "001");
    await writePromptRecord();
    mockOpenAIEdit();
    const workflow = await import("../desktopBatchWorkflow.js");
    workflow.startDesktopBatchGeneration();
    await waitForBatchStatus(["reviewing", "failed"]);
    const keepOutputPath = path.join(root, "图片输出", "keep.png");
    fs.writeFileSync(keepOutputPath, "approved output");
    const { listAssets } = await import("../assetLibrary.js");
    expect(listAssets()).toHaveLength(1);
    const result = workflow.cleanupPendingDesktopCandidates();
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(listAssets()).toHaveLength(0);
    expect(fs.existsSync(keepOutputPath)).toBe(true);
  });

  it("requires explicit cost confirmation for multi-image or non-low quality batches", async () => {
    let root = setupDesktopRoot();
    writeInputImage(root, "001");
    writeInputImage(root, "002");
    await writePromptRecord();
    let { editMock } = mockOpenAIEdit();
    let workflow = await import("../desktopBatchWorkflow.js");
    expect(() => workflow.startDesktopBatchGeneration()).toThrow(/OPENAI_COST_RISK_CONFIRMATION_REQUIRED/);
    expect(editMock).not.toHaveBeenCalled();

    vi.resetModules();
    root = setupDesktopRoot();
    process.env.OPENAI_IMAGE_QUALITY = "high";
    writeInputImage(root, "001");
    await writePromptRecord();
    ({ editMock } = mockOpenAIEdit());
    workflow = await import("../desktopBatchWorkflow.js");
    expect(() => workflow.startDesktopBatchGeneration()).toThrow(/OPENAI_COST_RISK_CONFIRMATION_REQUIRED/);
    expect(editMock).not.toHaveBeenCalled();
  });

  it("does not call OpenAI when an input image exceeds the configured max size", async () => {
    const root = setupDesktopRoot();
    process.env.OPENAI_IMAGE_MAX_INPUT_MB = "0.000001";
    writeInputImage(root, "001");
    await writePromptRecord();
    const { editMock } = mockOpenAIEdit();
    const workflow = await import("../desktopBatchWorkflow.js");
    workflow.startDesktopBatchGeneration();
    const done = await waitForBatchStatus(["failed"]);
    expect(done.items[0]?.status).toBe("failed");
    expect(done.items[0]?.error).toContain("INPUT_IMAGE_TOO_LARGE");
    expect(editMock).not.toHaveBeenCalled();
  });

  it("serializes legacy batch items even when prompt snapshots are missing", async () => {
    const root = setupDesktopRoot();
    const metadataDir = path.join(root, "storage", "metadata");
    fs.mkdirSync(metadataDir, { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(metadataDir, "desktop-batches.json"), JSON.stringify([{
      batchId: "batch_legacy",
      status: "failed",
      createdAt: now,
      updatedAt: now,
      inputDir: path.join(root, "图片输入"),
      outputDir: path.join(root, "图片输出"),
      totalItems: 1,
      generatedItems: 0,
      approvedItems: 0,
      failedItems: 1,
      model: "gpt-image-2",
      size: "1024x1024",
      quality: "low",
      items: [{
        itemId: "item_legacy",
        batchId: "batch_legacy",
        baseName: "001",
        inputAssetId: "input_legacy",
        inputFileName: "001.jpg",
        inputPath: path.join(root, "图片输入", "001.jpg"),
        mimeType: "image/jpeg",
        promptRecordId: "prompt_legacy",
        negativePromptSnapshot: "",
        promptStatusAtGeneration: "generated",
        status: "failed",
        error: "legacy error",
        attempts: 1,
        createdAt: now,
        updatedAt: now,
      }],
    }], null, 2));
    const workflow = await import("../desktopBatchWorkflow.js");
    const batch = workflow.getCurrentDesktopBatch();
    expect(batch).not.toHaveProperty("promptDir");
    expect(batch?.items[0]?.promptTextSnapshot).toBe("");
    expect(batch?.items[0]?.promptPreview).toBe("");
  });
});
