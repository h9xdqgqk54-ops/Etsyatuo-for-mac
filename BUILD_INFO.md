# Build Info

- Package: `dist/delivery/Etsyauto-Mac.zip`
- SHA256: `0162ca06729419ab9189628849eacde40ee686893e0f7f855365f4f1e849b8ce`
- Size: `30,791,508 bytes`
- Built at: `2026-05-26 21:14:26 CST`
- Target platform: `darwin-arm64`
- Source branch: `codex/openai-agent`
- Source commit: `8d3b081ad25d38fa7ae51334948051fa10d16982`
- Node.js: `v25.9.0`
- npm: `11.12.1`
- Packager: `@yao-pkg/pkg@6.19.0`

## Source Snapshot

This package was built from the current local working tree snapshot of the Etsyauto project. The source working tree contained uncommitted changes at build time, and those changes were included in the temporary packaging snapshot:

```text
docs/superpowers/plans/2026-05-26-listing-category-p2-queue.md
docs/superpowers/plans/2026-05-26-listing-queue-protocol.md
public/etsy-image-agent.js
src/services/etsyImageAgent/__tests__/apiRouterSettings.test.ts
src/services/etsyImageAgent/__tests__/listingQueueService.test.ts
src/services/etsyImageAgent/__tests__/uiDisclosure.test.ts
src/services/etsyImageAgent/apiRouter.ts
src/services/etsyImageAgent/etsyCategoryReference.ts
src/services/etsyImageAgent/listingQueueService.ts
src/services/etsyImageAgent/types.ts
```

The approved CodeGraph index directory `.codegraph/` was initialized in the source project but excluded from the package.

## Verification

The package was verified on Apple Silicon macOS with:

```text
npm run typecheck
npm test
npm run build:cli
node scripts/package-mac-cli.mjs
node scripts/package-mac-delivery.mjs
node scripts/verify-mac-delivery.mjs dist/delivery/Etsyauto-Mac.zip
```

Verification covered:

- TypeScript typecheck.
- Vitest suite: 24 files, 165 tests.
- Mac zip extraction.
- `启动 Etsyauto.command --no-open --port 0`.
- `/etsy-image-agent`.
- `/settings/openai`.
- `/api/etsy-agent/config`.
- Bundled Mac `sharp` native runtime loading and PNG generation.
