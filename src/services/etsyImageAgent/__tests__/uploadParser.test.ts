import { describe, expect, it } from "vitest";
import { planPromptsForGroup } from "../promptService.js";
import { parseMultipartImages, validateImageMagic } from "../uploadParser.js";

describe("uploadParser", () => {
  it("rejects non-image binary data", () => {
    expect(validateImageMagic({
      fileName: "bad.txt",
      relativePath: "bad.txt",
      mimeType: "text/plain",
      data: Buffer.from("not an image"),
    })).toBe(false);
  });

  it("uses stable safe names instead of user-supplied multipart filenames", () => {
    const boundary = "----etsy-test-boundary";
    const image = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("0000"),
    ]);
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="images"; filename="银色戒指主图.png"\r\nContent-Type: image/png\r\n\r\n`,
      "utf-8",
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
    const files = parseMultipartImages(`multipart/form-data; boundary=${boundary}`, Buffer.concat([header, image, footer]));
    expect(files).toHaveLength(1);
    expect(files[0]?.fileName).toBe("product-1.png");
    expect(files[0]?.relativePath).toBe("product-1.png");
  });

  it("keeps mojibake filenames out of generated prompts", () => {
    const prompts = planPromptsForGroup({
      id: "g1",
      displayName: "å ¾ç 戒指",
      confidence: 0.4,
      confidenceLabel: "low",
      reason: "test",
      images: [],
      originalFileNames: ["å ¾ç 戒指.png"],
    }, "white background", "etsy-white-main", 1);
    expect(prompts[0]?.optimizedPrompt).not.toContain("å ¾ç");
    expect(prompts[0]?.optimizedPrompt).toContain("uploaded-image-1");
  });
});
