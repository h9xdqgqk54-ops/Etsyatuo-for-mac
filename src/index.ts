import "dotenv/config";

import prompts from "prompts";

import { searchEtsy } from "./apiCrawler";

import { saveToCSV } from "./save";

async function main() {
  // 用户输入关键词
  const response = await prompts({
    type: "text",

    name: "keyword",

    message: "请输入 Etsy 搜索关键词",
  });

  const keyword = response.keyword;

  if (!keyword) {
    console.log("未输入关键词");

    return;
  }

  console.log(`开始搜索: ${keyword}`);

  // 调用 Etsy API
  const data = await searchEtsy(keyword);

  console.log(`获取到 ${data.length} 条数据`);

  // 保存 CSV
  await saveToCSV(data);

  console.log("CSV 保存完成");
}

main();