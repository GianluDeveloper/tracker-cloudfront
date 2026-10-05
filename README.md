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
- `MATOMO_REC_MODE` (optional, default `1`): `1` tracks only supported AI bots. Set `2` to enable automatic recording of normal visits/actions and supported AI bots, routed by Matomo to their respective reports. In automatic mode, the default user agent filter permits all non-empty user agents. Other values are rejected.
- `CLOUDFRONT_DEFAULT_PROTOCOL` (optional): Fallback protocol, e.g. `https`, used when a log entry has no `cs-protocol` or its value is empty/`-`.
- `CLOUDFRONT_DEFAULT_HOST` (optional): Fallback host, e.g. `www.example.com` (without protocol or path), used when a log entry has no `x-host-header` or its value is empty/`-`. Values present in the log always take precedence over these fallbacks. If either URL field is missing and its fallback is unset, the entry cannot be tracked.
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
- `USER_AGENT_ALLOWLIST_REGEX` (optional): Case-insensitive regex to permit user agents; non-matching entries are skipped. In bot-only mode (default), the allowlist is `ChatGPT-User|MistralAI-User|Gemini-Deep-Research|Claude-User|Perplexity-User|Google-NotebookLM|Google-GeminiNotebook`. With `MATOMO_REC_MODE=2`, it defaults to `.*`, permitting all non-empty user agents, including normal browsers and AI bots. Explicitly configured patterns still restrict tracking in either mode; remove an existing AI-only pattern or set it to `.*` to include normal visits.
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

## Recording Modes

Automatic recording is enabled only by setting `MATOMO_REC_MODE=2` in the Lambda environment variables. Leaving the variable unset, empty, or set to `1` preserves AI bot-only tracking.

| `MATOMO_REC_MODE` | Requests sent by the default user agent filter | Matomo recording mode                                      |
| ----------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| Unset or `1`      | Supported AI bot user agents                   | Bot only (`recMode=1`)                                     |
| `2`               | All non-empty user agents, including browsers  | Automatic visits/actions and AI bot tracking (`recMode=2`) |

To include normal visits alongside AI bots, configure the Lambda with:

```dotenv
MATOMO_URL=https://analytics.example.com
MATOMO_SITE_ID=1
MATOMO_REC_MODE=2
CLOUDFRONT_DEFAULT_PROTOCOL=https
CLOUDFRONT_DEFAULT_HOST=www.example.com
LOG_LEVEL=info
```

Replace the Matomo URL, site ID, and website host with your values. If `USER_AGENT_ALLOWLIST_REGEX` is already configured to allow only AI bots, remove that override or set it to `.*`; an explicit filter takes precedence in both modes. `GET` filtering and static asset exclusions still apply in automatic mode.

