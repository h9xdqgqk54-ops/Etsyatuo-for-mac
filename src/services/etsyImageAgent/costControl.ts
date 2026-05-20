import { etsyAgentConfig } from "./config.js";
import type { CostEstimate, ProductGroup } from "./types.js";

export function estimateAndValidateCost(groups: ProductGroup[], perProductImageCount: number): CostEstimate {
  if (groups.length === 0) throw new Error("没有可生成的商品分组。");
  if (groups.length > etsyAgentConfig.maxProductGroups) {
    throw new Error(`单批最多处理 ${etsyAgentConfig.maxProductGroups} 个商品组。`);
  }
  if (perProductImageCount < 1) throw new Error("每个商品至少生成 1 张图片。");
  if (perProductImageCount > etsyAgentConfig.maxImagesPerProduct) {
    throw new Error(`单商品最多生成 ${etsyAgentConfig.maxImagesPerProduct} 张图片。`);
  }
  const planned = groups.length * perProductImageCount;
  if (planned > etsyAgentConfig.maxBatchGeneratedImages) {
    throw new Error(`单批最多生成 ${etsyAgentConfig.maxBatchGeneratedImages} 张图片，当前计划 ${planned} 张。`);
  }
  const refs = groups.reduce((sum, g) => sum + g.images.length, 0);
  return {
    productCount: groups.length,
    referenceImageCount: refs,
    requestedImagesPerProduct: perProductImageCount,
    plannedGeneratedImages: planned,
    estimatedOpenAICalls: planned,
    maxConcurrentGenerations: etsyAgentConfig.maxConcurrentGenerations,
    note: "成本估算以 OpenAI 图像生成调用次数和生成图片数量为准；实际费用以 OpenAI 后台账单为准。",
  };
}
