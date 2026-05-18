import csvParser from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ────────────────────────────────────────────────────

/** Raw row read from 1688_matches.csv */
interface MatchRecord {
  etsy_title: string;
  etsy_price: string;
  etsy_url: string;
  "1688_title": string;
  "1688_price": string;
  "1688_url": string;
}

/** Enriched row written to final_listing.csv */
interface FinalListing {
  etsy_price: string;
  etsy_url: string;
  "1688_title": string;
  "1688_url": string;
  image_path: string;
  optimized_title: string;
  optimized_description: string;
}

// ── Placeholder: Image2 API ──────────────────────────────────
//
// Image2 is a text-to-image generation service.
// In production, replace this function body with a real HTTP call:
//
//   const response = await fetch("https://api.image2.example/v1/generate", {
//     method: "POST",
//     headers: { "Authorization": `Bearer ${process.env.IMAGE2_API_KEY}` },
//     body: JSON.stringify({ prompt: promptText, style: "product", size: "1024x1024" }),
//   });
//   const data = await response.json();
//   return data.image_url;
//
// For now we return a simulated local path.

async function generateImage(
  _record: MatchRecord,
  index: number,
): Promise<string> {
  // Simulate API latency
  await sleep(50);

  // Simulated output — in production this would be a CDN URL
  const padded = String(index + 1).padStart(3, "0");
  return `images/product_${padded}.jpg`;
}

// ── Placeholder: Deepseek API ────────────────────────────────
//
// Deepseek is an LLM used for text optimization.
// In production, replace this function body with a real call:
//
//   import OpenAI from "openai";
//   const client = new OpenAI({
//     apiKey: process.env.DEEPSEEK_API_KEY,
//     baseURL: "https://api.deepseek.com/v1",
//   });
//   const completion = await client.chat.completions.create({
//     model: "deepseek-chat",
//     messages: [
//       { role: "system", content: "You are an Etsy SEO expert..." },
//       { role: "user", content: `Optimize this 1688 title for Etsy: ${record["1688_title"]}` },
//     ],
//   });
//   return {
//     title: completion.choices[0].message.content.match(/Title: (.+)/)?.[1] ?? "",
//     description: completion.choices[0].message.content.match(/Description: (.+)/s)?.[1] ?? "",
//   };
//
// For now we generate mock SEO-optimized text.

async function generateOptimizedContent(
  record: MatchRecord,
  index: number,
): Promise<{ title: string; description: string }> {
  // Simulate API latency
  await sleep(80);

  // Extract core product keywords from the 1688 title
  const core = record["1688_title"]
    .replace(/(Factory Direct|Wholesale|Supplier|Bulk Order|Custom OEM|ODM|In Stock|Hot Selling|Manufacturer|Factory Price|Customizable|Custom Design|Outlet|Welcome|Direct Supply)/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const templates = [
    {
      title: `Elegant ${core} | Handcrafted Jewelry Gift`,
      description: `Discover the timeless beauty of this ${core.toLowerCase()}. Crafted with premium materials for lasting brilliance, this piece makes the perfect gift for any occasion. Hypoallergenic and comfortable for daily wear.`,
    },
    {
      title: `${core} – Premium Quality, Fast Shipping`,
      description: `Upgrade your style with this stunning ${core.toLowerCase()}. Each piece is meticulously inspected for quality. Ideal for birthdays, anniversaries, holidays, or treating yourself. Ships within 24 hours.`,
    },
    {
      title: `${core} | Minimalist Design | Best Seller`,
      description: `A customer favorite! This ${core.toLowerCase()} combines modern design with classic charm. Lightweight, durable, and versatile — wear it alone or stack it. Satisfaction guaranteed.`,
    },
    {
      title: `Trending ${core} | Unique Statement Piece`,
      description: `Make a statement with this ${core.toLowerCase()}. Designed for those who appreciate fine craftsmanship, it features a unique finish that catches the light beautifully. Comes in gift-ready packaging.`,
    },
  ];

  const t = templates[index % templates.length]!;
  return { title: t.title, description: t.description };
}

// ── CSV Reader ───────────────────────────────────────────────

async function readMatchCSV(filePath: string): Promise<MatchRecord[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `File not found: ${filePath}\n` +
      `Run the 1688 matcher first to generate this file.`,
    );
  }

  return new Promise((resolve, reject) => {
    const records: MatchRecord[] = [];

    fs.createReadStream(filePath, "utf-8")
      .on("error", (err) => reject(new Error(`Read error: ${err.message}`)))
      .pipe(csvParser())
      .on("data", (row: Record<string, string>) => {
        records.push(normalizeRow(row));
      })
      .on("end", () => {
        if (records.length === 0) {
          reject(new Error("CSV file is empty."));
        } else {
          resolve(records);
        }
      })
      .on("error", (err) => reject(new Error(`Parse error: ${err.message}`)));
  });
}

