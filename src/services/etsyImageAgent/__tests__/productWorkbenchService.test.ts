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
});

function setupWorkbenchRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-workbench-root-"));
  process.env.ETSY_AGENT_DATA_PATH = path.join(root, "data");
  process.env.ETSY_AGENT_STORAGE_PATH = path.join(root, "storage");
  process.env.IMAGE_AGENT_INPUT_DIR = path.join(root, "图片输入");
  process.env.IMAGE_AGENT_OUTPUT_DIR = path.join(root, "图片输出");
  process.env.GPT55_API_KEY = "fake-gpt55-key";
  process.env.GPT55_BASE_URL = "https://gpt55.example.test/v1";
  process.env.GPT55_MODEL = "gpt-5.5";
  process.env.GPT55_MAX_INPUT_MB = "5";
  fs.mkdirSync(process.env.IMAGE_AGENT_INPUT_DIR, { recursive: true });
  fs.mkdirSync(process.env.IMAGE_AGENT_OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(root, "storage", "metadata"), { recursive: true });
  return root;
}

function writeDesktopBatch(root: string): string {
  const now = new Date().toISOString();
  const inputDir = path.join(root, "图片输入");
  const outputDir = path.join(root, "图片输出");
  const batchId = "batch_workbench";
  const rows = [
    { itemId: "item_1", inputFileName: "pink-bunny.png", outputFileName: "rabbit-pink.png", status: "approved" },
    { itemId: "item_2", inputFileName: "gray-bunny.png", outputFileName: "rabbit-gray.png", status: "approved" },
    { itemId: "item_3", inputFileName: "generated-only.png", outputFileName: undefined, status: "generated" },
  ];
  for (const row of rows) {
    fs.writeFileSync(path.join(inputDir, row.inputFileName), "input");
    if (row.outputFileName) fs.writeFileSync(path.join(outputDir, row.outputFileName), Buffer.from(pngBase64, "base64"));
  }
  const items = rows.map((row, index) => ({
    itemId: row.itemId,
    batchId,
    baseName: path.parse(row.inputFileName).name,
    inputAssetId: `input_${index + 1}`,
    inputFileName: row.inputFileName,
    inputPath: path.join(inputDir, row.inputFileName),
    mimeType: "image/png",
    promptRecordId: `prompt_${index + 1}`,
    promptTextSnapshot: "same product prompt",
    negativePromptSnapshot: "no text",
    promptStatusAtGeneration: "approved",
    status: row.status,
    outputFileName: row.outputFileName,
    outputFilePath: row.outputFileName ? path.join(outputDir, row.outputFileName) : undefined,
    attempts: 1,
    createdAt: now,
    updatedAt: now,
    approvedAt: row.status === "approved" ? now : undefined,
  }));
  fs.writeFileSync(path.join(root, "storage", "metadata", "desktop-batches.json"), JSON.stringify([{
    batchId,
    status: "approved",
    createdAt: now,
    updatedAt: now,
    inputDir,
    outputDir,
    totalItems: items.length,
    generatedItems: 1,
    approvedItems: 2,
    failedItems: 0,
    model: "gpt-image-2",
    size: "1024x1024",
    quality: "low",
    items,
  }], null, 2));
  return batchId;
}

describe("product workbench service", () => {
  it("initializes image metadata for approved output images without price rows", async () => {
    const root = setupWorkbenchRoot();
    const batchId = writeDesktopBatch(root);
    const service = await import("../productWorkbenchService.js");

    const record = service.getProductWorkbench(batchId);

    expect(record.batchId).toBe(batchId);
    expect(record.imageMetas.map((item) => item.itemId)).toEqual(["item_1", "item_2"]);
    expect(record).not.toHaveProperty("priceRows");
    expect(record.imageMetas[0]).toMatchObject({
      itemId: "item_1",
      inputFileName: "pink-bunny.png",
      outputFileName: "rabbit-pink.png",
      color: "",
      size: "",
      material: "",
      note: "",
    });
  });

  it("saves manual image metadata", async () => {
    const root = setupWorkbenchRoot();
    const batchId = writeDesktopBatch(root);
    const service = await import("../productWorkbenchService.js");

    const updated = service.updateProductWorkbenchImageMetas(batchId, [{
      itemId: "item_1",
      color: "pink floral",
      size: "18 cm",
      material: "soft plush",
      note: "main listing image",
    }]);

    expect(updated).not.toHaveProperty("priceRows");
    expect(updated.imageMetas[0]).toMatchObject({
      color: "pink floral",
      size: "18 cm",
      material: "soft plush",
      note: "main listing image",
      source: "manual",
    });
  });

  it("saves manual style names and rejects names over 20 characters", async () => {
    const root = setupWorkbenchRoot();
    const batchId = writeDesktopBatch(root);
    const service = await import("../productWorkbenchService.js");

    const updated = service.updateProductWorkbenchStyleNames(batchId, [{
      itemId: "item_1",
      styleNameEn: "Pink Floral Bunny",
    }]);

    expect(updated.imageMetas[0]).toMatchObject({
      styleNameEn: "Pink Floral Bunny",
      styleNameSource: "manual",
    });
    await expect(() => service.updateProductWorkbenchStyleNames(batchId, [{
      itemId: "item_1",
      styleNameEn: "Very Long Floral Bunny Name",
    }])).toThrow(/20/);
  });

  it("generates style names from approved output images with GPT5.5 and persists them", async () => {
    const root = setupWorkbenchRoot();
    const batchId = writeDesktopBatch(root);
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = String(init.body);
      expect(body).toContain("styleNameEn");
      expect(body).toContain("rabbit-pink");
      expect(body).not.toContain("fake-gpt55-key");
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          styles: [
            { itemId: "item_1", styleNameEn: "Pink Floral Bunny" },
            { itemId: "item_2", styleNameEn: "Gray Floral Bunny" },
          ],
        }) } }],
      }), {
        status: 200,
        headers: { "x-request-id": "req_style_names" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = await import("../productWorkbenchService.js");

    const updated = await service.generateProductWorkbenchStyleNames(batchId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updated.imageMetas.map((meta) => meta.styleNameEn)).toEqual(["Pink Floral Bunny", "Gray Floral Bunny"]);
    expect(updated.imageMetas.map((meta) => meta.styleNameSource)).toEqual(["gpt55", "gpt55"]);
    expect(updated).not.toHaveProperty("priceRows");
  });

});
