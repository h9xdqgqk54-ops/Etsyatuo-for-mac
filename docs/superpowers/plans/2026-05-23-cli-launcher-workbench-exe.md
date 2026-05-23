# CLI Launcher Workbench EXE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-friendly CLI launcher that starts the existing Etsyauto local server, opens the browser workbench, and can be packaged as a Windows `.exe` without requiring the end user to install Node manually.

**Architecture:** Keep the current web workbench as the primary UI. Add a small CLI entrypoint that sets portable data/storage directories, finds an available port, starts `createEtsyautoServer()`, opens the default browser, and keeps the process alive until the user closes the command window. Add build/package scripts that bundle the TypeScript entrypoint and static assets for Windows packaging.

**Tech Stack:** Node.js, TypeScript, Vitest, existing HTTP server, `tsx` for development, `@yao-pkg/pkg` for Windows executable packaging.

---

### Task 1: Make Server Startup Reusable

**Files:**
- Modify: `src/services/app_server.ts`
- Test: `src/services/__tests__/appServer.test.ts`

- [ ] Add a test that imports server startup helpers and verifies `listenEtsyautoServer({ port: 0 })` returns the actual bound port and closes cleanly.
- [ ] Refactor `src/services/app_server.ts` so the fixed local dev startup uses an exported `listenEtsyautoServer()` helper.
- [ ] Keep default `pnpm dev` behavior on port `3456`.

### Task 2: Add CLI Launcher

**Files:**
- Create: `src/cli/launcher.ts`
- Test: `src/cli/__tests__/launcher.test.ts`

- [ ] Add tests for argument parsing: `--port`, `--host`, `--no-open`, `--help`.
- [ ] Add tests for portable data env setup on Windows-like and non-Windows-like environments.
- [ ] Add tests that browser opener selects `cmd /c start` on Windows, `open` on macOS, and `xdg-open` on Linux.
- [ ] Implement launcher helpers and `runCliLauncher()`.
- [ ] Use dynamic import for `../services/app_server.js` after env setup so `etsyAgentConfig` sees portable data paths.

### Task 3: Add Build and Packaging Scripts

**Files:**
- Modify: `package.json`
- Create: `scripts/build-cli.mjs`
- Create: `scripts/package-win-cli.mjs`
- Modify: `.gitignore`

- [ ] Add a script that builds the CLI launcher into `dist/cli/etsyauto-launcher.cjs`.
- [ ] Add a package script that calls `@yao-pkg/pkg` for a Windows x64 output path under `dist/win/Etsyauto.exe`.
- [ ] Include `public/**/*` as package assets so the browser workbench is available after packaging.
- [ ] Ignore generated desktop package output.

### Task 4: Document Windows Use

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

- [ ] Document local dev launch with `pnpm desktop:dev`.
- [ ] Document Windows packaging with `pnpm package:win`.
- [ ] Explain that the `.exe` opens the browser workbench and stores data under `%APPDATA%/Etsyauto`.
- [ ] Explain that API keys are configured in the Provider settings page and should not be baked into the executable.

### Task 5: Verify

**Commands:**
- `pnpm vitest run src/services/__tests__/appServer.test.ts src/cli/__tests__/launcher.test.ts --reporter=dot`
- `pnpm typecheck`
- `pnpm vitest run --reporter=dot`
- `pnpm desktop:dev -- --no-open --port 0` smoke test, then terminate the process.
