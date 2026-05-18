import csvParser from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ────────────────────────────────────────────────────

interface SourceRow {
  etsy_title: string;
  "1688_title": string;
  "1688_url": string;
}

interface TaskRow {
  etsy_title: string;
  "1688_title": string;
  "1688_url": string;
  image2_prompt: string;
  deepseek_prompt: string;
  status: "pending";
}

// ── Constants ────────────────────────────────────────────────

const INPUT_CSV = "output/1688_matches.csv";
const OUTPUT_CSV = "output/future_generation_tasks.csv";

// ── Prompt Builders ──────────────────────────────────────────

/**
 * Build an Image2 prompt for product photography generation.
 *
 * Image2 is a text-to-image model. The prompt describes exactly
 * what the generated image should look like — product, angle,
 * background, lighting, resolution.
 */
function buildImage2Prompt(etsyTitle: string, title1688: string): string {
  const core = extractCoreName(etsyTitle, title1688);

  // Alternate backgrounds and angles for variety
  const styles = [
    `Professional product photography of ${core}. White background, front view, soft studio lighting, 1024x1024, high resolution, jewelry showcase style.`,
    `Clean e-commerce shot of ${core}. Isolated on pure white, 45-degree angle, diffused daylight, 1024x1024, ultra-detailed macro focus.`,
    `Lifestyle photo of ${core}. On a minimal concrete surface, natural window light, shallow depth of field, 1024x1024, warm and inviting mood.`,
    `Close-up detail shot of ${core}. Focus on texture and craftsmanship, dark elegant background, dramatic rim lighting, 1024x1024, premium luxury feel.`,
  ];

  return styles[hashStr(etsyTitle) % styles.length]!;
}

/**
 * Build a Deepseek prompt for Etsy listing copy generation.
 *
 * Deepseek is an LLM. This prompt instructs it to write
 * SEO-optimized Etsy copy given a product name and its
 * 1688 wholesale source title (material + keywords).
 */
function buildDeepseekPrompt(etsyTitle: string, title1688: string): string {
  return [
    `You are an expert Etsy copywriter. Write a complete product listing for the item below.`,
    ``,
    `Etsy product title: ${etsyTitle}`,
    `1688 source keywords: ${title1688}`,
    ``,
    `Generate the following in a structured format:`,
    `1. Optimized Etsy Title (max 140 chars, include key materials and style)`,
    `2. Product Description (3-4 sentences, highlight craftsmanship, materials, gift appeal, and comfort)`,
    `3. Search Tags (13 comma-separated tags for Etsy SEO)`,
    `4. Suggested Price Range (USD, based on similar Etsy listings)`,
    ``,
    `Use a warm, inviting tone. Emphasize handmade quality, unique design, and perfect gift potential.`,
  ].join("\n");
}

// ── Helpers ──────────────────────────────────────────────────

