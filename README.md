# Matomo CloudFront Tracker

Serverless pipeline (TypeScript, Node 24) that consumes CloudFront access logs from S3, converts them to Matomo Measurement Protocol hits, and sends them in bulk to `/matomo.php`. Logs are streamed and gunzipped in memory-safe batches; required Matomo fields include URL, timestamp, user agent, and site ID.

## Requirements

- Node.js 24.5 or newer for local tooling and bundling (Lambda runtime: Node.js 24).
- Matomo instance and site ID.
- CloudFront log bucket with `ObjectCreated` events triggering the Lambda.

## Environment Variables

- `MATOMO_URL` (required): Base Matomo URL, e.g. `https://analytics.example.com` or `https://analytics.example.com/matomo`.
- `MATOMO_SITE_ID` (required): Matomo site ID (integer).
- `MATOMO_TIMEOUT_MS` (optional, default `5000`): HTTP timeout in ms.
- `MATOMO_TOKEN_AUTH` (optional, recommended): Matomo token; required when `cdt` is older than 24 hours (Matomo bulk import rule), or when `CLOUDFRONT_BEHIND_CLOUDFLARE` is enabled. For client IP overrides, the token must have write or admin permission for the Matomo site. Sent as the top-level `token_auth` in the bulk JSON body and as `Authorization: Bearer <token>` for compatibility.
- `MATOMO_REC_MODE` (optional, default `1`): `1` tracks bots only; `2` also includes normal visits/actions. With `MATOMO_BOT_TRACKING_MODE=native`, bots are limited to supported AI assistants and use Matomo's separate AI reports. With `visits`, detected bots use the standard visitor reports, including Googlebot and ChatGPT. Other values are rejected.
- `MATOMO_BOT_TRACKING_MODE` (optional, default `native`): `native` preserves Matomo's AI bot recording. Set `visits` to record all bots detected by this tracker as visits/actions and label each request with its probable bot identity. Requires both dimension IDs below. Values are trimmed and case-insensitive; other values are rejected.
- `MATOMO_BOT_STATUS_DIMENSION_ID` (required with `visits`): ID of an active, **Action** scoped Custom Dimension for this Matomo site, such as `Traffic type`. Values are `Bot` or `Not detected`.
- `MATOMO_BOT_NAME_DIMENSION_ID` (required with `visits`): ID of another active, **Action** scoped Custom Dimension, such as `Bot name`. Values include `Googlebot`, `ChatGPT-User`, `GPTBot`, `Unknown bot`, and `Not detected`. Both IDs must be integers from `1` to `999` and must be different. These dimensions are sent only in `visits` mode; create them in Matomo before enabling it.
- `CLOUDFRONT_DECODE_USER_AGENT` (optional, default disabled): Set `true` or `1` to URL-decode `cs(User-Agent)` once before matching `USER_AGENT_ALLOWLIST_REGEX` and encoding the Matomo request. Plain user agents and literal `+` characters are preserved; invalid percent encoding falls back to the original value without discarding the entry. Unset, empty, `false`, or `0` disables decoding; values are trimmed and case-insensitive. Other values are rejected. Applies to both Lambda processing and `parse:log`.
- `CLOUDFRONT_DEFAULT_PROTOCOL` (optional): Fallback protocol, e.g. `https`, used when a log entry has no `cs-protocol` or its value is empty/`-`.
- `CLOUDFRONT_DEFAULT_HOST` (optional): Fallback host, e.g. `www.example.com` (without protocol or path), used when a log entry has no `x-host-header` or its value is empty/`-`. Values present in the log always take precedence over these fallbacks. If either URL field is missing and its fallback is unset, the entry cannot be tracked.
- `CLOUDFRONT_BEHIND_CLOUDFLARE` (optional, default disabled): Set `true` or `1` to send the client IP to Matomo as `cip`. When `c-ip` is a known Cloudflare proxy, prefer `cf-connecting-ip` / `CF-Connecting-IP` if present in enriched logs, otherwise use `x-forwarded-for`. Unset, empty, `false`, or `0` disables this feature; values are trimmed and case-insensitive. Other values are rejected. Enabling this option requires `MATOMO_TOKEN_AUTH`.
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
- `USER_AGENT_ALLOWLIST_REGEX` (optional): Case-insensitive regex to permit user agents; non-matching entries are skipped. With the default `native` mode and `MATOMO_REC_MODE=1`, the allowlist is `ChatGPT-User|MistralAI-User|Gemini-Deep-Research|Claude-User|Perplexity-User|Google-NotebookLM|Google-GeminiNotebook`. With `visits` mode or `MATOMO_REC_MODE=2`, it defaults to `.*`, permitting all non-empty user agents through this filter. Bot-only `visits` mode then excludes requests with no detected bot. Explicitly configured patterns still restrict tracking in every mode; remove an existing AI-only pattern or set it to `.*` to include other bots and normal visits.
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

