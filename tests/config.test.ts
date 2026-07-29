import { describe, expect, it } from 'vitest';
import { getConfig } from '../src/config.js';

const baseEnv = {
  MATOMO_URL: 'https://analytics.example.com',
  MATOMO_SITE_ID: '42'
};

describe('getConfig', () => {
  it('reads required fields and defaults', () => {
    const config = getConfig({ ...baseEnv });
    expect(config).toMatchObject({
      matomoUrl: baseEnv.MATOMO_URL,
      matomoSiteId: 42,
      matomoTokenAuth: undefined,
      batchSize: 20,
      matomoTimeoutMs: 5000,
      logLevel: 'warn'
    });
    expect(config.userAgentAllowlistRegex).toEqual(
      /(?:ChatGPT-User|MistralAI-User|Gemini-Deep-Research|Claude-User|Perplexity-User|Google-NotebookLM|Google-GeminiNotebook)/i
    );
    expect(config.httpMethodAllowlist).toEqual(['GET']);
    expect(config.documentRegex).toEqual(
      /^[^?]+\.(?:pdf|docx?|xlsx?|pptx?|csv|json|txt|xml|epub|mobi|azw3|mp3|mp4|mpe?g|webm|mov|avi|ogg|wav|flac|zip|gz|gzip|tgz|tar|bz2|tbz|7z|rar|dmg|exe|msi|apk|jar|md5|sig)(?:\?|$)/i
    );
    expect(config.urlExcludeRegex).toEqual(
      /^[^?]+\.(?:css|js|mjs|map|json|xml|webmanifest|manifest|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|woff2?|ttf|otf|eot|rss|atom|wasm|txt)(?:\?|$)/i
    );
  });

  it('allows both NotebookLM user agent tokens by default', () => {
    const { userAgentAllowlistRegex } = getConfig({ ...baseEnv });
    const userAgents = [
      // current desktop and mobile agents
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 (compatible; Google-GeminiNotebook; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-gemininotebook)',
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 (compatible; Google-GeminiNotebook; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-gemininotebook)',
      // former agent, supported until August 2026
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 (compatible; Google-NotebookLM; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-notebooklm)'
    ];
    for (const userAgent of userAgents) {
      expect(userAgentAllowlistRegex?.test(userAgent)).toBe(true);
    }
  });

  it('uses optional overrides', () => {
    const config = getConfig({
      ...baseEnv,
      MATOMO_TOKEN_AUTH: 'secret',
      BATCH_SIZE: '10',
      MATOMO_TIMEOUT_MS: '8000',
      LOG_LEVEL: 'debug',
      USER_AGENT_ALLOWLIST_REGEX: 'CustomBot',
      HTTP_METHOD_ALLOWLIST: 'GET, HEAD',
      DOCUMENT_REGEX: '\\.custom$',
      URL_EXCLUDE_REGEX: '\\.skip$'
    });
    expect(config).toMatchObject({
      matomoUrl: baseEnv.MATOMO_URL,
      matomoSiteId: 42,
      matomoTokenAuth: 'secret',
      batchSize: 10,
      matomoTimeoutMs: 8000,
      logLevel: 'debug'
    });
    expect(config.userAgentAllowlistRegex).toEqual(/CustomBot/i);
    expect(config.httpMethodAllowlist).toEqual(['GET', 'HEAD']);
    expect(config.documentRegex).toEqual(/\.custom$/i);
    expect(config.urlExcludeRegex).toEqual(/\.skip$/i);
  });

  it('throws on invalid regex config', () => {
    expect(() =>
      getConfig({ ...baseEnv, USER_AGENT_ALLOWLIST_REGEX: '[' })
    ).toThrow(/Invalid USER_AGENT_ALLOWLIST_REGEX/);
    expect(() => getConfig({ ...baseEnv, DOCUMENT_REGEX: '[' })).toThrow(
      /Invalid DOCUMENT_REGEX/
    );
    expect(() =>
      getConfig({ ...baseEnv, HTTP_METHOD_ALLOWLIST: 'GET,$$' })
    ).toThrow(/Invalid HTTP_METHOD_ALLOWLIST/);
    expect(() => getConfig({ ...baseEnv, URL_EXCLUDE_REGEX: '[' })).toThrow(
      /Invalid URL_EXCLUDE_REGEX/
    );
  });

  it('throws when MATOMO_URL is missing', () => {
    expect(() => getConfig({ MATOMO_SITE_ID: '1' })).toThrow(
      /MATOMO_URL is required/
    );
  });

  it('throws when MATOMO_SITE_ID is missing', () => {
    expect(() => getConfig({ MATOMO_URL: baseEnv.MATOMO_URL })).toThrow(
      /MATOMO_SITE_ID is required/
    );
  });

  it('throws when numeric fields are not integers', () => {
    expect(() => getConfig({ ...baseEnv, BATCH_SIZE: 'not-a-number' })).toThrow(
      /Expected integer value/
    );
    expect(() => getConfig({ ...baseEnv, MATOMO_SITE_ID: 'abc' })).toThrow(
      /Expected integer value/
    );
    expect(() => getConfig({ ...baseEnv, MATOMO_TIMEOUT_MS: 'abc' })).toThrow(
      /Expected integer value/
    );
  });
});