Normal visits appear in the standard visitor reports. Supported AI chatbot requests appear separately in **AI Assistants → AI Chatbots Overview**. For self-hosted Matomo, activate the `BotTracking` plugin to use the AI Chatbot reports. Use a Matomo version that supports the selected recording mode; see the [Tracking API](https://developer.matomo.org/api-reference/tracking-api#tracking-bots) and [AI Chatbot report setup](https://matomo.org/faq/reports/ai-chatbots-overview-report/).

## JSON Lines Logs

JSON Lines / NDJSON logs contain one JSON object per line, without an enclosing array or commas between lines. For example:

```jsonl
{"date":"2026-10-05","time":"10:00:00","cs-method":"GET","cs-uri-stem":"/chi-sono/","cs-uri-query":"-","cs(User-Agent)":"Mozilla/5.0%20(iPhone)%20Safari/604.1","sc-status":"200","sc-bytes":"4987","time-taken":"0.722"}
{"date":"2026-10-05","time":"10:00:01","cs-method":"GET","cs-uri-stem":"/","cs-uri-query":"-","cs(User-Agent)":"ChatGPT-User/1.0","sc-status":"200"}
```

These entries omit protocol and host, so set `CLOUDFRONT_DEFAULT_PROTOCOL` and `CLOUDFRONT_DEFAULT_HOST` as shown above. If a log entry contains `cs-protocol` or `x-host-header`, those values take precedence over the corresponding fallback. A missing URL field without a fallback causes the entry to be skipped.

Save local files as `.jsonl` or `.jsonl.gz`. S3 objects consumed by the Lambda must be gzip-compressed; configure the S3 trigger to include their prefix and `.gz` suffix.

## Build & Package

The Lambda is bundled with esbuild from `src/index.ts` (includes `@aws-sdk/client-s3`):

```sh
npm install
npm run typecheck   # optional: static checks
npm run build
zip -j dist/index.zip dist/index.js
```

`npm run build` outputs `dist/index.js` (a single bundled file). The separate `zip` command creates `dist/index.zip` with `index.js` at the archive root, ready to upload to AWS Lambda. The ZIP command requires the `zip` utility. Generated files under `dist/` are ignored by Git.

## Deploy (manual outline)

1. Create a Lambda (Node.js 24) with handler `index.handler`.
2. Set environment variables above.
3. Upload `dist/index.zip` from the build and packaging commands above.
4. Add an S3 trigger on your CloudFront log bucket for `ObjectCreated:*`.
5. Grant the Lambda permissions to read the bucket and write CloudWatch Logs.

Notes:

- The bundle is CommonJS; use the handler `index.handler`.
- Include the bundled file only (no `node_modules` needed). Rebuild and recreate the ZIP after code changes before uploading an updated Lambda.

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

- Reads S3 objects as gzip streams, splits into lines, and accepts either whitespace-separated CloudFront logs (with an optional `#Fields` header) or JSON Lines / NDJSON (one flat JSON object per line). Numeric JSON values are converted to strings; `-` and `null` become empty strings. Malformed lines are skipped and logged.
- Maps fields to Matomo payload:
  - Required: `idsite`, `rec:1`, `recMode` (from `MATOMO_REC_MODE`, default `1`), `url` (protocol+host+path+query), `cdt` (`Y-m-d H:i:s`), `ua`, `source:'CloudFront'`.
  - Optional: `http_status`, `bw_bytes`, `pf_srv`.
- Uses bot-only recording by default (`recMode=1`). When explicitly enabled with `MATOMO_REC_MODE=2`, normal requests are processed as visits/actions, while supported AI bots are processed separately in AI Chatbot reports. This does not force tracking of other crawlers excluded by Matomo. See the [Matomo Tracking API](https://developer.matomo.org/api-reference/tracking-api#tracking-bots).
- Filters requests by user agent using `USER_AGENT_ALLOWLIST_REGEX`; the default is an AI bot allowlist in bot-only mode and all non-empty user agents in automatic mode. Non-matching or empty user agents are skipped before payload assembly.
- Filters requests by HTTP method using `HTTP_METHOD_ALLOWLIST` (defaults to `GET` only).
- Skips entries whose URL matches `URL_EXCLUDE_REGEX` (defaults to common static assets like js/css, images, fonts, source maps).
- Batches requests (size `BATCH_SIZE`) and POSTs `{ "requests": ["?param=value", ...] }` to `/matomo.php` with retries/backoff and structured logs.
- Emits a processing summary with sent and skipped counts.

## Logging

Structured logs with `LOG_LEVEL` gating:

- S3: start/complete with bucket/key and line count.
- Parser: detected `#Fields`, malformed line count.
- Processor: each batch flush (index/size).
- Sender: start/success/non-2xx/timeout/retry/final failure with status/backoff.

### Troubleshooting missing Matomo data

Set `LOG_LEVEL=info` to see S3 line counts, batch sends, and the processing summary. `sent`, `pages`, and `documents` count entries assembled by the Lambda; they do not count records stored by Matomo. `skipped` counts entries rejected by filters or payload assembly, while malformed lines are reported separately by the parser.

An HTTP 200 response logged as `Matomo batch send success` does not prove that every entry was recorded. The sender also accepts an empty HTTP 200 response body and labels it `success`.

If batches are sent but no data appears:

1. For browser visits, confirm the deployed bundle contains support for `MATOMO_REC_MODE` and set that variable to `2`. Expanding `USER_AGENT_ALLOWLIST_REGEX` alone does not enable visit recording in bot-only mode.
2. Check the selected Matomo site's ID against `MATOMO_SITE_ID`, and select the date of the requests in the source logs. The `cdt` parameter preserves their UTC timestamp, rather than using the Lambda invocation time.
3. Look in the appropriate report: standard visitor reports for browser traffic, AI Chatbot reports for supported AI bots. Check the `BotTracking` plugin for self-hosted AI reports.
4. Check for explicit user agent filters, excluded URLs, and missing protocol/host fallbacks. Matomo may also exclude requests according to its own bot and traffic filtering rules.

## Local Debugging

Parse a local log (plain or `.gz`) into Matomo request strings (runs via `tsx` to execute TypeScript directly):

```sh
npm run parse:log -- path/to/cloudfront.log.gz
```

Outputs JSON `{ "requests": ["?idsite=...&url=...&rec=1", ...] }` to stdout.

For JSON Lines that omit protocol and host:

```sh
MATOMO_URL=https://analytics.example.com \
MATOMO_SITE_ID=1 \
MATOMO_REC_MODE=2 \
CLOUDFRONT_DEFAULT_PROTOCOL=https \
CLOUDFRONT_DEFAULT_HOST=www.example.com \
npm run parse:log -- path/to/cloudfront.jsonl
```

The local command also accepts `.jsonl.gz` and only generates requests; it does not send them. For the S3/Lambda pipeline, upload gzip-compressed logs. The runtime still applies `URL_EXCLUDE_REGEX`, so XML sitemaps are excluded by default.

## Tests & Lint

```sh
npm run format:check
npm run lint
npm test
npm run typecheck
```

All commands assume Node 24. Tests set `AWS_REGION=eu-central-1` via `tests/setup-env.ts` to satisfy the SDK; runtime uses the platform-provided region.
