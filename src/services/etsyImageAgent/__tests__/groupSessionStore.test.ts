import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductGroup, UploadedImage } from "../types.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

function image(id: string): UploadedImage {
  return {
    id,
    originalFileName: `${id}.png`,
    relativePath: `${id}.png`,
    storedPath: `/tmp/${id}.png`,
    publicUrl: `/media/etsy-agent/originals/${id}.png`,
    mimeType: "image/png",
    sizeBytes: 100,
    hash: id,
    perceptualKey: id,
    createdAt: new Date(0).toISOString(),
  };
}

function group(id: string, images: UploadedImage[]): ProductGroup {
  return { id, displayName: id, confidence: 0.8, confidenceLabel: "high", reason: "test", images, originalFileNames: images.map((item) => item.originalFileName) };
}

describe("groupSessionStore", () => {
  it("supports rename, lock, main image, move, split and merge", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-groups-"));
    process.env.ETSY_AGENT_STORAGE_PATH = tmp;
    const store = await import("../groupSessionStore.js");
    store.saveGroupSession("session-1", [group("g1", [image("a"), image("b")]), group("g2", [image("c")])]);

    expect(store.renameGroup("session-1", "g1", "Ring", "SKU-1").groups[0]?.displayName).toBe("Ring");
    expect(store.setGroupLocked("session-1", "g1", true).groups[0]?.locked).toBe(true);
    expect(store.setGroupMainImage("session-1", "g1", "b").groups[0]?.mainImageId).toBe("b");
    expect(store.moveImageBetweenGroups("session-1", "b", "g1", "g2").groups.find((item) => item.id === "g2")?.images).toHaveLength(2);
    expect(store.splitGroup("session-1", "g2", ["b"], "Split").groups).toHaveLength(3);
    expect(store.mergeGroups("session-1", ["g1", "g2"], "Merged").groups[0]?.displayName).toBe("Merged");
  });
});
