/**
 * Step 2 — Etsy Product Selection
 *
 * Reads etsy_results.csv, scores each listing on sales volume, price
 * attractiveness, and favorites, then outputs selected_etsy.csv with
 * a human-readable suggested_reason for each pick.
 *
 * No API calls. No image/text generation.
 */

import csvParser from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ────────────────────────────────────────────────────

interface EtsyResult {
  etsy_title: string;
  etsy_url: string;
  etsy_price: string;
  etsy_sales: string;
  etsy_favorites: string;
}

interface SelectedItem {
  etsy_title: string;
  etsy_url: string;
  suggested_reason: string;
}

// ── Constants ────────────────────────────────────────────────

const INPUT_CSV = "etsy_results.csv";
const OUTPUT_DIR = "output";
const OUTPUT_CSV = "selected_etsy.csv";

/** Maximum number of items to select (top-N picks). */
const MAX_SELECTIONS = 30;

// ── Helpers ──────────────────────────────────────────────────

function parsePrice(raw: string): number {
  const cleaned = raw.replace(/[$,]/g, "").trim();
  const num = Number(cleaned);
  return Number.isNaN(num) || num < 0 ? 0 : num;
}

function parseIntSafe(raw: string): number {
  const num = Number(raw);
  return Number.isNaN(num) ? 0 : Math.max(0, num);
}

// ── Scorer ───────────────────────────────────────────────────

interface ScoredItem {
  item: EtsyResult;
  score: number;
  reasons: string[];
}

function scoreItem(item: EtsyResult): ScoredItem {
  const reasons: string[] = [];
  let score = 0;

  const price = parsePrice(item.etsy_price);
  const sales = parseIntSafe(item.etsy_sales);
  const favs = parseIntSafe(item.etsy_favorites);

  // Sales signal — strong indicator of demand
  if (sales >= 2000) {
    score += 30;
    reasons.push("high sales volume");
  } else if (sales >= 500) {
    score += 20;
    reasons.push("steady sales");
  } else if (sales >= 100) {
    score += 10;
    reasons.push("consistent seller");
  }

  // Favorites signal — indicates interest / wish-listing
  if (favs >= 1000) {
    score += 20;
    reasons.push("very popular (high favorites)");
  } else if (favs >= 300) {
    score += 12;
    reasons.push("popular (good favorites)");
  }

  // Price attractiveness for dropshipping arbitrage
  if (price >= 15 && price <= 80) {
    score += 25;
    reasons.push(`sweet-spot price range ($${price.toFixed(0)})`);
  } else if (price > 0 && price < 15) {
    score += 10;
    reasons.push("low price — easy impulse buy");
  } else if (price > 80 && price <= 200) {
    score += 15;
    reasons.push(`premium price ($${price.toFixed(0)}) — good margin potential`);
  } else if (price > 200) {
    score += 5;
    reasons.push("luxury item — niche but high margin");
  }

  // Title quality heuristic: longer titles tend to have better SEO
  const titleLen = item.etsy_title.length;
  if (titleLen > 40) {
    score += 8;
    reasons.push("well-written title (SEO-friendly)");
  } else if (titleLen > 15) {
    score += 4;
  }

  return { item, score, reasons };
}

// ── CSV Reader ───────────────────────────────────────────────

async function readEtsyResults(filePath: string): Promise<EtsyResult[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `File not found: ${filePath}\n` +
      `Run the Etsy crawler first to generate data.`,
    );
  }

  return new Promise((resolve, reject) => {
    const rows: EtsyResult[] = [];

    fs.createReadStream(filePath, "utf-8")
      .on("error", (err) => reject(new Error(`Read error: ${err.message}`)))
      .pipe(csvParser())
      .on("data", (row: Record<string, string>) => {
        rows.push({
          etsy_title: row["etsy_title"] ?? row["title"] ?? "",
          etsy_url: row["etsy_url"] ?? row["link"] ?? "",
          etsy_price: row["etsy_price"] ?? row["price"] ?? "0",
          etsy_sales: row["etsy_sales"] ?? "0",
          etsy_favorites: row["etsy_favorites"] ?? "0",
        });
      })
      .on("end", () => {
        if (rows.length === 0) {
          reject(new Error("CSV file is empty."));
        } else {
          resolve(rows);
        }
      })
      .on("error", (err) => reject(new Error(`Parse error: ${err.message}`)));
  });
}

// ── CSV Writer ───────────────────────────────────────────────

async function writeSelections(
  items: SelectedItem[],
  outputPath: string,
): Promise<void> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: "etsy_title", title: "etsy_title" },
      { id: "etsy_url", title: "etsy_url" },
      { id: "suggested_reason", title: "suggested_reason" },
    ],
  });

  await csvWriter.writeRecords(items);
}

// ── Core ─────────────────────────────────────────────────────

function selectTopItems(allItems: EtsyResult[]): SelectedItem[] {
  const scored: ScoredItem[] = allItems.map(scoreItem);
  scored.sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, MAX_SELECTIONS);

  return selected.map((s) => ({
    etsy_title: s.item.etsy_title,
    etsy_url: s.item.etsy_url,
    suggested_reason: s.reasons.join("; "),
  }));
}

// ── Main (CLI entry) ─────────────────────────────────────────

async function main(): Promise<void> {
  const inputPath = path.resolve(INPUT_CSV);
  const outputPath = path.resolve(OUTPUT_DIR, OUTPUT_CSV);

  console.log("╔══════════════════════════════════════╗");
  console.log("║     Etsy Product Selection Tool     ║");
  console.log("╚══════════════════════════════════════╝\n");

  if (!fs.existsSync(inputPath)) {
    console.error(`  Input file not found: ${inputPath}`);
    console.error(`  Run the Etsy crawler first.\n`);
    process.exit(1);
  }

  try {
    console.log(`  Reading: ${inputPath}`);
    const all = await readEtsyResults(inputPath);
    console.log(`  Loaded ${all.length} Etsy listings.\n`);

    console.log(`  Scoring and selecting top ${MAX_SELECTIONS}...`);
    const selected = selectTopItems(all);
    console.log(`  Selected ${selected.length} items.\n`);

    // Show picks
    for (let i = 0; i < Math.min(5, selected.length); i++) {
      const s = selected[i]!;
      console.log(`  ${i + 1}. ${truncate(s.etsy_title, 48)}`);
      console.log(`     → ${s.suggested_reason}`);
    }
    if (selected.length > 5) console.log(`  ... and ${selected.length - 5} more`);

    await writeSelections(selected, outputPath);
    console.log(`\n  Selections saved → ${outputPath}\n`);
  } catch (err) {
    console.error(`\n  Error: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 3) + "..." : text;
}

// ── Exports ──────────────────────────────────────────────────

export { readEtsyResults, scoreItem, selectTopItems, writeSelections };
export type { EtsyResult, SelectedItem };

const isMain =
  process.argv[1]?.endsWith("select_etsy.ts") ||
  process.argv[1]?.endsWith("select_etsy.js");
if (isMain) {
  main();
}
