import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("asset storage", () => {
  it("returns a publicUrl for uploaded originals when ASSET_STORAGE_PROVIDER=vercel-blob", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-blob-storage-"));
    process.env.ETSY_AGENT_STORAGE_PATH = tmp;
    process.env.ASSET_STORAGE_PROVIDER = "vercel-blob";
    vi.doMock("@vercel/blob", () => ({
      put: vi.fn(async () => ({ url: "https://blob.example.test/etsy-agent/originals/product.png" })),
    }));
    const { saveAndGroupUploads } = await import("../groupingService.js");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    );
    const result = await saveAndGroupUploads([{
      fileName: "product.png",
      relativePath: "product.png",
      mimeType: "image/png",
      data: png,
    }]);
    expect(result.images[0]?.publicUrl).toBe("https://blob.example.test/etsy-agent/originals/product.png");
    expect(result.groups[0]?.images[0]?.publicUrl).toBe("https://blob.example.test/etsy-agent/originals/product.png");
  });
});
