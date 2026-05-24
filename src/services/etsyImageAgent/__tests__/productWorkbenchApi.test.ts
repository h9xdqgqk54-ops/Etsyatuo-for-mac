import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const nativeFetch = globalThis.fetch.bind(globalThis);
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.resetModules();
});

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const { handleEtsyAgentRoute } = await import("../apiRouter.js");
  const server = http.createServer((req, res) => {
    handleEtsyAgentRoute(req, res).then((handled) => {
      if (!handled && !res.headersSent) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Not found" }));
      }
    }).catch((error) => {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function setupApiRoot(): { root: string; batchId: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-workbench-api-"));
  const inputDir = path.join(root, "图片输入");
  const outputDir = path.join(root, "图片输出");
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(root, "storage", "metadata"), { recursive: true });
  process.env.ETSY_AGENT_DATA_PATH = path.join(root, "data");
  process.env.ETSY_AGENT_STORAGE_PATH = path.join(root, "storage");
  process.env.IMAGE_AGENT_INPUT_DIR = inputDir;
  process.env.IMAGE_AGENT_OUTPUT_DIR = outputDir;
  process.env.GPT55_API_KEY = "fake-gpt55-key";
  process.env.GPT55_BASE_URL = "https://gpt55.example.test/v1";
  process.env.GPT55_MODEL = "gpt-5.5";
  process.env.GPT55_MAX_INPUT_MB = "5";
  const batchId = "batch_api_workbench";
  fs.writeFileSync(path.join(inputDir, "rabbit-pink.png"), "input");
  fs.writeFileSync(path.join(outputDir, "rabbit-pink.png"), Buffer.from(pngBase64, "base64"));
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(root, "storage", "metadata", "desktop-batches.json"), JSON.stringify([{
    batchId,
    status: "approved",
    createdAt: now,
    updatedAt: now,
    inputDir,
    outputDir,
    totalItems: 1,
    generatedItems: 0,
    approvedItems: 1,
    failedItems: 0,
    model: "gpt-image-2",
    size: "1024x1024",
    quality: "low",
    items: [{
      itemId: "item_1",
      batchId,
      baseName: "rabbit-pink",
      inputAssetId: "input_1",
      inputFileName: "rabbit-pink.png",
      inputPath: path.join(inputDir, "rabbit-pink.png"),
      mimeType: "image/png",
      promptRecordId: "prompt_1",
      promptTextSnapshot: "same product prompt",
      negativePromptSnapshot: "no text",
      promptStatusAtGeneration: "approved",
      status: "approved",
      outputFileName: "rabbit-pink.png",
      outputFilePath: path.join(outputDir, "rabbit-pink.png"),
      attempts: 1,
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
    }],
  }], null, 2));
  return { root, batchId };
}

function listingJson(overrides: Record<string, unknown> = {}) {
  return {
    title: "Pink Bunny Plush Toy for Cozy Nursery Decor",
    description: "A soft pink bunny plush with floral fabric accents for cozy nursery shelves and thoughtful handmade-style gifts.",
    keywords: [
      "bunny plush",
      "plush toy",
      "rabbit toy",
      "soft bunny",
      "nursery decor",
      "kids gift",
      "baby shower",
      "stuffed animal",
      "easter bunny",
      "cute plush",
      "floral bunny",
      "pink bunny",
      "gift for kids",
    ],
    ...overrides,
  };
}

function gpt55Response(content: unknown, requestId: string): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), {
    status: 200,
    headers: { "x-request-id": requestId },
  });
}

