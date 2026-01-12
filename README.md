# Matomo CloudFront Tracker

Serverless pipeline (TypeScript, Node 24) that consumes CloudFront access logs from S3, converts them to Matomo Measurement Protocol hits, and sends them in bulk to `/matomo.php`. Logs are streamed and gunzipped in memory-safe batches; required Matomo fields include URL, timestamp, user agent, and site ID.

## Requirements

- Node.js 24 for local tooling and bundling.
- Matomo instance and site ID.
- CloudFront log bucket with `ObjectCreated` events triggering the Lambda.

## Environment Variables

- `MATOMO_URL` (required): Base Matomo URL, e.g. `https://analytics.example.com` or `https://analytics.example.com/matomo`.
- `MATOMO_SITE_ID` (required): Matomo site ID (integer).
- `MATOMO_TIMEOUT_MS` (optional, default `5000`): HTTP timeout in ms.
- `MATOMO_TOKEN_AUTH` (optional, recommended): Matomo token; required when `cdt` is older than 24 hours (Matomo bulk import rule). Sent as `Authorization: Bearer <token>`.
- `BATCH_SIZE` (optional, default `20`): Hit count per Matomo batch.
- `DOCUMENT_REGEX` (optional): Case-insensitive regex to detect downloads; matching URLs add `download=<url>` to Matomo payloads. This regex runs against the full URL (`protocol://host/path?query`) and defaults to a modern/common set of extensions:
  - Documents: `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`
  - Data/text: `.csv`, `.json`, `.txt`, `.xml`
  - Ebooks: `.epub`, `.mobi`, `.azw3`
  - Media (audio/video): `.mp3`, `.mp4`, `.mpeg`, `.mpg`, `.webm`, `.mov`, `.avi`, `.ogg`, `.wav`, `.flac`
  - Archives: `.zip`, `.gz`, `.gzip`, `.tgz`, `.tar`, `.bz2`, `.tbz`, `.7z`, `.rar`
  - Installers/binaries: `.dmg`, `.exe`, `.msi`, `.apk`, `.jar`
  - Hashes/signatures: `.md5`, `.sig`

  Example: `^[^?]+\\.(?:pdf|zip|docx?)(?:\\?|$)`

