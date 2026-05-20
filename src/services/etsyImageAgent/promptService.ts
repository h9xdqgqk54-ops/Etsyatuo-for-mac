import { getTemplate, imageTypeForIndex } from "./templates.js";
import type { EtsyImageType, PlannedPrompt, ProductGroup, ShotType } from "./types.js";
import { safeDisplayName } from "./utils.js";

const IMAGE_TYPE_COPY: Record<EtsyImageType, string> = {
  main: "Etsy main listing image: centered, clean, thumbnail-friendly, instantly recognizable.",
  angle: "Multi-angle product display: show a different truthful angle such as front, side, back, top-down, or 45-degree.",
  detail: "Detail image: show material texture, craft, edge finish, stitching, surface, closure, or other real detail visible in references.",
  scale: "Scale context image: show proportion with a neutral everyday object only if it does not imply included accessories.",
  lifestyle: "Reasonable use-context image: show how the product can be used without exaggerating function or included items.",
  creative: "Creative Etsy image: more atmospheric background and lighting while preserving the exact product body.",
};

export const PRODUCT_REFERENCE_SHOT_TYPES: ShotType[] = [
  "hero_white_background",
  "angled_view",
  "detail_closeup",
  "lifestyle_clean",
  "texture_macro",
  "square_thumbnail",
];

const SHOT_TYPE_COPY: Record<ShotType, string> = {
  hero_white_background: "White background hero image: clean Etsy first image, centered, accurate silhouette, no extra props.",
  angled_view: "45-degree product view: show the same exact product from a clear angled composition without redesigning it.",
  detail_closeup: "Detail close-up: crop toward visible construction, edge, ornament, closure, stitching, heel, or other actual details.",
  lifestyle_clean: "Clean lifestyle background: tasteful context while the product remains unchanged and clearly the only subject.",
  texture_macro: "Material and texture macro: emphasize the real visible material, finish, surface, and craftsmanship from the input image.",
  square_thumbnail: "Square thumbnail-friendly composition: Etsy crop-safe, recognizable at small size, same exact product centered.",
};

const PRODUCT_PRESERVATION_CONSTRAINTS = [
  "same product consistency, do not generate new product",
  "Product fidelity mode: use the input reference image as the source of truth.",
  "The only subject must be the same exact product from the input image.",
  "Must preserve product category, primary color, material, structure, silhouette, decorative details, size proportions, and product quantity.",
  "Do not generate a new product style. Do not change the product type. Do not change the main color. Do not add extra products.",
  "Do not change brand, logo, pattern, text, or printed graphics visible on the product.",
  "Do not invent text, trademarks, people, hands, feet, or models unless the user explicitly requested them.",
  "All outputs must depict the same product shown in the input image, not a new design and not a similar item.",
  "保持同一商品：不要生成新商品，不要改变商品类别，不要改变主要颜色，不要添加额外商品。",
];

