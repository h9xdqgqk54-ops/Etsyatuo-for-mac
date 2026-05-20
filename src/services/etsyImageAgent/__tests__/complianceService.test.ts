import { describe, expect, it } from "vitest";
import { checkEtsyCompliance } from "../complianceService.js";

describe("complianceService", () => {
  it("passes truthful Etsy-safe prompts", () => {
    const result = checkEtsyCompliance("soft light white background", "Preserve product body and material.");
    expect(result.status).toBe("pass");
  });

  it("warns for potentially misleading brand or accessory requests", () => {
    const result = checkEtsyCompliance("add a designer logo and packaging box", "Generate Etsy image");
    expect(result.status).toBe("warning");
  });
});