function normalizeRow(row: Record<string, string>): MatchRecord {
  const keys: Record<string, string> = {};
  for (const k of Object.keys(row)) {
    keys[k.trim().toLowerCase()] = (row[k] ?? "").trim();
  }
  return {
    etsy_title: keys["etsy_title"] ?? "",
    etsy_price: keys["etsy_price"] ?? "0",
    etsy_url: keys["etsy_url"] ?? "",
    "1688_title": keys["1688_title"] ?? "",
    "1688_price": keys["1688_price"] ?? "0",
    "1688_url": keys["1688_url"] ?? "",
  };
}

// ── CSV Writer ───────────────────────────────────────────────

async function writeFinalCSV(
  listings: FinalListing[],
  outputPath: string,
): Promise<void> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: "etsy_price", title: "etsy_price" },
      { id: "etsy_url", title: "etsy_url" },
      { id: "1688_title", title: "1688_title" },
      { id: "1688_url", title: "1688_url" },
      { id: "image_path", title: "image_path" },
      { id: "optimized_title", title: "optimized_title" },
      { id: "optimized_description", title: "optimized_description" },
    ],
  });

  await csvWriter.writeRecords(listings);
  console.log(`\n  Final CSV saved → ${outputPath}`);
}

// ── Core Pipeline ────────────────────────────────────────────

/**
 * Read 1688 match results, generate images (Image2) and
 * optimized text (Deepseek), then write the final listing CSV.
 *
 * @param inputCSV  — path to 1688_matches.csv
 * @param outputCSV — path for final_listing.csv
 */
async function generateFinalListings(
  inputCSV: string,
  outputCSV: string,
): Promise<FinalListing[]> {
  // 1. Read input
  console.log(`  Reading: ${inputCSV}`);
  const matches = await readMatchCSV(inputCSV);
  console.log(`  Loaded ${matches.length} match records.`);

  // 2. Generate image + text for each record
  const listings: FinalListing[] = [];
  const total = matches.length;

  for (let i = 0; i < total; i++) {
    const rec = matches[i]!;
    const num = i + 1;

    // --- Image2 API call (simulated) ---
    const imagePath = await generateImage(rec, i);

    // --- Deepseek API call (simulated) ---
    const { title, description } = await generateOptimizedContent(rec, i);

    const listing: FinalListing = {
      etsy_price: rec.etsy_price,
      etsy_url: rec.etsy_url,
      "1688_title": rec["1688_title"],
      "1688_url": rec["1688_url"],
      image_path: imagePath,
      optimized_title: title,
      optimized_description: description,
    };

    listings.push(listing);

    // Progress log
    console.log(
      `  [${String(num).padStart(3)}/${total}] ` +
      `img=${imagePath} ` +
      `title="${truncate(title, 50)}"`,
    );
  }

  // 3. Write output
  await writeFinalCSV(listings, outputCSV);

  return listings;
}

// ── Helpers ──────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 3) + "..." : text;
}

// ── Main (CLI entry) ─────────────────────────────────────────

async function main(): Promise<void> {
  const inputCSV = path.resolve("output", "1688_matches.csv");
  const outputCSV = path.resolve("output", "final_listing.csv");

  console.log("╔══════════════════════════════════════╗");
  console.log("║  Image2 + Deepseek Pipeline (Mock)   ║");
  console.log("╚══════════════════════════════════════╝\n");

  // Guard
  if (!fs.existsSync(inputCSV)) {
    console.error(`  Input file not found: ${inputCSV}`);
    console.error(`  Run the 1688 matcher first (pnpm tsx src/services/matcher1688/index.ts)\n`);
    process.exit(1);
  }

  try {
    const listings = await generateFinalListings(inputCSV, outputCSV);

    // Summary
    console.log(`\n  ══════════════════════════════════════`);
    console.log(`  Pipeline complete — ${listings.length} listings`);
    console.log(`  ══════════════════════════════════════`);
    console.log(`  Image2 calls (simulated):   ${listings.length}`);
    console.log(`  Deepseek calls (simulated): ${listings.length}`);
    console.log(`  Output: ${outputCSV}\n`);
  } catch (err) {
    console.error(`  Error: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
}

// ── Exports ──────────────────────────────────────────────────

export { generateFinalListings, generateImage, generateOptimizedContent, readMatchCSV };
export type { FinalListing, MatchRecord };

// Direct execution
const isMain =
  process.argv[1]?.endsWith("image_and_text.ts") ||
  process.argv[1]?.endsWith("image_and_text.js");
if (isMain) {
  main();
}
