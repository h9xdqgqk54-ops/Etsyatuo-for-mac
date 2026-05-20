import { generateImage } from "./imageProviders/registry.js";
import type { PlannedPrompt, ProductGroup } from "./types.js";

export async function generateEtsyImage(params: {
  group: ProductGroup;
  prompt: PlannedPrompt;
  outputPath: string;
}): Promise<{ provider: string; model: string; outputSize: string; quality?: string; estimatedCost?: string }> {
  return generateImage({ group: params.group, prompt: params.prompt, outputPath: params.outputPath });
}
