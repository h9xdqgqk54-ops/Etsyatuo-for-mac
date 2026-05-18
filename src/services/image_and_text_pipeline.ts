import csvParser from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ────────────────────────────────────────────────────

/** Generic row — preserves all original columns for pass-through. */
type InputRow = Record<string, string>;

/** Original row plus two generated columns. */
interface OutputRow extends Record<string, string> {
  generated_image: string;
  generated_text: string;
}

// ── Constants ────────────────────────────────────────────────

const INPUT_CSV = "output/final_listing.csv";
const OUTPUT_CSV = "output/final_listing_with_media.csv";

// ══════════════════════════════════════════════════════════════
//  PLACEHOLDER: Image2 API
// ══════════════════════════════════════════════════════════════
//
// Image2 generates product images from a text prompt.
//
// TO REPLACE WITH REAL API:
//
//   async function generateImage(prompt: string): Promise<string> {
//     const res = await fetch("https://api.image2.example/v1/generate", {
//       method: "POST",
//       headers: {
//         "Authorization": `Bearer ${process.env.IMAGE2_API_KEY}`,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({
//         prompt,
//         style: "product",
//         width: 1024,
//         height: 1024,
//       }),
//     });
//     if (!res.ok) throw new Error(`Image2 API error: ${res.status}`);
//     const data = await res.json();
//     // Download the image and save locally, or return the CDN URL
//     return data.url;  // or local path after download
//   }
//
// The prompt is built from the 1688_title field (or another column).

async function generateImage(
  row: InputRow,
  index: number,
): Promise<string> {
  // ── Simulated latency ──
  await sleep(30);

  // ── Build prompt from available fields ──
  const productName = row["1688_title"] ?? row["etsy_title"] ?? "product";
  const shortName = productName.slice(0, 60);

  // ── Simulated output ──
  // In production this would be the downloaded file path or CDN URL.
  const padded = String(index + 1).padStart(4, "0");
  const slug = shortName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `images/generated/product_${padded}_${slug}.jpg`;
}

// ══════════════════════════════════════════════════════════════
//  PLACEHOLDER: Deepseek API
// ══════════════════════════════════════════════════════════════
//
// Deepseek is an LLM used to generate listing copy.
//
// TO REPLACE WITH REAL API:
//
//   import OpenAI from "openai";
//
//   const client = new OpenAI({
//     apiKey: process.env.DEEPSEEK_API_KEY,
//     baseURL: "https://api.deepseek.com/v1",
//   });
//
//   async function generateText(productName: string): Promise<string> {
//     const completion = await client.chat.completions.create({
//       model: "deepseek-chat",
//       messages: [
//         {
//           role: "system",
//           content: "You are a professional Etsy copywriter. Write a compelling product description in 2-4 sentences that highlights the product features, materials, and gift appeal. Use a warm, inviting tone.",
//         },
//         {
//           role: "user",
//           content: `Write an Etsy product description for: ${productName}`,
//         },
//       ],
//       temperature: 0.7,
//       max_tokens: 300,
//     });
//     return completion.choices[0]?.message?.content ?? "";
//   }
//
// For now we return simulated copy.

async function generateText(
  row: InputRow,
  index: number,
): Promise<string> {
  // ── Simulated latency ──
  await sleep(40);

  // ── Build product identifier ──
  const productName = row["1688_title"] ?? row["etsy_title"] ?? "this product";

  // ── Simulated descriptions (rotating pool) ──
  const templates = [
    `Deepseek generated description for "${productName}": This exquisite piece features premium craftsmanship with attention to every detail. Made from high-quality materials, it offers both durability and elegance. Perfect for daily wear or special occasions.`,
    `Deepseek generated description for "${productName}": Elevate your style with this stunning accessory. Each item is carefully inspected to meet the highest standards. Lightweight, comfortable, and designed to impress — a must-have addition to any collection.`,
    `Deepseek generated description for "${productName}": Handcrafted with passion, this piece blends modern design with timeless appeal. The unique finish catches light beautifully from every angle. Comes in gift-ready packaging — ideal for birthdays, anniversaries, or any celebration.`,
    `Deepseek generated description for "${productName}": Discover why this is one of our bestselling items. Premium materials ensure long-lasting shine and comfort for all-day wear. Whether treating yourself or someone special, this piece delivers unmatched value.`,
    `Deepseek generated description for "${productName}": A versatile statement piece that transitions effortlessly from day to night. The meticulous detailing and superior finish set it apart. Hypoallergenic and gentle on skin — designed for those who refuse to compromise on quality.`,
  ];

  return templates[index % templates.length]!;
}

// ── Helpers ──────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── CSV Reader ───────────────────────────────────────────────

