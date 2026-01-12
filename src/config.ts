import type { LogLevel, MatomoConfig } from './types.js';

const toInt = (value: string | undefined | null, fallback?: number) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected integer value, got "${value}"`);
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
  'Devin'
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
  const matomoTokenAuth = env.MATOMO_TOKEN_AUTH || undefined;
  const logLevel = (env.LOG_LEVEL || 'warn').toLowerCase() as LogLevel;
  const allowlistPattern =
    env.USER_AGENT_ALLOWLIST_REGEX || defaultAllowlistPattern;
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
    batchSize,
    matomoTimeoutMs,
    logLevel,
    userAgentAllowlistRegex,
    httpMethodAllowlist,
    documentRegex,
    urlExcludeRegex
  };
}
