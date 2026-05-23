# Remove Price Workbench And Configurable Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the price workbench end to end, remove the prompt input folder concept, and let users configure image input/output folders from the Etsy image agent UI.

**Architecture:** Keep the product workbench focused on image metadata, style names, and listing copy. Add a small persisted folder settings module that resolves image input/output directories from saved local settings first, then environment defaults, then desktop defaults. The desktop batch scan/generation code consumes that resolver and no longer exposes `promptDir`.

**Tech Stack:** TypeScript services, static HTML/vanilla JS frontend, Vitest, Playwright UI tests.

---

### Task 1: Add Red Tests For Removed Price Workbench

**Files:**
- Modify: `src/services/etsyImageAgent/__tests__/uiDisclosure.test.ts`
- Modify: `src/services/etsyImageAgent/__tests__/productWorkbenchApi.test.ts`
- Modify: `src/services/etsyImageAgent/__tests__/productWorkbenchService.test.ts`
- Delete later: `src/services/etsyImageAgent/__tests__/yunexpressFreightService.test.ts`

- [ ] Update UI tests so the HTML and runtime page must not contain `价格工作台`, `generatePricesBtn`, `confirmPriceNamesBtn`, `data-price-`, or price status stats.
- [ ] Update API tests so all price workbench endpoints return 404 and product workbench records do not include `priceRows`.
- [ ] Update service tests so sync/update/generation assertions cover only `imageMetas`, style names, and listing data.
- [ ] Run:

```bash
pnpm vitest run src/services/etsyImageAgent/__tests__/uiDisclosure.test.ts src/services/etsyImageAgent/__tests__/productWorkbenchApi.test.ts src/services/etsyImageAgent/__tests__/productWorkbenchService.test.ts --reporter=dot
```

Expected: fail because price UI/API/types still exist.

### Task 2: Add Red Tests For Folder Settings

**Files:**
- Modify: `src/services/etsyImageAgent/__tests__/apiRouterSettings.test.ts`
- Modify: `src/services/etsyImageAgent/__tests__/desktopBatchWorkflow.test.ts`
- Modify: `src/services/etsyImageAgent/__tests__/uiDisclosure.test.ts`

- [ ] Add API tests for `GET /api/etsy-agent/folder-settings` and `POST /api/etsy-agent/folder-settings`.
- [ ] Test that invalid/non-directory input/output paths return structured errors.
- [ ] Test that scan responses contain `inputDir` and `outputDir`, but not `promptDir`.
- [ ] Test that the frontend renders editable input/output folder fields and no prompt folder row.
- [ ] Run:

```bash
pnpm vitest run src/services/etsyImageAgent/__tests__/apiRouterSettings.test.ts src/services/etsyImageAgent/__tests__/desktopBatchWorkflow.test.ts src/services/etsyImageAgent/__tests__/uiDisclosure.test.ts --reporter=dot
```

Expected: fail because folder settings API and UI do not exist yet, and `promptDir` is still returned.

### Task 3: Implement Folder Settings

**Files:**
- Create: `src/services/etsyImageAgent/folderSettings.ts`
- Modify: `src/services/etsyImageAgent/config.ts`
- Modify: `src/services/etsyImageAgent/inputAssetRegistry.ts`
- Modify: `src/services/etsyImageAgent/desktopBatchWorkflow.ts`
- Modify: `src/services/etsyImageAgent/apiRouter.ts`
- Modify: `public/etsy-image-agent.html`

- [ ] Create a folder settings module that reads/writes JSON under the existing data root and returns `{ inputDir, outputDir, sources }`.
- [ ] Validate saved paths with `fs.existsSync`, `stat.isDirectory()`, input readability, and output writeability.
- [ ] Remove `promptDir` from folder resolver, scan return type, and desktop batch records.
- [ ] Add API routes for folder settings.
- [ ] Replace the “固定文件夹” UI with editable “图片输入目录” and “图片输出目录” fields plus save/scan buttons.
- [ ] Run Task 2 tests until green.

### Task 4: Remove Price Workbench Implementation

**Files:**
- Modify: `public/etsy-image-agent.html`
- Modify: `src/services/etsyImageAgent/apiRouter.ts`
- Modify: `src/services/etsyImageAgent/productWorkbenchService.ts`
- Modify: `src/services/etsyImageAgent/types.ts`
- Modify: `src/services/etsyImageAgent/promptProviders/types.ts`
- Modify: `src/services/etsyImageAgent/promptProviders/gpt55PromptProvider.ts`
- Delete: `src/services/etsyImageAgent/yunexpressFreightService.ts`
- Delete: `src/services/etsyImageAgent/__tests__/yunexpressFreightService.test.ts`

- [ ] Remove frontend price CSS, helpers, render block, buttons, and error messages.
- [ ] Remove price API imports and routes.
- [ ] Remove price rows/types and GPT5.5 price recommendation provider methods.
- [ ] Remove YunExpress simulated freight service and test file.
- [ ] Run Task 1 tests until green.

### Task 5: Documentation And Full Verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify if needed: `CODEX_HANDOFF.md`

- [ ] Remove `IMAGE_AGENT_PROMPT_EXPORT_DIR` and prompt-folder setup text.
- [ ] Document that input/output folders can be configured from the web UI.
- [ ] Run:

```bash
pnpm typecheck
pnpm vitest run --reporter=dot
```

- [ ] Restart or reuse the local dev server and verify in browser that the Etsy image agent page shows folder settings, does not show prompt input folder, and does not show price workbench.