Set `MATOMO_REC_MODE=2` in the Lambda environment to include normal visits. Leaving it unset, empty, or set to `1` selects bot-only tracking. `MATOMO_BOT_TRACKING_MODE` determines which bots are included and where they appear:

| `MATOMO_BOT_TRACKING_MODE` | `MATOMO_REC_MODE` | Requests sent with the default filters | Matomo reports                                                               |
| -------------------------- | ----------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| Unset or `native`          | Unset or `1`      | Supported AI assistants                | Separate AI Chatbot reports (`recMode=1`)                                    |
| Unset or `native`          | `2`               | All non-empty user agents              | Normal visits and supported AI assistants routed automatically (`recMode=2`) |
| `visits`                   | Unset or `1`      | Detected bots                          | Standard visitor reports, with bot dimensions                                |
| `visits`                   | `2`               | All non-empty user agents              | Standard visitor reports, with bot dimensions                                |

To include normal visits alongside the separate native AI reports, configure the Lambda with:

```dotenv
MATOMO_URL=https://analytics.example.com
MATOMO_SITE_ID=1
MATOMO_REC_MODE=2
CLOUDFRONT_DEFAULT_PROTOCOL=https
CLOUDFRONT_DEFAULT_HOST=www.example.com
LOG_LEVEL=info
```

Replace the Matomo URL, site ID, and website host with your values. If `USER_AGENT_ALLOWLIST_REGEX` is already configured to allow only AI bots, remove that override or set it to `.*`; an explicit filter takes precedence in both modes. `GET` filtering and static asset exclusions still apply in automatic mode.

