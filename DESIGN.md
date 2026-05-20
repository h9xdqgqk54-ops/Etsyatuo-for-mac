# Etsyauto 图片 Agent Design

## Product Shape

`/etsy-image-agent` is the primary image workbench. The page is an operational tool, not a marketing landing page: dense, scan-friendly, and built around the batch state.

The main flow is:

1. Scan fixed desktop folders.
2. Generate OpenAI image edits from same-name image and prompt pairs.
3. Review each candidate.
4. Approve to the desktop output folder or regenerate the single item.

`/asset-library` and `/settings/openai` are child pages. The old upload, grouping, task, public reference preflight, and multi-provider flows are not part of the active UI.

## OpenAI-only Provider

The image provider is OpenAI only. The app calls `client.images.edit` with:

- local input image file stream
- corresponding `.txt` prompt
- optional `baseURL` from `OPENAI_BASE_URL` or `/settings/openai` for OpenAI-compatible relay endpoints
- `model` from `OPENAI_IMAGE_MODEL`, default `gpt-image-2`
- `size` from `OPENAI_IMAGE_SIZE`, default `1024x1024`
- `quality` from `OPENAI_IMAGE_QUALITY`, default `low`
- optional `input_fidelity` from `OPENAI_IMAGE_INPUT_FIDELITY`, default `off` so relay endpoints that reject this parameter still work
- `output_format: "png"`
- `background: "opaque"`
- `n: 1`

The default edit request is non-streaming. It deliberately omits `stream`, `partial_images`, and `response_format` because relay endpoints often reject or mishandle optional GPT image parameters. Responses must contain base64 image data or a downloadable image URL; otherwise the provider returns `OPENAI_IMAGE_EMPTY_RESPONSE` and does not save a fake candidate.

No public image URL is needed. No tunnel is needed. `ARK_API_KEY` is not used by the image workflow. If the account cannot use `gpt-image-2`, or if organization verification, quota, or rate limits block the request, the UI shows a readable structured error and does not fallback to another model.

## Data Rules

The backend only reads:

- `~/Desktop/图片输入`
- `~/Desktop/提示词输入`
- `~/Desktop/图片输出`

Hidden files and unsupported extensions are ignored. Missing pairs, duplicate basenames, empty prompts, oversized images, unsupported MIME types, and missing files fail before generation.

Generated candidates are saved in the local asset library with metadata: `batchId`, `itemId`, `baseName`, `inputFileName`, `promptFileName`, `provider=openai`, `model`, `size`, `quality`, `promptHash`, and `reviewStatus=pending`. Approved images are copied to the output folder and removed from the candidate library.

## Security

OpenAI keys are sourced from `.env` or optional server process session memory. Base URL is sourced from `OPENAI_BASE_URL`, optional server process session memory, or the OpenAI SDK default. Input fidelity is sourced from `OPENAI_IMAGE_INPUT_FIDELITY` or optional server process session memory and defaults to `off`. The browser never stores keys in local storage or session storage, and API responses expose only configured state, masked key, fingerprint, and non-secret Base URL state.

For local development, `/settings/openai` is allowed to save a key, Base URL, and Input fidelity into server process memory by default so users can recover from placeholder `.env` values without editing files. Hosted deployments must opt in explicitly with `IMAGE_AGENT_ALLOW_WEB_KEY_CONFIG=true`; otherwise web-entered BYOK and OpenAI setting changes are blocked.
