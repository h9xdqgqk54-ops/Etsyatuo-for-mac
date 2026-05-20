# Codex instructions for Etsyauto

Before editing files, read CODEX_HANDOFF.md and summarize the active task in 5 bullets.

Hard rules:
- Work only inside this repository.
- Do not create a sibling project.
- Do not commit unless explicitly asked.
- Do not write, print, or expose any real API key.
- Do not read or print .env lines containing ARK_API_KEY, OPENAI_API_KEY, or EAST_REASONING_API_KEY.
- API responses may only expose configured status, maskedKey, and fingerprint.

Current focus:
Fix local Doubao product_reference image generation.
Do not work on Vercel.
Fix Cloudflare Tunnel public reference image handling, preflight checks, and beginner-friendly UI errors.

Verification:
Run pnpm typecheck, pnpm test, pnpm build, and pnpm verify:local when possible.
If a command fails, report the exact failure.