- `LOG_LEVEL` (optional, default `warn`): `silent|error|warn|info|debug`.
- `USER_AGENT_ALLOWLIST_REGEX` (optional): Case-insensitive regex to permit user agents; non-matching entries are skipped. Defaults to an allowlist for `ChatGPT-User|MistralAI-User|Gemini-Deep-Research|Claude-User|Perplexity-User|Google-NotebookLM|Devin`.
- `HTTP_METHOD_ALLOWLIST` (optional, default `GET`): Comma-separated list of HTTP methods to track (e.g. `GET,POST`); empty/unset uses the default. Requires `cs-method` to be present in the parsed log entry (via CloudFront `#Fields` or default field order).
- `URL_EXCLUDE_REGEX` (optional): Case-insensitive regex to skip tracking for matching URLs. This regex runs against the full URL (`protocol://host/path?query`) and defaults to excluding common static assets and non-page resources:
  - Frontend assets: `.css`, `.js`, `.mjs`
  - Source maps: `.map`
  - Data/config: `.json`, `.xml`, `.webmanifest`, `.manifest`
  - Feeds: `.rss`, `.atom`
  - WebAssembly: `.wasm`
  - Text: `.txt`
  - Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.svg`, `.ico`, `.bmp`, `.tif`, `.tiff`
  - Fonts: `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`

  Example: `^[^?]+\\.(?:css|js|png)(?:\\?|$)`

  Note: If a URL matches `URL_EXCLUDE_REGEX`, it is skipped even if it also matches `DOCUMENT_REGEX` (i.e. it will not be tracked as a download).

## Build & Package

The Lambda is bundled with esbuild from `src/index.ts` (includes `@aws-sdk/client-s3`):

```sh
npm install
npm run typecheck   # optional: static checks
npm run build
```

Outputs `dist/index.js` (single bundled file). Upload this file as your Lambda handler source (entry: `index.handler`). If your deployment method requires an archive, zip `dist/index.js` yourself before upload.

## Deploy (manual outline)

1. Create a Lambda (Node.js 24) with handler `index.handler`.
2. Set environment variables above.
3. Upload `dist/index.js` from `npm run build`.
4. Add an S3 trigger on your CloudFront log bucket for `ObjectCreated:*`.
5. Grant the Lambda permissions to read the bucket and write CloudWatch Logs.

Notes:

- The bundle is an ES module; ensure the handler is `index.handler` and that `NODE_OPTIONS` is unset unless required by your environment.
- Include the bundled file only (no `node_modules` needed). If your deployment tooling expects a zip, `zip -j lambda.zip dist/index.js` and upload that archive.

Example IAM policy for the Lambda execution role (adjust bucket ARN):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::your-cf-log-bucket/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

Example S3 event notification (console or IaC) for the log bucket:

- Event types: `s3:ObjectCreated:*`
- Prefix: (optional) your CloudFront log prefix, e.g. `AWSLogs/`
- Suffix: `.gz`
- Destination: your Lambda ARN

Example CloudFront logging fields (set on the distribution) to cover required/optional payloads:

- Enable standard CloudFront access logs to S3 (gzip on).
- Include these fields (either via `#Fields` header or default order): `date`, `time`, `cs-method`, `cs-protocol`, `x-host-header`, `cs-uri-stem`, `cs-uri-query`, `sc-status`, `time-taken`, `sc-bytes`, `cs(User-Agent)`.
- Ensure the log path/prefix matches your S3 trigger filters (e.g. suffix `.gz`).

## Runtime Behavior

- Reads S3 objects as gzip streams, splits into lines, applies `#Fields` header when present, and skips malformed lines (logged).
- Maps fields to Matomo payload:
  - Required: `idsite`, `rec:1`, `recMode:1`, `url` (protocol+host+path+query), `cdt` (`Y-m-d H:i:s`), `ua`, `source:'CloudFront'`.
  - Optional: `http_status`, `bw_bytes`, `pf_srv`.
- Filters requests by user agent using `USER_AGENT_ALLOWLIST_REGEX`; entries are skipped silently before payload assembly when the allowlist is configured (defaults on). If no allowlist is set, empty user agents are allowed.
  <<<<<<< HEAD
- # Filters requests by HTTP method using `HTTP_METHOD_ALLOWLIST` (defaults to `GET` only).
- Skips entries whose URL matches `URL_EXCLUDE_REGEX` (defaults to common static assets like js/css, images, fonts, source maps).
  > > > > > > > a782973 (Exclude static files (css, js, images, ...) by default)
- Batches requests (size `BATCH_SIZE`) and POSTs `{ "requests": ["?param=value", ...] }` to `/matomo.php` with retries/backoff and structured logs.
- Emits a processing summary with sent and skipped counts.

## Logging

Structured logs with `LOG_LEVEL` gating:

- S3: start/complete with bucket/key and line count.
- Parser: detected `#Fields`, malformed line count.
- Processor: each batch flush (index/size).
- Sender: start/success/non-2xx/timeout/retry/final failure with status/backoff.

## Local Debugging

Parse a local log (plain or `.gz`) into Matomo request strings (runs via `tsx` to execute TypeScript directly):

```sh
npm run parse:log -- path/to/cloudfront.log.gz
```

Outputs JSON `{ "requests": ["?idsite=...&url=...&rec=1", ...] }` to stdout.

## Tests & Lint

```sh
npm run format:check
npm run lint
npm test
npm run typecheck
```

All commands assume Node 24. Tests set `AWS_REGION=eu-central-1` via `tests/setup-env.ts` to satisfy the SDK; runtime uses the platform-provided region.