export function planPromptsForGroup(group: ProductGroup, userPrompt: string, templateId: string | undefined, count: number): PlannedPrompt[] {
  const template = getTemplate(templateId);
  const requested = Math.max(1, Math.floor(count));
  const productDescription = describeGroup(group);
  const creativity = inferCreativeStrength(userPrompt, template.creativeStrength);

  return Array.from({ length: requested }, (_, index) => {
    const etsyImageType = index === 0 ? "main" : imageTypeForIndex(index);
    const shotType = shotTypeForIndex(index);
    const angle = angleForIndex(index, template.recommendedAngles);
    const risk = creativity === "high" && etsyImageType === "creative" ? "medium" : "low";
    const highHeelConstraint = isHighHeelGroup(group, userPrompt)
      ? "High heel fidelity: all outputs must be the same pair of high heel shoes from the input image, not a new design, not a similar pair, not a bag, jewelry, clothing, or another shoe style. 所有输出必须是输入图片中同一双高跟鞋，不是新设计，不是相似款。"
      : "";
    const optimizedPrompt = [
      `Create a square 1:1 Etsy listing product_reference image for the product shown in the uploaded reference image.`,
      `Product subject: ${productDescription}. Preserve the product's core appearance, color, structure, material cues, size impression, and visible parts from the references.`,
      ...PRODUCT_PRESERVATION_CONSTRAINTS,
      highHeelConstraint,
      `Shot type: ${shotType}. ${SHOT_TYPE_COPY[shotType]}`,
      `User request: ${userPrompt.trim() || "Make the product photo clean, professional, and trustworthy for Etsy listing use."}`,
      `Template direction: ${template.basePrompt}`,
      `Image purpose: ${IMAGE_TYPE_COPY[etsyImageType]}`,
      `Camera angle: ${angle}.`,
      `Background and scene: professional product photography background that supports Etsy shoppers evaluating the real item; do not overpower the product.`,
      `Lighting: soft, accurate, high clarity, no harsh glare, no color cast that changes the product.`,
      `Composition: product is the clear subject, well-framed, enough margin for Etsy crop, first image especially centered and thumbnail-friendly.`,
      `Material detail: preserve real visible textures and craftsmanship from the reference images; do not invent premium materials.`,
      `Output target: high-quality 2000x2000 px or higher square export, sharp focus, commercial Etsy listing quality.`,
      `Variation rule: make this image visually distinct from the other generated images through angle, crop, lighting, or safe scene choice.`,
      `Etsy authenticity constraints: do not change the product body, color, material, brand, function, scale, included accessories, packaging, handmade/vintage/branded status, or buyer expectations.`,
      `Negative constraints: ${template.negativePrompt}; avoid deformation, missing subject, unreadable text, fake logo, watermark, false certification, low resolution, blur, and any accessory or feature not present in references.`,
      `Creative strength: ${creativity}; creativity may affect background, lighting, composition, and atmosphere only, never product identity.`,
    ].join("\n");

    return {
      generationIndex: index,
      etsyImageType,
      shotType,
      recommendedListingOrder: index + 1,
      angle,
      optimizedPrompt,
      negativePrompt: template.negativePrompt,
      originalityRiskLevel: risk,
    };
  });
}

export function shotTypeForIndex(index: number): ShotType {
  return PRODUCT_REFERENCE_SHOT_TYPES[index % PRODUCT_REFERENCE_SHOT_TYPES.length]!;
}

export function detectPromptRisks(userPrompt: string): string[] {
  const risks: string[] = [];
  const text = userPrompt.toLowerCase();
  const riskyPatterns = [
    { re: /\b(change|convert|turn).{0,25}\b(material|metal|wood|leather|fabric|stone)\b/, msg: "用户要求可能改变商品材质。" },
    { re: /\b(add|include|with).{0,25}\b(logo|brand|certificate|certification|packaging|box|accessory|accessories)\b/, msg: "用户要求可能虚构 logo、认证、包装或配件。" },
    { re: /\b(make it|turn it).{0,25}\b(branded|designer|luxury brand|vintage|handmade)\b/, msg: "用户要求可能误导商品 handmade/vintage/branded 状态。" },
    { re: /\b(change).{0,25}\b(color|shape|size|function|feature)\b/, msg: "用户要求可能改变颜色、结构、尺寸或功能。" },
  ];
  for (const p of riskyPatterns) {
    if (p.re.test(text)) risks.push(p.msg);
  }
  return risks;
}

function describeGroup(group: ProductGroup): string {
  const displayName = safeDisplayName(group.displayName, "product");
  const filenames = group.originalFileNames
    .map((f, index) => safeDisplayName(f.replace(/\.[^.]+$/, ""), `uploaded-image-${index + 1}`))
    .slice(0, 5)
    .join(", ");
  return `${displayName}; reference files: ${filenames}`;
}

function angleForIndex(index: number, angles: string[]): string {
  if (index === 0) return angles[0] ?? "front centered";
  return angles[index % Math.max(angles.length, 1)] ?? "45-degree angle";
}

function inferCreativeStrength(userPrompt: string, fallback: "low" | "medium" | "high"): "low" | "medium" | "high" {
  const text = userPrompt.toLowerCase();
  if (/大胆|创意|广告|campaign|dramatic|seasonal|holiday|festival|luxury scene/.test(text)) return "high";
  if (/白底|主图|clean|white background|simple|真实|thumbnail/.test(text)) return "low";
  return fallback;
}

function isHighHeelGroup(group: ProductGroup, userPrompt: string): boolean {
  const text = [
    group.displayName,
    group.sku ?? "",
    ...group.originalFileNames,
    userPrompt,
  ].join(" ").toLowerCase();
  return /高跟鞋|high heel|high-heel|stiletto|heels?\b|pump shoes?|heeled sandal/.test(text);
}
