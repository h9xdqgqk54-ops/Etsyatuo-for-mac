# Build Info

- Package: `dist/delivery/Etsyauto-Mac.zip`
- SHA256: `6f5f343fd490b1b66481548c2bca7b990c77db2e523afb7264ab34f87107a932`
- Size: `31,767,830 bytes`
- Built at: `2026-05-27 19:58:26 CST`
- Target platform: `darwin-arm64`
- Source branch: `codex/openai-agent`
- Source commit: `8d3b081ad25d38fa7ae51334948051fa10d16982`
- Node.js: `v25.9.0`
- npm: `11.12.1`
- Packager: `@yao-pkg/pkg@6.19.0`

## Fix Summary

This build fixes the Mac `REAL_GENERATION_DISABLED` failure seen during image review. The root cause was that the desktop launcher did not enable real image generation for the local Mac package, so users could save an OpenAI key in the web UI while the server-side `enableRealGeneration` flag stayed false. The launcher now defaults `IMAGE_AGENT_ENABLE_REAL_GENERATION=true` for desktop runs and still respects an explicit user override.

This build also keeps the Mac `SHARP_RUNTIME_MISSING` fix. Dynamic `import("sharp")` inside a `pkg` executable resolves from `/snapshot/...` and cannot find the sidecar `node_modules/sharp` folder shipped next to `Etsyauto`.

The runtime now resolves packaged `sharp` from the executable directory first, using `createRequire(path.join(path.dirname(process.execPath), "package.json"))("sharp")`, then falls back to local project resolution for development.

## Source Snapshot

This package was built from the current local working tree snapshot of the Etsyauto project. The source working tree contained uncommitted changes at build time, and those changes were included in the temporary packaging snapshot:

```text
docs/superpowers/plans/2026-05-26-listing-category-p2-queue.md
docs/superpowers/plans/2026-05-26-listing-queue-protocol.md
public/etsy-image-agent.js
src/cli/__tests__/launcher.test.ts
src/cli/launcher.ts
src/services/etsyImageAgent/__tests__/apiRouterSettings.test.ts
src/services/etsyImageAgent/__tests__/listingQueueService.test.ts
src/services/etsyImageAgent/__tests__/sharpRuntime.test.ts
src/services/etsyImageAgent/__tests__/uiDisclosure.test.ts
src/services/etsyImageAgent/apiRouter.ts
src/services/etsyImageAgent/etsyCategoryReference.ts
src/services/etsyImageAgent/listingQueueService.ts
src/services/etsyImageAgent/sharpRuntime.ts
src/services/etsyImageAgent/types.ts
```

The CodeGraph index directory `.codegraph/` was present in the source project and excluded from the package.

## Root Cause Evidence

Minimal `pkg` repro on Apple Silicon macOS:

```text
{
  "dynamicImport": {
    "ok": false,
    "code": "ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING",
    "message": "A dynamic import callback was not specified."
  },
  "sidecarRequire": {
    "ok": true
  }
}
```

This confirms dynamic import fails in the packaged snapshot, while sidecar `createRequire` from the executable directory succeeds.

## Verification

The source project was verified with:

```text
npm run typecheck
npm test
npm run build:cli
```

Results:

```text
Test Files  25 passed (25)
Tests       171 passed (171)
```

The Mac delivery package was verified from a temporary packaging snapshot with:

```text
npm run build:cli
node scripts/package-mac-cli.mjs
node scripts/verify-sharp-resolution-probe.mjs
node scripts/package-mac-delivery.mjs
node scripts/verify-mac-delivery.mjs dist/delivery/Etsyauto-Mac.zip
```

Verification covered:

- Mac zip extraction.
- `启动 Etsyauto.command --no-open --port 0`.
- `/etsy-image-agent`.
- `/settings/openai`.
- `/api/etsy-agent/config`.
- `/api/etsy-agent/image-provider-settings`, including `flags.realGenerationEnabled === true`.
- `/api/etsy-agent/diagnostics/sharp`, which calls the packaged app's real `loadSharp()` path.
