import { describe, expect, it } from "vitest";
import { estimateAndValidateCost } from "../costControl.js";
import type { ProductGroup } from "../types.js";

function group(id: string): ProductGroup {
  return { id, displayName: id, confidence: 0.5, confidenceLabel: "low", reason: "test", images: [], originalFileNames: [] };
}

describe("costControl", () => {
  it("estimates planned images and API calls", () => {
    const estimate = estimateAndValidateCost([group("a"), group("b")], 3);
    expect(estimate.plannedGeneratedImages).toBe(6);
    expect(estimate.estimatedOpenAICalls).toBe(6);
  });

  it("blocks excessive per-product generation", () => {
    expect(() => estimateAndValidateCost([group("a")], 999)).toThrow(/单商品最多生成/);
  });
});
