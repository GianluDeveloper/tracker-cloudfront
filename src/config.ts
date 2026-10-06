import type { LogLevel, MatomoConfig } from './types.js';

const toInt = (value: string | undefined | null, fallback?: number) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected integer value, got "${value}"`);
  }
  return parsed;
};

const parseDimensionId = (
  value: string | undefined,
  name: string
): number | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (
    !/^\d+$/.test(trimmed) ||
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > 999
  ) {
    throw new Error(`Invalid ${name}. Expected an integer between 1 and 999.`);
  }
  return parsed;
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const defaultUserAgentPatterns = [
  'ChatGPT-User',
  'MistralAI-User',
  'Gemini-Deep-Research',
  'Claude-User',
  'Perplexity-User',
  'Google-NotebookLM',
  'Google-GeminiNotebook'
];
const defaultAllowlistPattern = `(?:${defaultUserAgentPatterns
  .map(escapeRegex)
  .join('|')})`;
const defaultDocumentPattern =
  '^[^?]+\\.(?:pdf|docx?|xlsx?|pptx?|csv|json|txt|xml|epub|mobi|azw3|mp3|mp4|mpe?g|webm|mov|avi|ogg|wav|flac|zip|gz|gzip|tgz|tar|bz2|tbz|7z|rar|dmg|exe|msi|apk|jar|md5|sig)(?:\\?|$)';
const defaultHttpMethodAllowlist = ['GET'];
const defaultUrlExcludePattern =
  '^[^?]+\\.(?:css|js|mjs|map|json|xml|webmanifest|manifest|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|woff2?|ttf|otf|eot|rss|atom|wasm|txt)(?:\\?|$)';

const parseHttpMethodAllowlist = (
  raw: string | undefined,
  fallback: string[] = defaultHttpMethodAllowlist
): string[] => {
  const value = raw?.trim();
  if (!value) return fallback;
  const methods = value
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => m.toUpperCase());
  if (!methods.length) return fallback;
  for (const method of methods) {
    if (!/^[A-Z]+$/.test(method)) {
      throw new Error(
        `Invalid HTTP_METHOD_ALLOWLIST value "${method}". Expected comma-separated HTTP methods, e.g. "GET,POST".`
      );
    }
  }
  return Array.from(new Set(methods));
};

export function getConfig(
  env: Record<string, string | undefined> = process.env
): MatomoConfig {
  const matomoUrl = env.MATOMO_URL;
  if (!matomoUrl) {
    throw new Error('MATOMO_URL is required');
  }

  const siteIdRaw = env.MATOMO_SITE_ID;
  if (!siteIdRaw) {
    throw new Error('MATOMO_SITE_ID is required');
  }
  const matomoSiteId = toInt(siteIdRaw);
  if (matomoSiteId === undefined) {
    throw new Error('MATOMO_SITE_ID is required');
  }

  const batchSize = toInt(env.BATCH_SIZE, 20) ?? 20;
  const matomoTimeoutMs = toInt(env.MATOMO_TIMEOUT_MS, 5000) ?? 5000;
  const matomoTokenAuth = env.MATOMO_TOKEN_AUTH?.trim() || undefined;
  const cloudflareMode =
    env.CLOUDFRONT_BEHIND_CLOUDFLARE?.trim().toLowerCase() || 'false';
  if (!['true', 'false', '1', '0'].includes(cloudflareMode)) {
    throw new Error(
      'Invalid CLOUDFRONT_BEHIND_CLOUDFLARE. Expected true/false or 1/0.'
    );
  }
  const cloudFrontBehindCloudflare =
    cloudflareMode === 'true' || cloudflareMode === '1';
  if (cloudFrontBehindCloudflare && !matomoTokenAuth) {
    throw new Error(
      'CLOUDFRONT_BEHIND_CLOUDFLARE requires MATOMO_TOKEN_AUTH to override visitor IPs.'
    );
  }
  const decodeUserAgent =
    env.CLOUDFRONT_DECODE_USER_AGENT?.trim().toLowerCase() || 'false';
  if (!['true', 'false', '1', '0'].includes(decodeUserAgent)) {
    throw new Error(
      'Invalid CLOUDFRONT_DECODE_USER_AGENT. Expected true/false or 1/0.'
    );
  }
  const cloudFrontDecodeUserAgent =
    decodeUserAgent === 'true' || decodeUserAgent === '1';
  const recMode = env.MATOMO_REC_MODE?.trim() || '1';
  if (recMode !== '1' && recMode !== '2') {
    throw new Error('Invalid MATOMO_REC_MODE. Expected 1 (bots) or 2 (auto).');
  }
  const matomoRecMode = recMode === '2' ? 2 : 1;
  const botTrackingMode =
    env.MATOMO_BOT_TRACKING_MODE?.trim().toLowerCase() || 'native';
  if (botTrackingMode !== 'native' && botTrackingMode !== 'visits') {
    throw new Error(
      'Invalid MATOMO_BOT_TRACKING_MODE. Expected native or visits.'
    );
  }
  const matomoBotTrackingMode = botTrackingMode;
  const matomoBotStatusDimensionId = parseDimensionId(
    env.MATOMO_BOT_STATUS_DIMENSION_ID,
    'MATOMO_BOT_STATUS_DIMENSION_ID'
  );
  const matomoBotNameDimensionId = parseDimensionId(
    env.MATOMO_BOT_NAME_DIMENSION_ID,
    'MATOMO_BOT_NAME_DIMENSION_ID'
  );
  if (
    matomoBotStatusDimensionId !== undefined &&
    matomoBotStatusDimensionId === matomoBotNameDimensionId
  ) {
    throw new Error(
      'MATOMO_BOT_STATUS_DIMENSION_ID and MATOMO_BOT_NAME_DIMENSION_ID must be different.'
    );
  }
  if (
    matomoBotTrackingMode === 'visits' &&
    (matomoBotStatusDimensionId === undefined ||
      matomoBotNameDimensionId === undefined)
  ) {
    throw new Error(
      'MATOMO_BOT_TRACKING_MODE=visits requires MATOMO_BOT_STATUS_DIMENSION_ID and MATOMO_BOT_NAME_DIMENSION_ID to label bot visits.'
    );
  }
  const logLevel = (env.LOG_LEVEL || 'warn').toLowerCase() as LogLevel;
  const allowlistPattern =
    env.USER_AGENT_ALLOWLIST_REGEX ||
    (matomoRecMode === 2 || matomoBotTrackingMode === 'visits'
      ? '.*'
      : defaultAllowlistPattern);
  const httpMethodAllowlist = parseHttpMethodAllowlist(
    env.HTTP_METHOD_ALLOWLIST,
    defaultHttpMethodAllowlist
  );
  const documentPattern = env.DOCUMENT_REGEX || defaultDocumentPattern;
  const urlExcludePattern = env.URL_EXCLUDE_REGEX || defaultUrlExcludePattern;
  let userAgentAllowlistRegex: RegExp | undefined;
  let documentRegex: RegExp | undefined;
  let urlExcludeRegex: RegExp | undefined;
  try {
    userAgentAllowlistRegex = new RegExp(allowlistPattern, 'i');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid USER_AGENT_ALLOWLIST_REGEX: ${message}`);
  }
  try {
    documentRegex = new RegExp(documentPattern, 'i');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid DOCUMENT_REGEX: ${message}`);
  }
  try {
    urlExcludeRegex = new RegExp(urlExcludePattern, 'i');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid URL_EXCLUDE_REGEX: ${message}`);
  }

  return {
    matomoUrl,
    matomoSiteId,
    matomoTokenAuth,
    matomoRecMode,
    matomoBotTrackingMode,
    matomoBotStatusDimensionId,
    matomoBotNameDimensionId,
    cloudFrontDefaultProtocol:
      env.CLOUDFRONT_DEFAULT_PROTOCOL?.trim() || undefined,
    cloudFrontDefaultHost: env.CLOUDFRONT_DEFAULT_HOST?.trim() || undefined,
    cloudFrontBehindCloudflare,
    cloudFrontDecodeUserAgent,
    batchSize,
    matomoTimeoutMs,
    logLevel,
    userAgentAllowlistRegex,
    httpMethodAllowlist,
    documentRegex,
    urlExcludeRegex
  };
}