describe("product workbench API routes", () => {
  it("returns a product workbench without price rows", async () => {
    const { batchId } = setupApiRoot();

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/etsy-agent/desktop-batch/${batchId}/workbench`);
      const json = await response.json() as { ok: boolean; data: Record<string, unknown> };

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.imageMetas).toEqual([expect.objectContaining({
        itemId: "item_1",
        inputFileName: "rabbit-pink.png",
        outputFileName: "rabbit-pink.png",
      })]);
      expect(json.data).not.toHaveProperty("priceRows");
    });
  });

  it("does not expose removed price workbench endpoints", async () => {
    const { batchId } = setupApiRoot();
    const endpoints = [
      { method: "PATCH", path: `/api/etsy-agent/desktop-batch/${batchId}/workbench/prices` },
      { method: "POST", path: `/api/etsy-agent/desktop-batch/${batchId}/workbench/generate-prices` },
      { method: "POST", path: `/api/etsy-agent/desktop-batch/${batchId}/workbench/calculate-prices` },
      { method: "POST", path: `/api/etsy-agent/desktop-batch/${batchId}/workbench/confirm-prices` },
    ];

    await withServer(async (baseUrl) => {
      for (const endpoint of endpoints) {
        const response = await fetch(`${baseUrl}${endpoint.path}`, {
          method: endpoint.method,
          headers: { "Content-Type": "application/json" },
          body: endpoint.method === "PATCH" ? JSON.stringify({ rows: [] }) : undefined,
        });
        expect(response.status).toBe(404);
      }
    });
  });

  it("generates product style names through the workbench API", async () => {
    const { batchId } = setupApiRoot();
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(String(init.body)).toContain("styleNameEn");
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ styles: [{ itemId: "item_1", styleNameEn: "Pink Floral Bunny" }] }) } }],
      }), {
        status: 200,
        headers: { "x-request-id": "req_style_names" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await withServer(async (baseUrl) => {
      const response = await nativeFetch(`${baseUrl}/api/etsy-agent/desktop-batch/${batchId}/workbench/style-names/generate`, { method: "POST" });
      const json = await response.json() as { ok: boolean; data: { imageMetas: Array<{ styleNameEn: string; styleNameSource: string }> } };

      expect(response.status).toBe(200);
      expect(json.data.imageMetas[0]).toMatchObject({
        styleNameEn: "Pink Floral Bunny",
        styleNameSource: "gpt55",
      });
    });
  });

  it("does not expose removed image metadata pairing endpoints", async () => {
    const { batchId } = setupApiRoot();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await withServer(async (baseUrl) => {
      const patchResponse = await nativeFetch(`${baseUrl}/api/etsy-agent/desktop-batch/${batchId}/workbench/image-metas`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metas: [{ itemId: "item_1", color: "pink" }] }),
      });
      const generateResponse = await nativeFetch(`${baseUrl}/api/etsy-agent/desktop-batch/${batchId}/workbench/image-metas/generate`, { method: "POST" });

      expect(patchResponse.status).toBe(410);
      expect(generateResponse.status).toBe(410);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("revises listing copy and style names from a Chinese suggestion through the API", async () => {
    const { batchId } = setupApiRoot();
    const revised = {
      title: "Dog Plush Chew Toy with Soft Rope Detail",
      description: "This playful plush pet toy has a soft animal shape, gentle stitched details, and a visible rope accent for cozy dog gift photos and everyday pet play.",
      keywords: [
        "dog chew toy",
        "pet plush toy",
        "puppy toy",
        "rope dog toy",
        "soft pet toy",
        "animal dog toy",
        "dog gift",
        "plush chew toy",
        "cute dog toy",
        "small dog toy",
        "pet supplies",
        "dog birthday",
        "puppy gift",
      ],
      styles: [{ itemId: "item_1", styleNameEn: "Dog Rope Toy" }],
    };
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => gpt55Response(listingJson(), "req_initial_listing"))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        expect(String(init.body)).toContain("请改成宠物玩具方向");
        return gpt55Response(revised, "req_revision");
      });
    vi.stubGlobal("fetch", fetchMock);

    await withServer(async (baseUrl) => {
      const finalizeResponse = await nativeFetch(`${baseUrl}/api/etsy-agent/desktop-batch/${batchId}/finalize-listing`, { method: "POST" });
      const finalizeJson = await finalizeResponse.json() as { data: { listingId: string } };

      const reviseResponse = await nativeFetch(`${baseUrl}/api/etsy-agent/listings/${finalizeJson.data.listingId}/revise-with-suggestion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestion: "请改成宠物玩具方向，全部输出英文，款式名短一点。" }),
      });
      const reviseJson = await reviseResponse.json() as {
        ok: boolean;
        data: {
          listing: { title: string; keywords: string[]; status: string };
          workbench: { imageMetas: Array<{ itemId: string; styleNameEn: string; styleNameSource: string }> };
        };
      };

      expect(reviseResponse.status).toBe(200);
      expect(reviseJson.ok).toBe(true);
      expect(reviseJson.data.listing).toMatchObject({
        title: revised.title,
        status: "edited",
      });
      expect(reviseJson.data.listing.keywords).toEqual(revised.keywords);
      expect(reviseJson.data.workbench.imageMetas[0]).toMatchObject({
        itemId: "item_1",
        styleNameEn: "Dog Rope Toy",
        styleNameSource: "gpt55",
      });
    });
  });
});
