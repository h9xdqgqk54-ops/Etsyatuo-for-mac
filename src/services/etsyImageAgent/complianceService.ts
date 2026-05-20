import type { ComplianceResult } from "./types.js";
import { detectPromptRisks } from "./promptService.js";

export function checkEtsyCompliance(userPrompt: string, optimizedPrompt: string, qualityReason = ""): ComplianceResult {
  const reasons = [...detectPromptRisks(userPrompt)];
  const riskText = `${userPrompt}\n${qualityReason}`.toLowerCase();

  const failTerms = [
    "fake logo",
    "false certification",
    "changed product shape",
    "changed material",
    "changed color",
    "missing subject",
    "severely deformed",
  ];
  if (failTerms.some((term) => riskText.includes(term))) {
    return { status: "fail", reason: "存在可能导致 Etsy 买家误解实际商品的严重风险。" };
  }

  if (reasons.length > 0) {
    return { status: "warning", reason: reasons.join(" ") };
  }

  if (/logo|watermark|certificate|branded|designer|packaging|accessor/i.test(userPrompt)) {
    return { status: "warning", reason: "包含品牌、包装、认证或配件相关表达，生成后需要人工复核 Etsy 真实性。" };
  }

  return { status: "pass", reason: "Prompt 已限制商品主体、材质、功能、品牌和配件真实性。" };
}
