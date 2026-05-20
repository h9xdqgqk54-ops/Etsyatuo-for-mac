import { describe, expect, it } from "vitest";
import { detectPromptRisks, planPromptsForGroup } from "../promptService.js";
import type { ProductGroup } from "../types.js";

const group: ProductGroup = {
  id: "product_1",
  displayName: "silver ring",
  confidence: 0.82,
  confidenceLabel: "high",
  reason: "test",
  images: [],
  originalFileNames: ["silver-ring-front.jpg", "silver-ring-side.jpg"],
};

describe("promptService", () => {
  it("creates differentiated Etsy prompts with authenticity constraints", () => {
    const prompts = planPromptsForGroup(group, "高级感白底主图", "etsy-premium-main", 3);
    expect(prompts).toHaveLength(3);
    expect(prompts[0]?.etsyImageType).toBe("main");
    expect(prompts[0]?.shotType).toBe("hero_white_background");
    expect(prompts[0]?.optimizedPrompt).toContain("Etsy authenticity constraints");
    expect(prompts[0]?.optimizedPrompt).toContain("same exact product");
    expect(prompts[0]?.optimizedPrompt).toContain("不要生成新商品");
    expect(prompts[0]?.optimizedPrompt).toContain("不要改变商品类别");
    expect(new Set(prompts.map((p) => p.etsyImageType)).size).toBeGreaterThan(1);
  });

  it("adds explicit same-pair constraints for high heel products", () => {
    const prompts = planPromptsForGroup({
      ...group,
      displayName: "高跟鞋",
      originalFileNames: ["black-high-heel-shoes-front.jpg"],
    }, "make six Etsy images", "etsy-product-fidelity", 6);
    expect(prompts).toHaveLength(6);
    expect(prompts[0]?.optimizedPrompt).toContain("同一双高跟鞋");
    expect(prompts[0]?.optimizedPrompt).toContain("not a new design");
    expect(prompts[0]?.optimizedPrompt).toContain("not a similar pair");
  });

  it("does not put mojibake display names into prompts", () => {
    const prompts = planPromptsForGroup({
      ...group,
      displayName: "å ¾ç product",
      originalFileNames: ["å ¾ç image.jpg"],
    }, "white background", "etsy-product-fidelity", 1);
    expect(prompts[0]?.optimizedPrompt).not.toContain("å ¾ç");
    expect(prompts[0]?.optimizedPrompt).toContain("uploaded-image-1");
  });

  it("detects prompts that risk changing actual product truth", () => {
    const risks = detectPromptRisks("change material to gold and add a luxury brand logo");
    expect(risks.length).toBeGreaterThan(0);
  });
});
