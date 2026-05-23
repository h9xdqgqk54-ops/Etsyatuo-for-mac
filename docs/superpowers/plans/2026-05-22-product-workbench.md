# Product Workbench Implementation Plan

> 当前计划已按 2026-05-22 的后续确认更新：不再做图片重命名，文本/视觉任务改为 GPT5.5，OpenAI Images edit 继续隔离负责 `gpt-image-2` 图生图。

## Goal

把 `public/etsy-image-agent.html` 内的商品区升级为商品工作台：

- GPT5.5 生成 prompt、款式英文名和 listing 文案。
- OpenAI Image / `gpt-image-2` 只生成图片。
- 每个 approved 输出图形成一个款式/尺寸价格行。
- 前端人工输入人民币进货价、货类、包装、重量和尺寸。
- 后端按截图运费规则估算运费，并按 `(人民币进货价 + 运费) * 5` 输出 USD/GBP。
- 确认价格保存工作台状态并导出 CSV/JSON，不重命名输入图或输出图。

## Tasks

- [x] 新增 GPT5.5 provider，并把 prompt、listing、style name 生成链路切到 GPT5.5。
- [x] 保留 OpenAI Image provider 隔离，继续只调用 `gpt-image-2` 图生图。
- [x] 新增商品工作台服务与 API：image metas、style names、prices、confirm-prices。
- [x] 改造价格计算：支持前端人工输入进货价、重量、尺寸、包装、货类，并同时输出 USD/GBP。
- [x] 移除确认价格时重命名图片的设计。
- [x] 改造主工作台和 Provider 设置页，清理用户可见的旧 provider 文案。
- [x] 增加服务层、API 和 Playwright UI 运行时测试。

## Verification

```bash
pnpm vitest run src/services/etsyImageAgent/__tests__/uiDisclosure.test.ts src/services/etsyImageAgent/__tests__/gpt55ProviderMigration.test.ts src/services/etsyImageAgent/__tests__/productWorkbenchService.test.ts src/services/etsyImageAgent/__tests__/productWorkbenchApi.test.ts --reporter=dot
pnpm vitest run src/services/etsyImageAgent/__tests__/secureConfig.test.ts src/services/etsyImageAgent/__tests__/apiRouterSettings.test.ts src/services/etsyImageAgent/__tests__/promptGenerationService.test.ts src/services/etsyImageAgent/__tests__/listingGenerationService.test.ts src/services/etsyImageAgent/__tests__/desktopBatchWorkflow.test.ts --reporter=dot
pnpm typecheck
pnpm vitest run --reporter=dot
```
