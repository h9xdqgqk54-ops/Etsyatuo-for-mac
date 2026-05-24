# Etsyauto Source Package

This archive is a source-ready copy of the Etsyauto project. It is intended to be unpacked, installed with npm or pnpm, and run locally without committing or sharing local secrets.

## Included

- TypeScript source in `src/`
- API entry in `api/`
- Static workbench pages and assets in `public/`
- Project docs and local verification scripts
- `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, and `vercel.json`
- `.env.example` with placeholder-only configuration

## Excluded

The package script intentionally excludes local runtime data, secrets, dependencies, and build output:

- `.env` and local `.env.*` files, except the placeholder-only `.env.example`
- API keys and server-side saved key config
- `.git/`, `node_modules/`, `.vercel/`
- `data/`, including `data/etsy-agent/secure-config.json` and `security-events.log`
- `storage/`, `output/`, `dist/`, `build/`, and `coverage/`
- local logs and OS metadata files

## Run From A Fresh Unzip

```bash
npm install
cp .env.example .env
npm run typecheck
npm test
npm run build
npm run verify:local
npm run dev
```

pnpm remains supported for users who prefer it:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm verify:local
pnpm dev
```

The default `.env.example` uses the mock image provider and does not require real API keys. Add real keys only in your private `.env` or deployment environment.

## Create The Deliverable Zip

From the Etsyauto project root:

```bash
npm run package:source
# or
pnpm package:source
```

This writes `dist/etsyauto-source-ready.zip` and verifies the selected entries before packaging.