async function readCSV(filePath: string): Promise<InputRow[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Input file not found: ${filePath}\n` +
      `Run the previous pipeline step first.`,
    );
  }

  return new Promise((resolve, reject) => {
    const records: InputRow[] = [];

    fs.createReadStream(filePath, "utf-8")
      .on("error", (err) => reject(new Error(`Read error: ${err.message}`)))
      .pipe(csvParser())
      .on("data", (row: InputRow) => records.push(row))
      .on("end", () => {
        if (records.length === 0) {
          reject(new Error("CSV file is empty — nothing to process."));
        } else {
          resolve(records);
        }
      })
      .on("error", (err) => reject(new Error(`Parse error: ${err.message}`)));
  });
}

// ── CSV Writer ───────────────────────────────────────────────

async function writeCSV(
  rows: OutputRow[],
  outputPath: string,
): Promise<void> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Derive headers: all keys from the first row, with generated_image
  // and generated_text placed last.
  const allKeys = Object.keys(rows[0] ?? {});
  const fixedKeys = ["generated_image", "generated_text"];
  const passthroughKeys = allKeys.filter((k) => !fixedKeys.includes(k));

  const header = [...passthroughKeys, ...fixedKeys].map((id) => ({
    id,
    title: id,
  }));

  const csvWriter = createObjectCsvWriter({ path: outputPath, header });
  await csvWriter.writeRecords(rows);
}

// ── Core Pipeline ────────────────────────────────────────────

/**
 * Read final_listing.csv, call Image2 + Deepseek (simulated) for each row,
 * and write the enriched result to final_listing_with_media.csv.
 *
 * @returns the complete list of output rows.
 */
async function runPipeline(
  inputPath: string,
  outputPath: string,
): Promise<OutputRow[]> {
  // 1. Read
  console.log(`  Reading: ${inputPath}`);
  const rows = await readCSV(inputPath);
  console.log(`  Loaded ${rows.length} rows.\n`);

  const outputRows: OutputRow[] = [];
  const total = rows.length;

  // 2. Process each row
  for (let i = 0; i < total; i++) {
    const row = rows[i]!;
    const num = i + 1;

    // --- Image2 API call (simulated) ---
    const generatedImage = await generateImage(row, i);

    // --- Deepseek API call (simulated) ---
    const generatedText = await generateText(row, i);

    // Build output: all original fields + two new columns
    const out: OutputRow = {
      ...row,
      generated_image: generatedImage,
      generated_text: generatedText,
    };

    outputRows.push(out);

    // Progress log
    const label = (row["1688_title"] ?? row["etsy_title"] ?? `item ${num}`).slice(0, 45);
    console.log(`  [${String(num).padStart(3)}/${total}] ${label}`);
    console.log(`         img  → ${generatedImage}`);
    console.log(`         text → ${generatedText.slice(0, 80)}...`);
  }

  // 3. Write
  console.log(`\n  Writing: ${outputPath}`);
  await writeCSV(outputRows, outputPath);
  console.log(`  Done — ${outputRows.length} rows written.`);

  return outputRows;
}

// ── Main (CLI entry) ─────────────────────────────────────────

async function main(): Promise<void> {
  const inputPath = path.resolve(INPUT_CSV);
  const outputPath = path.resolve(OUTPUT_CSV);

  console.log("╔══════════════════════════════════════════╗");
  console.log("║   Image2 + Deepseek Pipeline (Mock)     ║");
  console.log("╚══════════════════════════════════════════╝\n");

  if (!fs.existsSync(inputPath)) {
    console.error(`  Input file not found: ${inputPath}`);
    console.error(`  Run: pnpm tsx src/services/image_and_text.ts  first.\n`);
    process.exit(1);
  }

  try {
    const result = await runPipeline(inputPath, outputPath);

    const divider = "═".repeat(52);
    console.log(`\n${divider}`);
    console.log(`  Pipeline Summary`);
    console.log(divider);
    console.log(`  Rows processed:         ${result.length}`);
    console.log(`  Image2 calls (mock):    ${result.length}`);
    console.log(`  Deepseek calls (mock):  ${result.length}`);
    console.log(`  Output: ${outputPath}`);
    console.log(divider);

    // Show first sample
    if (result.length > 0) {
      const s = result[0]!;
      console.log(`\n  ── First Row Sample ──`);
      console.log(`  generated_image:  ${s.generated_image}`);
      console.log(`  generated_text:   ${s.generated_text.slice(0, 100)}...`);
    }
    console.log("");
  } catch (err) {
    console.error(`\n  Pipeline failed: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
}

// ── Exports ──────────────────────────────────────────────────

export { generateImage, generateText, readCSV, runPipeline, writeCSV };
export type { InputRow, OutputRow };

// Direct execution
const isMain =
  process.argv[1]?.endsWith("image_and_text_pipeline.ts") ||
  process.argv[1]?.endsWith("image_and_text_pipeline.js");
if (isMain) {
  main();
}
