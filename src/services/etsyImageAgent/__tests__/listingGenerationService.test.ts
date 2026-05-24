import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function setupListingRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-listing-root-"));
  fs.mkdirSync(path.join(root, "图片输出"), { recursive: true });
  process.env.ETSY_AGENT_DATA_PATH = path.join(root, "data");
  process.env.ETSY_AGENT_STORAGE_PATH = path.join(root, "storage");
  process.env.ETSY_AGENT_LISTING_RECORDS_PATH = path.join(root, "data", "listing-records.json");
  process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(root, "data", "security.log");
  process.env.IMAGE_AGENT_OUTPUT_DIR = path.join(root, "图片输出");
  process.env.GPT55_API_KEY = "fake-gpt55-key";
  process.env.GPT55_BASE_URL = "https://ark.example.test/api/v3";
  process.env.GPT55_MODEL = "fake-vision-model";
  process.env.GPT55_MAX_INPUT_MB = "5";
  return root;
}

function listingJson(overrides: Record<string, unknown> = {}) {
  return {
    title: "Floral Bunny Plush Toy for Nursery Decor",
    description: "A soft bunny plush with floral ear details, ideal for nursery decor, baby shower gifts, and cozy shelf styling.",
    colors: "Pink, cream, floral multicolor",
    sizeInfo: "Size not specified from image",
    materials: "Soft plush fabric, floral fabric accents",
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

function mockGpt55Listing(content: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    expect(String(init.body)).not.toContain("fake-gpt55-key");
    expect(String(init.body)).toContain("fake-vision-model");
    expect(String(init.body)).toContain("13 个关键词");
    return new Response(JSON.stringify({
      choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
    }), {
      status: 200,
      headers: { "x-request-id": "req_gpt55_listing" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function gpt55Response(content: unknown, requestId: string): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
  }), {
    status: 200,
    headers: { "x-request-id": requestId },
  });
}

async function overwriteApprovedOutputWithLargePng(root: string, fileName = "item-1.png"): Promise<string> {
  const filePath = path.join(root, "图片输出", fileName);
  await sharp({
    create: {
      width: 2000,
      height: 2000,
      channels: 3,
      background: { r: 242, g: 188, b: 205 },
    },
  }).png({ compressionLevel: 0 }).toFile(filePath);
  expect(fs.statSync(filePath).size).toBeGreaterThan(5 * 1024 * 1024);
  return filePath;
}

function gpt55ImageUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as {
    messages?: Array<{ role?: string; content?: Array<{ type?: string; image_url?: { url?: string } }> }>;
  };
  const userMessage = body.messages?.find((message) => message.role === "user");
  return userMessage?.content
    ?.filter((part) => part.type === "image_url")
    .map((part) => part.image_url?.url ?? "") ?? [];
}

function writeDesktopBatch(root: string, statuses: string[] = ["approved"]): string {
  const outputDir = path.join(root, "图片输出");
  const now = new Date().toISOString();
  const batchId = "batch_listing";
  const items = statuses.map((status, index) => {
    const baseName = `item-${index + 1}`;
    const outputFilePath = status === "approved" ? path.join(outputDir, `${baseName}.png`) : undefined;
    if (outputFilePath) fs.writeFileSync(outputFilePath, Buffer.from(pngBase64, "base64"));
    return {
      itemId: `item_${index}`,
      batchId,
      baseName,
      inputAssetId: `input_${index}`,
      inputFileName: `${baseName}.jpg`,
      inputPath: path.join(root, "图片输入", `${baseName}.jpg`),
      mimeType: "image/jpeg",
      promptRecordId: `prompt_${index}`,
      promptTextSnapshot: "same product prompt",
      negativePromptSnapshot: "no text",
      promptStatusAtGeneration: "approved",
      status,
      outputFileName: outputFilePath ? path.basename(outputFilePath) : undefined,
      outputFilePath,
      attempts: 1,
      createdAt: now,
      updatedAt: now,
      approvedAt: status === "approved" ? now : undefined,
    };
  });
  fs.mkdirSync(path.join(root, "storage", "metadata"), { recursive: true });
  fs.writeFileSync(path.join(root, "storage", "metadata", "desktop-batches.json"), JSON.stringify([{
    batchId,
    status: statuses.includes("queued") || statuses.includes("running") ? "running" : "approved",
    createdAt: now,
    updatedAt: now,
    inputDir: path.join(root, "图片输入"),
    outputDir,
    totalItems: items.length,
    generatedItems: 0,
    approvedItems: statuses.filter((status) => status === "approved").length,
    failedItems: statuses.filter((status) => status === "failed").length,
    model: "gpt-image-2",
    size: "1024x1024",
    quality: "low",
    items,
  }], null, 2));
  return batchId;
}

describe("listing generation service", () => {
  it("uses the existing GPT5.5 prompt provider settings to generate one batch listing and listing.txt", async () => {
    const root = setupListingRoot();
    const batchId = writeDesktopBatch(root, ["approved", "approved"]);
    const fetchMock = mockGpt55Listing(listingJson());
    const service = await import("../listingGenerationService.js");

    const record = await service.finalizeBatchListing(batchId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(record).toMatchObject({
      batchId,
      status: "generated",
      model: "fake-vision-model",
      promptProviderRequestId: "req_gpt55_listing",
      title: "Floral Bunny Plush Toy for Nursery Decor",
    });
    expect(record.keywords).toHaveLength(13);
    expect(record.outputFilePath).toBe(path.join(root, "图片输出", "listing.txt"));
    expect(fs.readFileSync(record.outputFilePath, "utf-8")).toContain("Keywords:");
    expect(service.listProductListingRecords(batchId)).toHaveLength(1);
  });

  it("rejects invalid listing JSON and does not save a bad record", async () => {
    const root = setupListingRoot();
    const batchId = writeDesktopBatch(root);
    mockGpt55Listing(listingJson({ keywords: ["too few"] }));
    const service = await import("../listingGenerationService.js");

    await expect(service.finalizeBatchListing(batchId)).rejects.toMatchObject({ code: "GPT55_LISTING_PARSE_FAILED" });
    expect(service.listProductListingRecords(batchId)).toHaveLength(0);
    expect(fs.existsSync(path.join(root, "图片输出", "listing.txt"))).toBe(false);
  });

  it("requires approved output images and waits for queued or running images", async () => {
    let root = setupListingRoot();
    let batchId = writeDesktopBatch(root, ["failed"]);
    let service = await import("../listingGenerationService.js");
    await expect(service.finalizeBatchListing(batchId)).rejects.toMatchObject({ code: "LISTING_APPROVED_IMAGE_REQUIRED" });

    vi.resetModules();
    root = setupListingRoot();
    batchId = writeDesktopBatch(root, ["approved", "queued"]);
    service = await import("../listingGenerationService.js");
    await expect(service.finalizeBatchListing(batchId)).rejects.toMatchObject({ code: "LISTING_IMAGE_REVIEW_NOT_FINISHED" });
  });

  it("uses listing-2.txt on filename conflict and syncs PATCH updates to the text file", async () => {
    const root = setupListingRoot();
    const batchId = writeDesktopBatch(root);
    fs.writeFileSync(path.join(root, "图片输出", "listing.txt"), "existing listing");
    mockGpt55Listing(listingJson());
    const service = await import("../listingGenerationService.js");
    const record = await service.finalizeBatchListing(batchId);

    expect(path.basename(record.outputFilePath)).toBe("listing-2.txt");
    const edited = service.updateProductListingRecord(record.listingId, {
      title: "Edited Bunny Plush Title",
      keywords: record.keywords,
    });
    expect(edited.status).toBe("edited");
    expect(fs.readFileSync(record.outputFilePath, "utf-8")).toContain("Edited Bunny Plush Title");
  });

  it("accepts integrated listing copy without separate color size and material fields", async () => {
    const root = setupListingRoot();
    const batchId = writeDesktopBatch(root);
    const fetchMock = mockGpt55Listing({
      title: "Floral Bunny Plush Toy for Cozy Nursery Decor",
      description: "This soft bunny plush has pink floral accents and cozy plush fabric details worked naturally into a richer Etsy description.",
      keywords: listingJson().keywords,
    });
    const workbench = await import("../productWorkbenchService.js");
    workbench.updateProductWorkbenchImageMetas(batchId, [{
      itemId: "item_0",
      color: "pink floral",
      size: "18 cm",
      material: "soft plush fabric",
      note: "main listing image",
    }]);
    const service = await import("../listingGenerationService.js");

    const record = await service.finalizeBatchListing(batchId);

    expect(record.title).toBe("Floral Bunny Plush Toy for Cozy Nursery Decor");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("pink floral");
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("soft plush fabric");
    expect(fs.readFileSync(record.outputFilePath, "utf-8")).toContain("Description:");
    expect(fs.readFileSync(record.outputFilePath, "utf-8")).not.toContain("Colors:");
    expect(fs.readFileSync(record.outputFilePath, "utf-8")).not.toContain("Materials:");
  });

  it("passes style names into listing copy generation", async () => {
    const root = setupListingRoot();
    const batchId = writeDesktopBatch(root);
    const fetchMock = mockGpt55Listing(listingJson());
    const workbench = await import("../productWorkbenchService.js");
    workbench.updateProductWorkbenchStyleNames(batchId, [{
      itemId: "item_0",
      styleNameEn: "Pink Floral Bunny",
    }]);
    const service = await import("../listingGenerationService.js");

    await service.finalizeBatchListing(batchId);

    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("styleNameEn=Pink Floral Bunny");
  });

  it("sends compressed JPEG listing inputs for oversized approved PNGs without modifying originals", async () => {
    const root = setupListingRoot();
    const batchId = writeDesktopBatch(root);
    const approvedPngPath = await overwriteApprovedOutputWithLargePng(root);
    const originalSize = fs.statSync(approvedPngPath).size;
    const fetchMock = mockGpt55Listing(listingJson());
    const service = await import("../listingGenerationService.js");

    const record = await service.finalizeBatchListing(batchId);

    expect(record.status).toBe("generated");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(gpt55ImageUrls(fetchMock)).toEqual([expect.stringMatching(/^data:image\/jpeg;base64,/)]);
    expect(gpt55ImageUrls(fetchMock).join("\n")).not.toContain("data:image/png;base64,");
    expect(fs.existsSync(approvedPngPath)).toBe(true);
    expect(fs.statSync(approvedPngPath).size).toBe(originalSize);
  });

  it("returns a structured too-large error when compressed listing inputs still exceed the GPT5.5 limit", async () => {
    const root = setupListingRoot();
    process.env.GPT55_MAX_INPUT_MB = "0.000001";
    const batchId = writeDesktopBatch(root);
    await overwriteApprovedOutputWithLargePng(root);
    const fetchMock = mockGpt55Listing(listingJson());
    const service = await import("../listingGenerationService.js");

    await expect(service.finalizeBatchListing(batchId)).rejects.toMatchObject({
      code: "GPT55_IMAGE_TOO_LARGE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a Chinese suggestion to revise English listing copy and style names through GPT5.5", async () => {
    const root = setupListingRoot();
    const batchId = writeDesktopBatch(root, ["approved", "approved"]);
    const workbench = await import("../productWorkbenchService.js");
    workbench.updateProductWorkbenchImageMetas(batchId, [
      { itemId: "item_0", color: "green and yellow", material: "soft plush and cotton rope", note: "stingray pet chew toy" },
      { itemId: "item_1", color: "gray and white", material: "crochet plush yarn", note: "sitting puppy plush" },
    ]);
    workbench.updateProductWorkbenchStyleNames(batchId, [
      { itemId: "item_0", styleNameEn: "Green Stingray" },
      { itemId: "item_1", styleNameEn: "Gray Puppy" },
    ]);
    const revised = {
      title: "Pet Plush Chew Toys, Soft Rope Animal Toys for Dogs",
      description: "Designed for cozy pet play and giftable shop photos, this set features soft plush animal toys with visible rope accents, gentle stitched details, and playful color differences. The green stingray style blends yellow fabric texture with a cotton rope tail, while the gray puppy style adds a handmade plush look for a warm, playful display.",
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
      styles: [
        { itemId: "item_0", styleNameEn: "Green Ray Toy" },
        { itemId: "item_1", styleNameEn: "Gray Pup Toy" },
      ],
    };
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        expect(String(init.body)).toContain("fake-vision-model");
        return gpt55Response(listingJson(), "req_initial_listing");
      })
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const body = String(init.body);
        expect(body).toContain("请突出宠物咬咬玩具");
        expect(body).toContain("All revised output fields must be English");
        expect(body).toContain("Green Stingray");
        expect(body).toContain("Gray Puppy");
        return gpt55Response(revised, "req_revision");
      });
    vi.stubGlobal("fetch", fetchMock);
    const service = await import("../listingGenerationService.js");

    const record = await service.finalizeBatchListing(batchId);
    const result = await service.reviseProductListingWithSuggestion(record.listingId, {
      suggestion: "请突出宠物咬咬玩具，标题不要写 nursery，关键词增加 dog chew toy，款式名更短。",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.listing).toMatchObject({
      listingId: record.listingId,
      status: "edited",
      title: revised.title,
      promptProviderRequestId: "req_revision",
    });
    expect(result.listing.keywords).toEqual(revised.keywords);
    expect(result.workbench.imageMetas).toEqual([
      expect.objectContaining({ itemId: "item_0", styleNameEn: "Green Ray Toy", styleNameSource: "gpt55" }),
      expect.objectContaining({ itemId: "item_1", styleNameEn: "Gray Pup Toy", styleNameSource: "gpt55" }),
    ]);
    const listingText = fs.readFileSync(record.outputFilePath, "utf-8");
    expect(listingText).toContain(revised.title);
    expect(listingText).toContain("dog chew toy");
  });

  it("rejects non-English GPT5.5 revisions without overwriting existing listing or style names", async () => {
    const root = setupListingRoot();
    const batchId = writeDesktopBatch(root);
    const workbench = await import("../productWorkbenchService.js");
    workbench.updateProductWorkbenchStyleNames(batchId, [{ itemId: "item_0", styleNameEn: "Pink Bunny" }]);
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => gpt55Response(listingJson(), "req_initial_listing"))
      .mockImplementationOnce(async () => gpt55Response({
        title: "中文标题",
        description: "This should not be saved.",
        keywords: listingJson().keywords,
        styles: [{ itemId: "item_0", styleNameEn: "中文款式" }],
      }, "req_bad_revision"));
    vi.stubGlobal("fetch", fetchMock);
    const service = await import("../listingGenerationService.js");
    const record = await service.finalizeBatchListing(batchId);

    await expect(service.reviseProductListingWithSuggestion(record.listingId, {
      suggestion: "标题更可爱，但是输出必须英文。",
    })).rejects.toMatchObject({ code: "GPT55_LISTING_REVISION_PARSE_FAILED" });

    expect(service.findProductListingRecord(record.listingId)).toMatchObject({
      title: record.title,
      status: "generated",
    });
    expect(workbench.getProductWorkbench(batchId).imageMetas[0]).toMatchObject({
      styleNameEn: "Pink Bunny",
      styleNameSource: "manual",
    });
    expect(fs.readFileSync(record.outputFilePath, "utf-8")).toContain(record.title);
    expect(fs.readFileSync(record.outputFilePath, "utf-8")).not.toContain("中文标题");
  });

  it("rejects incomplete GPT5.5 style revisions before writing listing files", async () => {
    const root = setupListingRoot();
    const batchId = writeDesktopBatch(root, ["approved", "approved"]);
    const workbench = await import("../productWorkbenchService.js");
    workbench.updateProductWorkbenchStyleNames(batchId, [
      { itemId: "item_0", styleNameEn: "Pink Bunny" },
      { itemId: "item_1", styleNameEn: "Gray Bunny" },
    ]);
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => gpt55Response(listingJson(), "req_initial_listing"))
      .mockImplementationOnce(async () => gpt55Response({
        title: "Dog Plush Chew Toy with Soft Rope Detail",
        description: "A soft plush dog toy with a gentle rope accent for playful pet gift photos.",
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
        styles: [{ itemId: "item_0", styleNameEn: "Dog Rope Toy" }],
      }, "req_incomplete_revision"));
    vi.stubGlobal("fetch", fetchMock);
    const service = await import("../listingGenerationService.js");
    const record = await service.finalizeBatchListing(batchId);

    await expect(service.reviseProductListingWithSuggestion(record.listingId, {
      suggestion: "请改成宠物玩具方向，全部输出英文。",
    })).rejects.toMatchObject({ code: "GPT55_LISTING_REVISION_STYLE_MISMATCH" });

    expect(service.findProductListingRecord(record.listingId)).toMatchObject({
      title: record.title,
      status: "generated",
    });
    expect(workbench.getProductWorkbench(batchId).imageMetas).toEqual([
      expect.objectContaining({ itemId: "item_0", styleNameEn: "Pink Bunny", styleNameSource: "manual" }),
      expect.objectContaining({ itemId: "item_1", styleNameEn: "Gray Bunny", styleNameSource: "manual" }),
    ]);
    expect(fs.readFileSync(record.outputFilePath, "utf-8")).toContain(record.title);
    expect(fs.readFileSync(record.outputFilePath, "utf-8")).not.toContain("Dog Plush Chew Toy");
  });
});
