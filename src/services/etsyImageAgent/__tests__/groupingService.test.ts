import { describe, expect, it } from "vitest";
import { groupUploadedImages } from "../groupingService.js";
import type { UploadedImage } from "../types.js";

function image(relativePath: string): UploadedImage {
  return {
    id: relativePath,
    originalFileName: relativePath.split("/").pop() ?? relativePath,
    relativePath,
    storedPath: `/tmp/${relativePath}`,
    publicUrl: `/media/${relativePath}`,
    mimeType: "image/jpeg",
    sizeBytes: 100,
    hash: relativePath,
    perceptualKey: "10101010",
    createdAt: new Date().toISOString(),
  };
}

describe("groupingService", () => {
  it("groups images from the same product folder", () => {
    const groups = groupUploadedImages([image("ring-a/front.jpg"), image("ring-a/side.jpg"), image("necklace-b/front.jpg")]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.images.length).toBe(2);
  });

  it("marks single-image groups as low confidence", () => {
    const groups = groupUploadedImages([image("single.jpg")]);
    expect(groups[0]?.confidenceLabel).toBe("low");
  });
});
