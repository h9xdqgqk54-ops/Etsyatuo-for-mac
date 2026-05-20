# Etsy Image Agent Team Design

This project uses selected ideas from `msitarzewski/agency-agents` as engineering guidance only. It does not run a multi-agent framework.

## Adapted Roles
- AI Engineer: owns OpenAI image integration, reference-image generation flow, cost controls, retry behavior, and quality checks.
- Image Prompt Engineer: owns Etsy-specific structured prompts, prompt variants, negative constraints, and authenticity rules.
- Software Architect: owns modular-monolith boundaries and ADR-style decisions.
- Frontend Developer: owns the upload, grouping, task progress, and asset-library UI.
- Backend Architect: owns API design, upload parsing, local metadata storage, queueing, and file safety.
- Code Reviewer: used as a final checklist for maintainability, type safety, and tests.
- Security Engineer: used as a checklist for file upload validation, path traversal, API key leakage, concurrency, and cost abuse.
- Technical Writer: used for README, environment variables, local startup, and known limitations.

## Etsy-Specific Changes
- Generic AI production guidance is narrowed to Etsy listing photo generation.
- Prompt creativity is limited to background, lighting, scene, composition, and angle.
- Product body, color, material, brand, function, scale, accessories, and packaging must remain truthful to uploaded references.
- Quality and compliance results are stored with every asset.

## Not Adopted
- Runtime multi-agent orchestration: too complex for v1 and unnecessary for the current local TypeScript app.
- Microservices and full MLOps: the existing app is a small modular monolith.
- External issue, Slack, Notion, or SaaS automation: not needed and can introduce authorization risk.

## ADR Notes
- Task queue: v1 uses an in-process FIFO queue with JSON task metadata because the project has no database and runs locally.
- Asset storage: v1 uses local files under `storage/etsy-agent` plus JSON metadata; this can migrate later to object storage and a database.
- OpenAI integration: v1 uses environment variables and the official SDK; no API key is exposed to the browser.
- Etsy API: v1 keeps placeholders only because Etsy Open API v3 listing management requires OAuth authorization.

## License Source
Inspired by `agency-agents` by AgentLand Contributors, MIT License. See `THIRD_PARTY_NOTICES.md`.