/** Extract a short core product name from whichever title is cleaner. */
function extractCoreName(etsyTitle: string, title1688: string): string {
  // Prefer the 1688 title if it's reasonably descriptive
  const candidate = title1688.length > 10 ? title1688 : etsyTitle;

  // Strip common 1688 marketing suffixes for a cleaner prompt
  return candidate
    .replace(
      /\b(Factory Direct|Wholesale|Supplier|Bulk Order|Custom OEM|ODM|In Stock|Hot Sell(ing)?|Manufacturer|Factory Price|Customizable|Custom Design|Outlet|Welcome|Direct Supply|High Quality)\b/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Deterministic hash for rotating style/background choices. */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ── CSV Reader ───────────────────────────────────────────────

async function readSourceCSV(filePath: string): Promise<SourceRow[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Input file not found: ${filePath}\n` +
      `Run the 1688 matcher first: pnpm tsx src/services/matcher1688/index.ts`,
    );
  }

  return new Promise((resolve, reject) => {
    const rows: SourceRow[] = [];

    fs.createReadStream(filePath, "utf-8")
      .on("error", (err) => reject(new Error(`Read error: ${err.message}`)))
      .pipe(csvParser())
      .on("data", (row: Record<string, string>) => {
        rows.push({
          etsy_title: row["etsy_title"] ?? "",
          "1688_title": row["1688_title"] ?? "",
          "1688_url": row["1688_url"] ?? "",
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

async function writeTaskCSV(tasks: TaskRow[], outputPath: string): Promise<void> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: "etsy_title", title: "etsy_title" },
      { id: "1688_title", title: "1688_title" },
      { id: "1688_url", title: "1688_url" },
      { id: "image2_prompt", title: "image2_prompt" },
      { id: "deepseek_prompt", title: "deepseek_prompt" },
      { id: "status", title: "status" },
    ],
  });

  await csvWriter.writeRecords(tasks);
}

// ── Core ─────────────────────────────────────────────────────

/**
 * Read 1688_matches.csv and produce a task list where every row
 * gets a pre-built Image2 prompt and Deepseek prompt, all with
 * status = "pending". No API calls are made.
 */
async function generateTasks(
  inputPath: string,
  outputPath: string,
): Promise<TaskRow[]> {
  // 1. Read source
  console.log(`  Reading: ${inputPath}`);
  const sources = await readSourceCSV(inputPath);
  console.log(`  Loaded ${sources.length} source rows.\n`);

  // 2. Build tasks (no API calls — prompt generation only)
  const tasks: TaskRow[] = sources.map((src, i) => {
    const image2 = buildImage2Prompt(src.etsy_title, src["1688_title"]);
    const deepseek = buildDeepseekPrompt(src.etsy_title, src["1688_title"]);

    const num = i + 1;
    console.log(`  [${String(num).padStart(3)}/${sources.length}] ${truncate(src["1688_title"] || src.etsy_title, 55)}`);

    return {
      etsy_title: src.etsy_title,
      "1688_title": src["1688_title"],
      "1688_url": src["1688_url"],
      image2_prompt: image2,
      deepseek_prompt: deepseek,
      status: "pending" as const,
    };
  });

  // 3. Write
  console.log(`\n  Writing: ${outputPath}`);
  await writeTaskCSV(tasks, outputPath);
  console.log(`  Done — ${tasks.length} task rows with status=pending.`);

  return tasks;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 3) + "..." : text;
}

// ── CLI Entry ────────────────────────────────────────────────

async function main(): Promise<void> {
  const inputPath = path.resolve(INPUT_CSV);
  const outputPath = path.resolve(OUTPUT_CSV);

  console.log("╔══════════════════════════════════════════╗");
  console.log("║     Future Generation Task Builder      ║");
  console.log("║     (prompts only — no API calls)       ║");
  console.log("╚══════════════════════════════════════════╝\n");

  if (!fs.existsSync(inputPath)) {
    console.error(`  Input file not found: ${inputPath}`);
    console.error(`  Run: pnpm tsx src/services/matcher1688/index.ts  first.\n`);
    process.exit(1);
  }

  try {
    const tasks = await generateTasks(inputPath, outputPath);

    // Summary
    const divider = "═".repeat(52);
    console.log(`\n${divider}`);
    console.log(`  Task List Summary`);
    console.log(divider);
    console.log(`  Total tasks:      ${tasks.length}`);
    console.log(`  Status:           all "pending"`);
    console.log(`  Image2 prompts:   ${tasks.length}  (ready for image gen)`);
    console.log(`  Deepseek prompts: ${tasks.length}  (ready for text gen)`);
    console.log(`  Output:           ${outputPath}`);
    console.log(divider);

    // Print one sample
    const sample = tasks[0]!;
    console.log(`\n  ── Sample Task ──`);
    console.log(`  etsy_title:       ${truncate(sample.etsy_title, 50)}`);
    console.log(`  1688_title:       ${truncate(sample["1688_title"], 50)}`);
    console.log(`  1688_url:         ${sample["1688_url"]}`);
    console.log(`  image2_prompt:    ${truncate(sample.image2_prompt, 70)}`);
    console.log(`  deepseek_prompt (first 3 lines):`);
    for (const line of sample.deepseek_prompt.split("\n").slice(0, 3)) {
      console.log(`    ${truncate(line, 66)}`);
    }
    console.log(`    ...`);
    console.log(`  status:           ${sample.status}`);
    console.log("");
  } catch (err) {
    console.error(`\n  Error: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
}

// ── Exports ──────────────────────────────────────────────────

export { buildDeepseekPrompt, buildImage2Prompt, generateTasks, readSourceCSV };
export type { SourceRow, TaskRow };

// Direct execution
const isMain =
  process.argv[1]?.endsWith("generate_tasks.ts") ||
  process.argv[1]?.endsWith("generate_tasks.js");
if (isMain) {
  main();
}
