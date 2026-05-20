/**
 * Etsy → 1688 Workflow API Server
 *
 * Manages the 4-step product workflow:
 *   Step 1 — Search & select Etsy products
 *   Step 2 — Match with 1688 wholesale sources
 *   Step 3 — AI generate images (Image2) & copy (Deepseek) on demand
 *   Step 4 — Mock publish to Etsy
 *
 * All CSV files are internal cache — users never touch them.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import csvParser from "csv-parser";
import dotenv from "dotenv";
import { handleEtsyAgentRoute, tryServeEtsyMedia } from "./etsyImageAgent/apiRouter.js";
import { matchByImage } from "./matcher1688/image_search.js";

dotenv.config();

// ── Config ───────────────────────────────────────────────────

const PORT = 3456;
const PUBLIC_DIR = path.resolve("public");

const IMAGE2_KEY = process.env.IMAGE2_API_KEY ?? "";
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY ?? "";

// ── In-Memory Workflow State ─────────────────────────────────

interface EtsyProduct {
  id: string;
  title: string;
  price: number;
  priceDisplay: string;
  url: string;
  etsyImageUrl: string;
  sales: number;
  favorites: number;
  score: number;
  scoreReasons: string[];
  selected: boolean;
}

interface Match1688 {
  etsyId: string;
  title: string;
  price: number;
  priceDisplay: string;
  url: string;
  imageUrl: string;
  simulatedImages: SimulatedImage[];
  profitMargin: number;
}

interface SimulatedImage {
  id: string;
  label: string;
  url: string;
}

interface GeneratedImage {
  id: string;
  label: string;
  originalUrl: string;
  generatedUrl: string;
  imageStatus: "pending" | "generating" | "success" | "failed";
  imageError?: string;
  selected: boolean;
}

interface GeneratedContent {
  images: GeneratedImage[];
  optimizedTitle: string;
  optimizedDescription: string;
  optimizedTags: string;
  suggestedPrice: string;
  textStatus: "pending" | "generating" | "success" | "failed";
  textError?: string;
  originalTitle: string;
  originalDescription: string;
  originalTags: string;
}

const state = {
  step: 1 as number,
  keyword: "",
  products: [] as EtsyProduct[],
  matches: [] as Match1688[],
  generations: new Map<string, GeneratedContent>(),
};

// ── Helpers ──────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
};

function reply(res: http.ServerResponse, status: number, data: unknown, ct?: string): void {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": ct ?? "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function serveFile(res: http.ServerResponse, filePath: string, headOnly = false): void {
  if (!fs.existsSync(filePath)) { reply(res, 404, "Not Found"); return; }
  const ext = path.extname(filePath).toLowerCase();
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Content-Length": data.length,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  });
  if (headOnly) {
    res.end();
    return;
  }
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => { b += c; });
    req.on("end", () => resolve(b));
  });
}

function parsePrice(raw: string): number {
  const n = Number(raw.replace(/[$,]/g, "").trim());
  return Number.isNaN(n) ? 0 : n;
}

function placeholderSvg(text: string, hue: number): string {
  const c = `hsl(${hue},55%,65%)`;
  const c2 = `hsl(${hue},45%,55%)`;
  const letter = (text.trim()[0] ?? "P").toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c}"/><stop offset="100%" stop-color="${c2}"/>
    </linearGradient></defs>
    <rect width="300" height="300" fill="url(#g)"/>
    <text x="150" y="165" text-anchor="middle" font-family="Arial,sans-serif" font-size="80" font-weight="bold" fill="white" opacity="0.9">${letter}</text>
  </svg>`;
}

// ── Step 1: Search & Score ───────────────────────────────────

async function loadEtsyCache(): Promise<void> {
  const csvPath = path.resolve("etsy_results.csv");
  if (!fs.existsSync(csvPath)) return;

  const records: Record<string, string>[] = [];
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csvParser())
      .on("data", (r) => records.push(r))
      .on("end", resolve)
      .on("error", reject);
  });

  const scored = records.map((r, i) => {
    const title = r["etsy_title"] ?? r["title"] ?? "";
    const priceRaw = r["etsy_price"] ?? r["price"] ?? "0";
    const price = parsePrice(priceRaw);
    const sales = Number(r["etsy_sales"] ?? "0") || Math.floor(Math.random() * 3000);
    const favs = Number(r["etsy_favorites"] ?? "0") || Math.floor(Math.random() * 1500);
    const url = r["etsy_url"] ?? r["link"] ?? "";

    const reasons: string[] = [];
    let score = 0;
    if (sales >= 2000) { score += 30; reasons.push("High sales volume"); }
    else if (sales >= 500) { score += 20; reasons.push("Steady seller"); }
    else if (sales >= 100) { score += 10; reasons.push("Consistent sales"); }
    if (favs >= 1000) { score += 20; reasons.push("Very popular"); }
    else if (favs >= 300) { score += 12; reasons.push("Popular item"); }
    if (price >= 15 && price <= 80) { score += 25; reasons.push("Sweet-spot price"); }
    else if (price > 80 && price <= 200) { score += 15; reasons.push("Premium margin"); }
    else if (price > 0 && price < 15) { score += 10; reasons.push("Impulse buy range"); }
    if (title.length > 40) { score += 8; reasons.push("SEO-friendly title"); }

    return {
      id: `etsy_${i}`,
      title,
      price,
      priceDisplay: `$${price.toFixed(2)}`,
      url,
      etsyImageUrl: r["etsy_image_url"] ?? r["image_url"] ?? "",
      sales,
      favorites: favs,
      score,
      scoreReasons: reasons,
      selected: false,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  state.products = scored;
}

// ── Step 2: 1688 Matching ────────────────────────────────────

const MATERIALS = ["925 Sterling Silver","Stainless Steel","Zinc Alloy","Titanium Steel","Copper Alloy","Brass","S925 Silver Plated","Tungsten Steel"];
const SUFFIXES = ["Factory Direct Wholesale","Wholesale Supplier Bulk","Hot Selling Customizable","Manufacturer Direct OEM","Wholesale Custom Design"];
const OFFER_IDS = ["681234567890","691234567891","671234567892","661234567893","651234567894","641234567895"];
const IMAGE_LABELS = ["角度1 - 正面主图","角度2 - 侧面细节","角度3 - 佩戴效果","角度4 - 背面/底面","角度5 - 包装展示"];

function generateSimulatedImages(index: number): SimulatedImage[] {
  const count = 3 + (index % 3); // 3, 4, or 5 images per product
  return Array.from({ length: count }, (_, i) => ({
    id: `img_${i}`,
    label: IMAGE_LABELS[i]!,
    url: `/api/placeholder/1688_${index}_img${i}`,
  }));
}

/** Build a simulated 1688 match when real image search returns nothing. */
function buildSimulatedMatch(p: EtsyProduct, i: number): Match1688 {
  const material = MATERIALS[i % MATERIALS.length]!;
  const suffix = SUFFIXES[i % SUFFIXES.length]!;
  const words = p.title.replace(/[•|,/;:!?"'()-]/g, " ").split(/\s+/).filter(w => w.length > 2).slice(0, 4);
  const title1688 = `${material} ${words.join(" ")} ${suffix}`;
  const wholesalePrice = Math.round(p.price * (0.15 + Math.random() * 0.3) * 100) / 100;
  const margin = Math.round((1 - wholesalePrice / p.price) * 100);
  return {
    etsyId: p.id,
    title: title1688,
    price: wholesalePrice,
    priceDisplay: `$${wholesalePrice.toFixed(2)}`,
    url: `https://detail.1688.com/offer/${OFFER_IDS[i % OFFER_IDS.length]}.html`,
    imageUrl: `/api/placeholder/1688_${i}`,
    simulatedImages: generateSimulatedImages(i),
    profitMargin: margin,
  };
}

async function runMatching(selectedProducts: EtsyProduct[]): Promise<Match1688[]> {
  const results: Match1688[] = [];
  const USE_IMAGE_SEARCH = true; // toggle to disable real search for testing

  for (let i = 0; i < selectedProducts.length; i++) {
    const p = selectedProducts[i]!;
    let matched = false;

    if (USE_IMAGE_SEARCH && p.url) {
      console.log(`\n[image-search] Searching for: ${p.title.slice(0, 60)}...`);
      const imageSource = p.etsyImageUrl || p.url;
      const searchResults = await matchByImage(imageSource, p.title, i);

      if (searchResults.length > 0) {
        // Take the top 3 real results and create Match1688 entries
        const topResults = searchResults.slice(0, 3);
        for (let j = 0; j < topResults.length; j++) {
          const r = topResults[j]!;
          const wholesalePrice = r.price > 0 ? r.price : Math.round(p.price * (0.15 + Math.random() * 0.3) * 100) / 100;
          const margin = Math.round((1 - wholesalePrice / p.price) * 100);
          // Use real 1688 images as simulatedImages when available
          const realImages: SimulatedImage[] = r.imageUrl
            ? [{ id: "img_0", label: "识图匹配结果", url: r.imageUrl }]
            : generateSimulatedImages(i + j);
          results.push({
            etsyId: p.id,
            title: r.title,
            price: wholesalePrice,
            priceDisplay: r.priceDisplay,
            url: r.url,
            imageUrl: r.imageUrl || `/api/placeholder/real_1688_${i}_${j}`,
            simulatedImages: realImages,
            profitMargin: margin,
          });
        }
        matched = true;
        console.log(`  [image-search] Matched ${topResults.length} real 1688 products`);
      }
    }

    if (!matched) {
      // Fallback to simulated data
      console.log(`  [image-search] Using simulated match for: ${p.title.slice(0, 50)}...`);
      results.push(buildSimulatedMatch(p, i));
    }
  }

  return results;
}

// ── Step 3: On-Demand Generation ─────────────────────────────

/** Serialize a generation for API responses, including backward-compat computed fields. */
function serializeGen(gen: GeneratedContent): Record<string, unknown> {
  const firstImg = gen.images[0];
  return {
    images: gen.images,
    optimizedTitle: gen.optimizedTitle,
    optimizedDescription: gen.optimizedDescription,
    optimizedTags: gen.optimizedTags,
    suggestedPrice: gen.suggestedPrice,
    textStatus: gen.textStatus,
    textError: gen.textError,
    originalTitle: gen.originalTitle,
    originalDescription: gen.originalDescription,
    originalTags: gen.originalTags,
    // backward-compat computed fields
    imageUrl: firstImg?.generatedUrl || firstImg?.originalUrl || "",
    imageStatus: firstImg?.imageStatus ?? "pending",
  };
}

function ensureGeneration(etsyId: string, match: Match1688): GeneratedContent {
  if (!state.generations.has(etsyId)) {
    const images: GeneratedImage[] = match.simulatedImages.map(si => ({
      id: si.id,
      label: si.label,
      originalUrl: si.url,
      generatedUrl: "",
      imageStatus: "pending" as const,
      selected: false,
    }));
    state.generations.set(etsyId, {
      images,
      optimizedTitle: "",
      optimizedDescription: "",
      optimizedTags: "",
      suggestedPrice: "",
      textStatus: "pending" as const,
      originalTitle: match.title,
      originalDescription: `【1688原版商品描述】\n\n${match.title}\n批发价：${match.priceDisplay}\n预估利润率：${match.profitMargin}%\n\n材质工艺：${match.title.split(" ").slice(0, 2).join(" ")}，高端工艺，厂家直供。\n\n本产品为1688平台热销款式，支持定制logo、包装及表面工艺处理。起订量灵活，可一件代发。`,
      originalTags: match.title.replace(/\s+/g, ",").replace(/Factory|Wholesale|Supplier|Bulk|Custom|OEM|Manufacturer/gi, "").replace(/,+/g, ",").replace(/^,|,$/g, ""),
    });
  }
  return state.generations.get(etsyId)!;
}

async function callImage2API(prompt: string): Promise<string> {
  if (!IMAGE2_KEY) throw new Error("IMAGE2_API_KEY not configured");
  const res = await fetch("https://api.image2.example/v1/generate", {
    method: "POST",
    headers: { "Authorization": `Bearer ${IMAGE2_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, style: "product", size: "1024x1024" }),
  });
  if (!res.ok) throw new Error(`Image2 HTTP ${res.status}`);
  const data = await res.json();
  return data.url ?? data.image_url ?? "";
}

async function callDeepseekAPI(prompt: string): Promise<string> {
  if (!DEEPSEEK_KEY) throw new Error("DEEPSEEK_API_KEY not configured");
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${DEEPSEEK_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 800 }),
  });
  if (!res.ok) throw new Error(`Deepseek HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function parseGeneratedText(raw: string, fallbackPrice: string): Pick<GeneratedContent, "optimizedTitle" | "optimizedDescription" | "optimizedTags" | "suggestedPrice"> {
  const clean = raw
    .replace(/^#{1,3}\s*/gm, "")
    .replace(/\*\*/g, "")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith("(") && !l.startsWith("*"))
    .join("\n");

  const titleRe = /^TITLE\s*:\s*(.+)/im;
  const descRe = /^DESCRIPTION\s*:\s*([\s\S]+?)(?=\nTAGS\s*:|\nPRICE\s*:|\n\d+\.|$)/im;
  const tagsRe = /^TAGS\s*:\s*([\s\S]+?)(?=\nPRICE\s*:|\n\d+\.|$)/im;
  const priceRe = /^PRICE\s*:\s*\$?([\d,.]+)/im;

  const titleMatch = clean.match(titleRe);
  const descMatch = clean.match(descRe);
  const tagsMatch = clean.match(tagsRe);
  const priceMatch = clean.match(priceRe);

  const legacyTitleRe = /(?:Optimized\s+)?(?:Etsy\s+)?Title[:\s-]+(.+)/i;
  const legacyTitle = clean.match(legacyTitleRe);

  const lines = clean.split("\n").filter(l => l.length > 10);
  const fallbackTitle = lines.find(l =>
    l.length > 15 && l.length < 150 &&
    !l.match(/^(TITLE|DESCRIPTION|TAGS|PRICE|Optimized|Title|Description|Tags|Price|Suggested|Retail)/i) &&
    !l.match(/^[0-9]+[.)]/) &&
    !l.startsWith("(") &&
    !l.startsWith("*")
  ) ?? lines[0] ?? raw.slice(0, 140);

  const tagLines = clean.split("\n").filter(l => l.includes(",") && l.split(",").length >= 5 && l.length > 20);
  const fallbackTags = tagLines.length > 0 ? tagLines[0]!.trim().replace(/^[-•*]\s*/, "") : "";

  return {
    optimizedTitle: (titleMatch?.[1] ?? legacyTitle?.[1] ?? fallbackTitle ?? "").trim().slice(0, 140),
    optimizedDescription: (descMatch?.[1] ?? clean.slice(0, 400)).trim().slice(0, 600),
    optimizedTags: (tagsMatch?.[1] ?? fallbackTags).trim().replace(/^[0-9]+[.)\s]*/, "").replace(/^[-•*]\s*/, ""),
    suggestedPrice: priceMatch?.[1] ? `$${priceMatch[1].trim()}` : fallbackPrice,
  };
}

// ══════════════════════════════════════════════════════════════
// HTTP Router
// ══════════════════════════════════════════════════════════════

export async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";
  const pathname = new URL(url, "http://localhost").pathname;

  if (tryServeEtsyMedia(req, res)) return;
  if (await handleEtsyAgentRoute(req, res)) return;

  // Static files
  if (method === "GET" || method === "HEAD") {
    const headOnly = method === "HEAD";
    if (url === "/" || url === "/app" || url === "/app.html") {
      return serveFile(res, path.join(PUBLIC_DIR, "app.html"), headOnly);
    }
    if (pathname === "/etsy-image-agent") {
      return serveFile(res, path.join(PUBLIC_DIR, "etsy-image-agent.html"), headOnly);
    }
    if (pathname === "/asset-library") {
      return serveFile(res, path.join(PUBLIC_DIR, "asset-library.html"), headOnly);
    }
    if (pathname === "/settings/openai") {
      return serveFile(res, path.join(PUBLIC_DIR, "openai-settings.html"), headOnly);
    }
    if (url.startsWith("/public/") || url.startsWith("/assets/")) {
      const safe = path.normalize(url).replace(/^[/\\]/, "");
      return serveFile(res, path.resolve(safe), headOnly);
    }
    if (url.startsWith("/api/placeholder/")) {
      const id = url.replace("/api/placeholder/", "");
      const hue = (hashCode(id) * 37) % 360;
      reply(res, 200, placeholderSvg(id, hue), "image/svg+xml");
      return;
    }
    if (url === "/api/state") {
      const { products, matches, ...rest } = state;
      const gens: Record<string, unknown> = {};
      for (const [id, gen] of state.generations) {
        gens[id] = serializeGen(gen);
      }
      return reply(res, 200, { ...rest, products, matches, generations: gens });
    }
    if (url === "/api/products") {
      return reply(res, 200, state.products);
    }
    if (url === "/api/matches") {
      return reply(res, 200, state.matches);
    }
    if (url === "/api/generations") {
      const gens: Record<string, unknown> = {};
      for (const [id, gen] of state.generations) {
        gens[id] = serializeGen(gen);
      }
      return reply(res, 200, gens);
    }
  }

  // POST routes
  if (method === "POST") {
    const body = await readBody(req);
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(body); } catch { /* ignore */ }

    // Step 1: search
    if (url === "/api/step1/search") {
      const keyword = String(parsed.keyword ?? "").trim();
      if (!keyword) return reply(res, 400, { error: "keyword required" });
      state.keyword = keyword;
      state.step = 1;
      state.matches = [];
      state.generations.clear();
      await loadEtsyCache();
      if (state.products.length === 0) {
        state.products = generateDemoProducts(keyword);
      }
      return reply(res, 200, { ok: true, count: state.products.length });
    }

    // Step 1: toggle selection
    if (url === "/api/step1/select") {
      const id = String(parsed.id ?? "");
      const product = state.products.find(p => p.id === id);
      if (product) product.selected = !product.selected;
      return reply(res, 200, { ok: true, selected: product?.selected });
    }

    // Step 1: select all
    if (url === "/api/step1/select-all") {
      const select = Boolean(parsed.select);
      state.products.forEach(p => { p.selected = select; });
      return reply(res, 200, { ok: true });
    }

    // Step 2: run matching
    if (url === "/api/step2/match") {
      const selected = state.products.filter(p => p.selected);
      if (selected.length === 0) return reply(res, 400, { error: "No products selected" });
      state.matches = await runMatching(selected);
      state.step = 2;
      saveMatchesCache(state.matches);
      return reply(res, 200, { ok: true, count: state.matches.length });
    }

    // Step 3: generate image (per-image, on demand)
    if (url === "/api/step3/generate-image") {
      const etsyId = String(parsed.etsyId ?? "");
      const imageId = String(parsed.imageId ?? "");
      const match = state.matches.find(m => m.etsyId === etsyId);
      if (!match) return reply(res, 404, { error: "Match not found" });
      const gen = ensureGeneration(etsyId, match);
      const img = imageId
        ? gen.images.find(im => im.id === imageId)
        : gen.images[0];
      if (!img) return reply(res, 404, { error: "Image not found" });
      img.imageStatus = "generating";
      try {
        const prompt = `Professional product photography of ${match.title} (${img.label}). White background, studio lighting, jewelry showcase, 1024x1024, high resolution.`;
        img.generatedUrl = await callImage2API(prompt);
        img.imageStatus = "success";
      } catch (e) {
        img.imageStatus = "failed";
        img.imageError = e instanceof Error ? e.message : String(e);
        img.generatedUrl = `/api/placeholder/gen_${etsyId}_${img.id}`;
      }
      return reply(res, 200, img);
    }

    // Step 3: generate all images for one match
    if (url === "/api/step3/generate-all-images") {
      const etsyId = String(parsed.etsyId ?? "");
      const match = state.matches.find(m => m.etsyId === etsyId);
      if (!match) return reply(res, 404, { error: "Match not found" });
      const gen = ensureGeneration(etsyId, match);
      const results: GeneratedImage[] = [];
      for (const img of gen.images) {
        if (img.imageStatus === "success") {
          results.push(img);
          continue;
        }
        img.imageStatus = "generating";
        try {
          const prompt = `Professional product photography of ${match.title} (${img.label}). White background, studio lighting, jewelry showcase, 1024x1024, high resolution.`;
          img.generatedUrl = await callImage2API(prompt);
          img.imageStatus = "success";
        } catch (e) {
          img.imageStatus = "failed";
          img.imageError = e instanceof Error ? e.message : String(e);
          img.generatedUrl = `/api/placeholder/gen_${etsyId}_${img.id}`;
        }
        results.push(img);
      }
      return reply(res, 200, { images: results });
    }

    // Step 3: toggle image selection
    if (url === "/api/step3/select-image") {
      const etsyId = String(parsed.etsyId ?? "");
      const imageId = String(parsed.imageId ?? "");
      const selected = parsed.selected !== false;
      const gen = state.generations.get(etsyId);
      if (!gen) return reply(res, 404, { error: "Generation not found" });
      const img = gen.images.find(im => im.id === imageId);
      if (!img) return reply(res, 404, { error: "Image not found" });
      img.selected = selected;
      return reply(res, 200, { ok: true, selected: img.selected });
    }

    // Step 3: select/deselect all images
    if (url === "/api/step3/select-all-images") {
      const etsyId = String(parsed.etsyId ?? "");
      const select = Boolean(parsed.select);
      const gen = state.generations.get(etsyId);
      if (!gen) return reply(res, 404, { error: "Generation not found" });
      gen.images.forEach(im => { im.selected = select; });
      return reply(res, 200, { ok: true });
    }

    // Step 3: generate text (on demand, user-clicked)
    if (url === "/api/step3/generate-text") {
      const etsyId = String(parsed.etsyId ?? "");
      const match = state.matches.find(m => m.etsyId === etsyId);
      const product = state.products.find(p => p.id === etsyId);
      if (!match) return reply(res, 404, { error: "Match not found" });
      const gen = ensureGeneration(etsyId, match);
      gen.textStatus = "generating";
      try {
        const prompt = [
          `You are an expert Etsy copywriter. Output ONLY the listing content in this exact format with no extra commentary:`,
          ``,
          `TITLE: [optimized Etsy title here — max 140 chars, SEO-friendly]`,
          `DESCRIPTION: [3-4 warm, inviting sentences describing the product]`,
          `TAGS: [13 comma-separated Etsy search tags]`,
          `PRICE: $[suggested USD retail price number only]`,
          ``,
          `Original Etsy title: ${product?.title ?? ""}`,
          `Wholesale cost: ${match.priceDisplay}, target margin: ${Math.round(match.profitMargin)}%`,
        ].join("\n");
        const raw = await callDeepseekAPI(prompt);
        const fallbackPrice = `$${(match.price * 3).toFixed(2)}`;
        const parsed = parseGeneratedText(raw, fallbackPrice);
        gen.optimizedTitle = parsed.optimizedTitle;
        gen.optimizedDescription = parsed.optimizedDescription;
        gen.optimizedTags = parsed.optimizedTags;
        gen.suggestedPrice = parsed.suggestedPrice;
        gen.textStatus = "success";
      } catch (e) {
        gen.textStatus = "failed";
        gen.textError = e instanceof Error ? e.message : String(e);
        gen.optimizedTitle = match.title.replace(/(Factory|Wholesale|Supplier|Bulk|Custom|OEM|Manufacturer)\s*/gi, "").trim();
        gen.optimizedDescription = `Beautiful ${product?.title ?? "product"} — handcrafted with premium materials. Perfect gift for any occasion. Ships fast.`;
        gen.optimizedTags = "handmade,jewelry,gift,vintage,minimalist,sterling silver,boho,unique,wedding,anniversary,birthday,christmas,valentine";
        gen.suggestedPrice = `$${(match.price * 3.5).toFixed(2)}`;
      }
      return reply(res, 200, serializeGen(gen));
    }

    // Step 3: manual edit
    if (url === "/api/step3/update-content") {
      const etsyId = String(parsed.etsyId ?? "");
      const field = String(parsed.field ?? "");
      const value = String(parsed.value ?? "");
      const match = state.matches.find(m => m.etsyId === etsyId);
      const gen = state.generations.get(etsyId) ?? (match ? ensureGeneration(etsyId, match) : null);
      if (!gen) return reply(res, 404, { error: "Generation not found" });
      const allowed = ["optimizedTitle", "optimizedDescription", "optimizedTags", "suggestedPrice"];
      if (allowed.includes(field)) {
        (gen as unknown as Record<string, string>)[field] = value;
      }
      return reply(res, 200, { ok: true });
    }

    // Step 4: mock publish
    if (url === "/api/step4/publish") {
      state.step = 4;
      const results = state.matches.map(m => {
        const gen = state.generations.get(m.etsyId);
        const firstImg = gen?.images[0];
        return {
          etsyId: m.etsyId,
          title: gen?.optimizedTitle || m.title,
          price: gen?.suggestedPrice || `$${(m.price * 3).toFixed(2)}`,
          imageReady: firstImg?.imageStatus === "success",
          textReady: gen?.textStatus === "success",
          status: (firstImg?.imageStatus === "success" && gen?.textStatus === "success") ? "ready" : "incomplete",
        };
      });
      return reply(res, 200, { ok: true, published: results.length, results });
    }
  }

  reply(res, 404, { error: "Not found" });
}

// ── Helpers ──────────────────────────────────────────────────

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function generateDemoProducts(keyword: string): EtsyProduct[] {
  const adjectives = ["Handmade","Vintage","Minimalist","Boho","Modern","Classic","Rustic","Elegant","Chunky","Delicate"];
  const materials = ["Sterling Silver","Gold Plated","Rose Gold","Oxidized Silver","925 Silver"];
  const types = ["Ring","Necklace","Bracelet","Earrings","Anklet","Pendant","Chain","Bangle","Cuff","Charm"];
  const products: EtsyProduct[] = [];
  for (let i = 0; i < 30; i++) {
    const adj = adjectives[i % adjectives.length]!;
    const mat = materials[i % materials.length]!;
    const typ = types[i % types.length]!;
    const title = `${adj} ${mat} ${typ} — ${keyword} Inspired, Gift for Her`;
    const price = parseFloat((8 + Math.random() * 120).toFixed(2));
    const sales = Math.floor(Math.random() * 4000);
    const favs = Math.floor(Math.random() * 2000);
    let score = 0;
    const reasons: string[] = [];
    if (sales > 2000) { score += 30; reasons.push("High sales volume"); }
    else if (sales > 500) { score += 20; reasons.push("Steady seller"); }
    else if (sales > 100) { score += 10; reasons.push("Consistent sales"); }
    if (favs > 1000) { score += 20; reasons.push("Very popular"); }
    else if (favs > 300) { score += 12; reasons.push("Popular item"); }
    if (price >= 15 && price <= 80) { score += 25; reasons.push("Sweet-spot price range"); }
    else if (price > 80 && price <= 200) { score += 15; reasons.push("Premium — good margin"); }
    products.push({ id: `etsy_${i}`, title, price, priceDisplay: `$${price.toFixed(2)}`, url: `https://etsy.com/listing/${1000000 + i}`, etsyImageUrl: "", sales, favorites: favs, score, scoreReasons: reasons, selected: false });
  }
  products.sort((a, b) => b.score - a.score);
  return products;
}

async function saveMatchesCache(matches: Match1688[]): Promise<void> {
  const dir = path.resolve(process.env.VERCEL ? "/tmp/etsyauto-output" : "output");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const header = "etsy_title,etsy_url,1688_title,1688_url,1688_price";
  const lines = matches.map(m => {
    const product = state.products.find(p => p.id === m.etsyId);
    return `"${(product?.title ?? "").replace(/"/g, '""')}","${product?.url ?? ""}","${m.title.replace(/"/g, '""')}","${m.url}","${m.priceDisplay}"`;
  });
  fs.writeFileSync(path.join(dir, "1688_matches.csv"), [header, ...lines].join("\n"), "utf-8");
}

// ══════════════════════════════════════════════════════════════

export function createEtsyautoServer(): http.Server {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("Server error:", err);
      if (!res.headersSent) reply(res, 500, { error: "Internal error" });
    });
  });
}

function startLocalServer(): void {
  const server = createEtsyautoServer();
  server.listen(PORT, () => {
    console.log("");
    console.log("╔══════════════════════════════════════════════╗");
    console.log("║   Etsy → 1688 Workflow Platform             ║");
    console.log("╚══════════════════════════════════════════════╝");
    console.log("");
    console.log(`   Open:  http://localhost:${PORT}`);
    console.log(`   IMAGE2:  ${IMAGE2_KEY ? "configured" : "not set"}`);
    console.log(`   DEEPSEEK: ${DEEPSEEK_KEY ? "configured" : "not set"}`);
    console.log("");
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startLocalServer();
}