In `native` mode, normal visits appear in the standard visitor reports and supported AI chatbot requests appear separately in **AI Assistants → AI Chatbots Overview**. Other detected crawlers are discarded by Matomo. For self-hosted Matomo, activate the `BotTracking` plugin to use the AI Chatbot reports. Use a Matomo version that supports the selected recording mode; see the [Tracking API](https://developer.matomo.org/api-reference/tracking-api#tracking-bots) and [AI Chatbot report setup](https://matomo.org/faq/reports/ai-chatbots-overview-report/).

## Bot Identity in Visitor Reports

To include detected bots such as Googlebot, Bingbot, ChatGPT-User, GPTBot, ClaudeBot, and PerplexityBot in the standard visitor reports:

1. In Matomo, select the site corresponding to `MATOMO_SITE_ID` and open **Administration → Websites → Custom Dimensions**.
2. Create and activate two dimensions with scope **Action**, named `Traffic type` and `Bot name`. Note their IDs. Action scope preserves the classification of each request.
3. Rebuild and package the Lambda, upload the updated ZIP, and set these environment variables:

```dotenv
MATOMO_BOT_TRACKING_MODE=visits
MATOMO_BOT_STATUS_DIMENSION_ID=1
MATOMO_BOT_NAME_DIMENSION_ID=2
MATOMO_REC_MODE=2
CLOUDFRONT_DECODE_USER_AGENT=true
```

Replace `1` and `2` with the IDs Matomo assigned to your dimensions. Keep your existing Matomo URL, site ID, and URL fallback settings. Remove any explicit AI-only `USER_AGENT_ALLOWLIST_REGEX` or set it to `.*`. Use `MATOMO_REC_MODE=1` to include only detected bots. HTTP method and URL exclusions still apply.

Detected requests receive `Traffic type=Bot` and their probable bot name; generic bot/crawler/spider product names receive `Bot name=Unknown bot`. Other requests receive `Not detected` in both dimensions. Detection uses the declared user agent and cannot verify the sender or identify bots that disguise themselves as ordinary browsers.

The named dimension reports appear under **Behaviours**. In **Visitors → Visits Log**, hover an action to view its dimensions. Bot requests contribute to ordinary visit/action statistics; use a segment excluding `Traffic type=Bot` when reviewing other traffic. See Matomo's [dimension setup](https://matomo.org/faq/reporting-tools/create-track-and-manage-custom-dimensions/) and [report and Visits Log guide](https://matomo.org/faq/reporting-tools/view-a-custom-dimension-report/).

In `visits` mode, every detected bot, including ChatGPT-User, is sent with `bots=1` and without `recMode`, as required by the [Tracking API](https://developer.matomo.org/api-reference/tracking-api#tracking-bots). These requests do not populate the native AI Chatbot reports. This setting applies to newly imported requests and does not backfill or relabel data already stored in Matomo.

## Browser and Browser Engine Detection

CloudFront logs can contain an encoded user agent such as `Mozilla/5.0%20(iPhone)%20Safari/604.1`; see the [official log example](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logs-reference.html). With decoding disabled, the request encoder turns the literal `%20` into `%2520`. Matomo then receives `%20` instead of spaces in `ua`, which can prevent correct browser detection.

To decode these log values and record ordinary browser visits, set:

```dotenv
MATOMO_REC_MODE=2
CLOUDFRONT_DECODE_USER_AGENT=true
```

Upload the rebuilt Lambda ZIP and set these variables in its environment. An explicit `USER_AGENT_ALLOWLIST_REGEX` still takes precedence; remove an AI-only override or set it to `.*` to include normal browsers. The decode flag is independent of recording mode and also applies to local `parse:log` runs. It is disabled by default because changing the user agent can affect allowlist matches and Matomo's visitor matching.

Matomo derives browser and engine on the server from `ua`; this pipeline does not need to send separate browser fields or add JavaScript tracking. See the [Tracking API](https://developer.matomo.org/api-reference/tracking-api) and Matomo's [browser engine detection](https://github.com/matomo-org/matomo/blob/5.x-dev/plugins/DevicesDetection/Columns/BrowserEngine.php). For self-hosted installations, check that `DevicesDetection` is active; it is included in Matomo's [default plugins](https://github.com/matomo-org/matomo/blob/5.x-dev/config/global.ini.php). Check normal visitor reports for browser dimensions: native AI bot tracking uses a separate set of fields and reports. Deploying this change does not repair already stored visits; check newly imported browser visits after enabling it.

## Cloudflare Reverse Proxy

For a website reached through `visitor → Cloudflare → CloudFront`, enable client IP forwarding in the Lambda environment:

```dotenv
MATOMO_URL=https://analytics.example.com
MATOMO_SITE_ID=1
MATOMO_REC_MODE=2
MATOMO_TOKEN_AUTH=replace-with-matomo-token
CLOUDFRONT_BEHIND_CLOUDFLARE=true
CLOUDFRONT_DEFAULT_PROTOCOL=https
CLOUDFRONT_DEFAULT_HOST=www.example.com
```

Replace the token placeholder with a Matomo token that has write or admin permission for the selected site. Matomo requires authenticated tracking requests to override the client IP using `cip`; see the [Tracking API](https://developer.matomo.org/api-reference/tracking-api). `MATOMO_REC_MODE=2` also enables normal visits; the Cloudflare option controls client IP forwarding independently of the recording mode.

Include both `c-ip` and `x-forwarded-for` in your standard CloudFront logs, either as JSON Lines keys or in the whitespace-separated log's `#Fields` header. CloudFront's `c-ip` identifies the connection to CloudFront, so it contains the Cloudflare proxy address in this topology. Standard CloudFront access logs do not natively include arbitrary request headers such as `CF-Connecting-IP`; if your custom or enriched logs capture that header, use the key `cf-connecting-ip` or `CF-Connecting-IP` for the preferred visitor IP. See the [CloudFront log field reference](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logs-reference.html).

When the option is enabled, the tracker selects the IP as follows:

- If `c-ip` belongs to a known Cloudflare IPv4 or IPv6 range, it first uses a valid `cf-connecting-ip` / `CF-Connecting-IP`, the visitor IP supplied by Cloudflare. If that field is missing or invalid, it uses the rightmost IP in `x-forwarded-for`. Cloudflare appends the connecting client to any existing forwarded header; selecting the first IP could trust a value supplied by the client. See [Cloudflare request headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/).
- For direct traffic, it ignores both forwarded headers and uses the valid `c-ip`. If the peer is Cloudflare but neither header provides a valid visitor IP, it also falls back to `c-ip`.
- If `c-ip` is missing or invalid, it omits `cip`, even when a forwarded header is present.

This selection supports the topology above. Additional proxies or Cloudflare Workers may produce a different IP chain and are not resolved by this option. `c-country` from these logs describes the connecting proxy's country and is not forwarded to Matomo; visitor location depends on Matomo's geolocation of the selected IP.

The tracker sends the selected IP and the user agent without generating random visitor IDs. Matomo can use these values to correlate requests, but this is a heuristic: people sharing a public IP and user agent, for example behind NAT, may appear as the same visitor. IP and user agent cannot prove that two requests came from the same person.

Every `npm run build` downloads the [official Cloudflare IPv4 ranges](https://www.cloudflare.com/ips-v4) and [IPv6 ranges](https://www.cloudflare.com/ips-v6), validates them, and refreshes `src/cloudflareRanges.json` before bundling. This generated snapshot is tracked in Git for review and embedded in the Lambda; no network lookup runs for each request. Builds require HTTPS access to `www.cloudflare.com` and fail if the download or validation fails, rather than using stale ranges. Rebuild and upload the new ZIP to deploy an updated range list.

Requests served from Cloudflare's cache do not reach CloudFront and therefore do not appear in these logs. Enabling this option cannot recover those requests; see [Cloudflare cache responses](https://developers.cloudflare.com/cache/concepts/cache-responses/).

## JSON Lines Logs

JSON Lines / NDJSON logs contain one JSON object per line, without an enclosing array or commas between lines. For example:

```jsonl
{"date":"2026-10-05","time":"10:00:00","c-ip":"172.68.245.145","x-forwarded-for":"43.166.244.192","cs-method":"GET","cs-uri-stem":"/chi-sono/","cs-uri-query":"-","cs(User-Agent)":"Mozilla/5.0%20(iPhone)%20Safari/604.1","sc-status":"200","sc-bytes":"4987","time-taken":"0.722"}
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

The build automatically runs `scripts/updateCloudflareRanges.ts` via the npm `prebuild` hook to download and validate Cloudflare's official ranges, even when client IP forwarding is disabled in the deployed environment. Allow HTTPS access to `www.cloudflare.com` when building; a failed download or invalid response stops the build. The hook uses Node's environment proxy support, honoring `HTTP_PROXY` / `HTTPS_PROXY` when configured. The resulting `src/cloudflareRanges.json` snapshot is bundled into the Lambda, so the runtime does not need that network access or proxy configuration.

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
- When enabling `CLOUDFRONT_BEHIND_CLOUDFLARE`, also include `c-ip` and `x-forwarded-for` (or the same keys in JSON Lines logs). If custom or enriched logs capture Cloudflare's `CF-Connecting-IP` header, include it as `cf-connecting-ip` or `CF-Connecting-IP`; standard CloudFront logs do not provide that header as a native field.
- Ensure the log path/prefix matches your S3 trigger filters (e.g. suffix `.gz`).

## Runtime Behavior

- Reads S3 objects as gzip streams, splits into lines, and accepts either whitespace-separated CloudFront logs (with an optional `#Fields` header) or JSON Lines / NDJSON (one flat JSON object per line). Numeric JSON values are converted to strings; `-` and `null` become empty strings. Malformed lines are skipped and logged.
- Maps fields to Matomo payload:
  - Required: `idsite`, `rec:1`, `url` (protocol+host+path+query), `cdt` (`Y-m-d H:i:s`), `ua`, `source:'CloudFront'`.
  - Recording: `recMode` from `MATOMO_REC_MODE` (default `1`), except detected bots in `visits` mode, which omit it and send `bots:1`. In `visits` mode, also sends the configured `dimension<ID>` values for each request.
  - Optional: `http_status`, `bw_bytes`, `pf_srv`, and `cip` when `CLOUDFRONT_BEHIND_CLOUDFLARE` is enabled and a valid client IP can be selected.
- Uses native AI bot-only recording by default. `MATOMO_REC_MODE=2` includes normal visits. `MATOMO_BOT_TRACKING_MODE=visits` records detected bots in standard visitor reports with bot identity dimensions, and bot-only mode skips requests with no detected bot. See the [Matomo Tracking API](https://developer.matomo.org/api-reference/tracking-api#tracking-bots).
- Filters requests by user agent using `USER_AGENT_ALLOWLIST_REGEX`; the default is an AI bot allowlist in native bot-only mode and all non-empty user agents in visits or automatic mode. Non-matching or empty user agents are skipped before payload assembly.
- When `CLOUDFRONT_DECODE_USER_AGENT` is enabled, URL-decodes `cs(User-Agent)` once before user agent filtering and Matomo request encoding. Malformed encoding keeps the original user agent.
- Filters requests by HTTP method using `HTTP_METHOD_ALLOWLIST` (defaults to `GET` only).
- Skips entries whose URL matches `URL_EXCLUDE_REGEX` (defaults to common static assets like js/css, images, fonts, source maps).
- Batches requests (size `BATCH_SIZE`) and POSTs `{ "requests": ["?param=value", ...] }` to `/matomo.php` with retries/backoff and structured logs. When `MATOMO_TOKEN_AUTH` is configured, the body also contains a top-level `"token_auth": "<token>"` and the request includes an `Authorization: Bearer <token>` header.
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
3. Look in the appropriate report: standard visitor reports for browser traffic and bots in `visits` mode, or AI Chatbot reports for supported AI bots in `native` mode. For `visits`, confirm both configured dimensions are active Action dimensions on the selected site. Check the `BotTracking` plugin for self-hosted native AI reports.
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
CLOUDFRONT_DECODE_USER_AGENT=true \
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

Local commands require Node.js 24.5 or newer. Tests set `AWS_REGION=eu-central-1` via `tests/setup-env.ts` to satisfy the SDK; the Node.js 24 Lambda runtime uses the platform-provided region.
