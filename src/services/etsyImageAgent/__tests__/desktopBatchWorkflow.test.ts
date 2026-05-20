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
  fs.mkdirSync(path.join(root, "提示词输入"), { recursive: true });
  fs.mkdirSync(path.join(root, "图片输出"), { recursive: true });
  process.env.ETSY_AGENT_DESKTOP_ROOT = root;
  process.env.ETSY_AGENT_STORAGE_PATH = path.join(root, "storage");
  process.env.ETSY_AGENT_CONFIG_PATH = path.join(root, "secure-config.json");
  process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(root, "security.log");
  process.env.IMAGE_AGENT_ENABLE_REAL_GENERATION = "true";
  process.env.OPENAI_API_KEY = "sk-test_abcdefghijklmnopqrstuvwxyz";
  process.env.OPENAI_BASE_URL = "";
  process.env.OPENAI_IMAGE_MODEL = "gpt-image-2";
  process.env.OPENAI_IMAGE_SIZE = "1024x1024";
  process.env.OPENAI_IMAGE_QUALITY = "low";
  process.env.OPENAI_IMAGE_INPUT_FIDELITY = "";
  process.env.OPENAI_IMAGE_MAX_INPUT_MB = "20";
  return root;
}

function writePair(root: string, baseName = "001", prompt = "Keep the same product on a white background."): void {
  fs.writeFileSync(path.join(root, "图片输入", `${baseName}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  fs.writeFileSync(path.join(root, "提示词输入", `${baseName}.txt`), prompt);
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
  it("scans same-name image and prompt pairs while ignoring hidden files", async () => {
    const root = setupDesktopRoot();
    writePair(root, "001");
    fs.writeFileSync(path.join(root, "图片输入", ".DS_Store"), "");
    fs.writeFileSync(path.join(root, "提示词输入", ".DS_Store"), "");
    const { scanDesktopBatchFolders } = await import("../desktopBatchWorkflow.js");
    const scan = scanDesktopBatchFolders();
    expect(scan.pairs).toEqual([expect.objectContaining({
      baseName: "001",
      inputFileName: "001.jpg",
      promptFileName: "001.txt",
      mimeType: "image/jpeg",
    })]);
  });

  it("fails scan before OpenAI when pairs are invalid", async () => {
    let root = setupDesktopRoot();
    fs.writeFileSync(path.join(root, "图片输入", "001.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    let workflow = await import("../desktopBatchWorkflow.js");
    expect(() => workflow.scanDesktopBatchFolders()).toThrow(/PROMPT_FILE_MISSING/);

    vi.resetModules();
    root = setupDesktopRoot();
    fs.writeFileSync(path.join(root, "图片输入", "001.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    fs.writeFileSync(path.join(root, "图片输入", "001.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(root, "提示词输入", "001.txt"), "prompt");
    workflow = await import("../desktopBatchWorkflow.js");
    expect(() => workflow.scanDesktopBatchFolders()).toThrow(/DUPLICATE_INPUT_BASENAME/);

    vi.resetModules();
    root = setupDesktopRoot();
    writePair(root, "001", "   ");
    workflow = await import("../desktopBatchWorkflow.js");
    expect(() => workflow.scanDesktopBatchFolders()).toThrow(/PROMPT_FILE_EMPTY/);
  });

  it("generates one candidate per pair with local OpenAI image edit input and approves to output", async () => {
    const root = setupDesktopRoot();
    writePair(root, "001", "Use the same high heel shoes, white studio background.");
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
      promptFileName: "001.txt",
      reviewStatus: "pending",
      usedReferenceImage: true,
      imageGenerationMode: "product_reference",
      shotType: "hero_white_background",
      model: "gpt-image-2",
      providerTraceId: "req_desktop_batch",
      openaiRequestId: "req_desktop_batch",
    });
    expect(assets[0]?.promptHash).toBeTruthy();
    expect(assets[0]?.providerQuality).toBe("low");

    const approved = workflow.approveDesktopBatchItem(done.items[0]!.itemId);
    const outputPath = path.join(root, "图片输出", "001.png");
    expect(approved.items[0]?.status).toBe("approved");
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(listAssets()).toHaveLength(0);
  });

  it("regenerates a single item by deleting the old candidate and keeping only the newest one", async () => {
    const root = setupDesktopRoot();
    writePair(root, "001");
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
    writePair(root, "001");
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
    writePair(root, "001");
    writePair(root, "002");
    let { editMock } = mockOpenAIEdit();
    let workflow = await import("../desktopBatchWorkflow.js");
    expect(() => workflow.startDesktopBatchGeneration()).toThrow(/OPENAI_COST_RISK_CONFIRMATION_REQUIRED/);
    expect(editMock).not.toHaveBeenCalled();

    vi.resetModules();
    root = setupDesktopRoot();
    process.env.OPENAI_IMAGE_QUALITY = "high";
    writePair(root, "001");
    ({ editMock } = mockOpenAIEdit());
    workflow = await import("../desktopBatchWorkflow.js");
    expect(() => workflow.startDesktopBatchGeneration()).toThrow(/OPENAI_COST_RISK_CONFIRMATION_REQUIRED/);
    expect(editMock).not.toHaveBeenCalled();
  });

  it("does not call OpenAI when an input image exceeds the configured max size", async () => {
    const root = setupDesktopRoot();
    process.env.OPENAI_IMAGE_MAX_INPUT_MB = "0.000001";
    writePair(root, "001");
    const { editMock } = mockOpenAIEdit();
    const workflow = await import("../desktopBatchWorkflow.js");
    workflow.startDesktopBatchGeneration();
    const done = await waitForBatchStatus(["failed"]);
    expect(done.items[0]?.status).toBe("failed");
    expect(done.items[0]?.error).toContain("INPUT_IMAGE_TOO_LARGE");
    expect(editMock).not.toHaveBeenCalled();
  });
});
