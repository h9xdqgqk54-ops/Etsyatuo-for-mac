# 商品工作台大改设计

日期：2026-05-22

## 目标

在 `Etsyauto 图片 Agent` 主工作台内完成批次级商品流程：

1. 为每张已通过并保存到 `图片输出` 的图片维护颜色、尺寸、材质、备注和英文款式名。
2. 使用 GPT5.5 生成更丰富的 Etsy 英文 listing 文案；颜色、尺寸、材质自然融合进 description，不再作为独立板块展示。
3. 按款式/尺寸行维护价格。人工输入人民币进货价、货类、包装、重量和尺寸后，后端按截图规则估算运费，并按 `(人民币进货价 + 运费) * 5` 同时输出 USD/GBP。
4. 点击“确认价格”只保存前端价格状态并导出 CSV/JSON 映射，不重命名输入图或输出图。

## Provider 边界

- GPT5.5 负责图片理解、prompt、英文款式名和 listing 文案。
- `gpt-image-2` / OpenAI Images edit 只负责最终图生图。
- 两套 API Key、Base URL 和模型配置彼此隔离。
- GPT5.5 默认 Base URL 为 `https://allin-api.com/v1`，默认模型为 `gpt-5.5`。

## 价格与运费

默认运费参数来自用户截图：

- 发货地：东莞市
- 目的地：美国[US]
- 包裹重量：2 KG
- 包裹尺寸：2 x 7 x 5 CM
- 带电子器件选择带电，其他选择普货
- 箱装选择标快普货
- 袋装选择服装专线

线路基准：

- 袋装 + 普货：云途全球服装专线挂号
- 箱装 + 普货：云途全球专线挂号（标快普货）
- 袋装 + 带电：云途全球专线挂号（标快带电）
- 箱装 + 带电：云途全球专线挂号（特快带电）

## API

- `GET /api/etsy-agent/desktop-batch/:batchId/workbench`
- `POST /api/etsy-agent/desktop-batch/:batchId/workbench/sync`
- `PATCH /api/etsy-agent/desktop-batch/:batchId/workbench/image-metas`
- `PATCH /api/etsy-agent/desktop-batch/:batchId/workbench/style-names`
- `POST /api/etsy-agent/desktop-batch/:batchId/workbench/style-names/generate`
- `POST /api/etsy-agent/desktop-batch/:batchId/workbench/calculate-prices`
- `PATCH /api/etsy-agent/desktop-batch/:batchId/workbench/prices`
- `POST /api/etsy-agent/desktop-batch/:batchId/workbench/confirm-prices`

## 验证

```bash
pnpm vitest run src/services/etsyImageAgent/__tests__/listingGenerationService.test.ts src/services/etsyImageAgent/__tests__/productWorkbenchService.test.ts src/services/etsyImageAgent/__tests__/uiDisclosure.test.ts --reporter=dot
pnpm typecheck
pnpm vitest run --reporter=dot
```
