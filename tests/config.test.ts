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
      matomoRecMode: 1,
      matomoBotTrackingMode: 'native',
      matomoBotStatusDimensionId: undefined,
      matomoBotNameDimensionId: undefined,
      cloudFrontBehindCloudflare: false,
      cloudFrontDecodeUserAgent: false,
      cloudFrontDefaultProtocol: undefined,
      cloudFrontDefaultHost: undefined,
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
      MATOMO_REC_MODE: ' 2 ',
      CLOUDFRONT_BEHIND_CLOUDFLARE: ' true ',
      CLOUDFRONT_DECODE_USER_AGENT: ' true ',
      CLOUDFRONT_DEFAULT_PROTOCOL: ' https ',
      CLOUDFRONT_DEFAULT_HOST: ' www.example.com ',
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
      matomoRecMode: 2,
      cloudFrontBehindCloudflare: true,
      cloudFrontDecodeUserAgent: true,
      cloudFrontDefaultProtocol: 'https',
      cloudFrontDefaultHost: 'www.example.com',
      batchSize: 10,
      matomoTimeoutMs: 8000,
      logLevel: 'debug'
    });
    expect(config.userAgentAllowlistRegex).toEqual(/CustomBot/i);
    expect(config.httpMethodAllowlist).toEqual(['GET', 'HEAD']);
    expect(config.documentRegex).toEqual(/\.custom$/i);
    expect(config.urlExcludeRegex).toEqual(/\.skip$/i);
  });

  it('allows browser user agents when automatic mode is enabled', () => {
    const config = getConfig({ ...baseEnv, MATOMO_REC_MODE: '2' });
    expect(config.matomoRecMode).toBe(2);
    expect(
      config.userAgentAllowlistRegex?.test('Mozilla/5.0 Safari/604.1')
    ).toBe(true);
    expect(config.userAgentAllowlistRegex?.test('ChatGPT-User/1.0')).toBe(true);
    expect(
      getConfig(baseEnv).userAgentAllowlistRegex?.test(
        'Mozilla/5.0 Safari/604.1'
      )
    ).toBe(false);
  });

  it.each(['', ' ', '1'])(
    'keeps bot-only mode for MATOMO_REC_MODE=%j',
    (mode) => {
      expect(
        getConfig({ ...baseEnv, MATOMO_REC_MODE: mode }).matomoRecMode
      ).toBe(1);
    }
  );

  it.each(['0', '3', 'auto', '2invalid', '2.0'])(
    'rejects invalid MATOMO_REC_MODE=%j',
    (mode) => {
      expect(() => getConfig({ ...baseEnv, MATOMO_REC_MODE: mode })).toThrow(
        /Invalid MATOMO_REC_MODE/
      );
    }
  );

  it.each([undefined, '', ' ', 'native', ' NATIVE '])(
    'preserves native bot tracking for MATOMO_BOT_TRACKING_MODE=%j',
    (mode) => {
      const config = getConfig({ ...baseEnv, MATOMO_BOT_TRACKING_MODE: mode });
      expect(config.matomoBotTrackingMode).toBe('native');
      expect(config.userAgentAllowlistRegex?.test('ChatGPT-User/1.0')).toBe(
        true
      );
      expect(config.userAgentAllowlistRegex?.test('Googlebot/2.1')).toBe(false);
      expect(config.userAgentAllowlistRegex?.test('Mozilla/5.0')).toBe(false);
    }
  );

  it.each(['visits', ' VISITS '])(
    'enables labeled bot visits for MATOMO_BOT_TRACKING_MODE=%j',
    (mode) => {
      const config = getConfig({
        ...baseEnv,
        MATOMO_BOT_TRACKING_MODE: mode,
        MATOMO_BOT_STATUS_DIMENSION_ID: ' 1 ',
        MATOMO_BOT_NAME_DIMENSION_ID: '999'
      });
      expect(config).toMatchObject({
        matomoRecMode: 1,
        matomoBotTrackingMode: 'visits',
        matomoBotStatusDimensionId: 1,
        matomoBotNameDimensionId: 999
      });
      expect(config.userAgentAllowlistRegex).toEqual(/.*/i);
      expect(config.userAgentAllowlistRegex?.test('Googlebot/2.1')).toBe(true);
    }
  );

  it('keeps explicit user agent filters and automatic mode with bot visits', () => {
    const config = getConfig({
      ...baseEnv,
      MATOMO_REC_MODE: '2',
      MATOMO_BOT_TRACKING_MODE: 'visits',
      MATOMO_BOT_STATUS_DIMENSION_ID: '3',
      MATOMO_BOT_NAME_DIMENSION_ID: '4',
      USER_AGENT_ALLOWLIST_REGEX: 'Googlebot'
    });
    expect(config.matomoRecMode).toBe(2);
    expect(config.userAgentAllowlistRegex).toEqual(/Googlebot/i);
    expect(config.userAgentAllowlistRegex?.test('ChatGPT-User/1.0')).toBe(
      false
    );
  });

  it('keeps explicit user agent filters in bot-only visits mode', () => {
    const config = getConfig({
      ...baseEnv,
      MATOMO_BOT_TRACKING_MODE: 'visits',
      MATOMO_BOT_STATUS_DIMENSION_ID: '3',
      MATOMO_BOT_NAME_DIMENSION_ID: '4',
      USER_AGENT_ALLOWLIST_REGEX: 'Googlebot'
    });
    expect(config.matomoRecMode).toBe(1);
    expect(config.userAgentAllowlistRegex).toEqual(/Googlebot/i);
  });

  it.each(['mixed', 'auto', 'visit', '1', 'visits-extra'])(
    'rejects invalid MATOMO_BOT_TRACKING_MODE=%j',
    (mode) => {
      expect(() =>
        getConfig({ ...baseEnv, MATOMO_BOT_TRACKING_MODE: mode })
      ).toThrow(/Invalid MATOMO_BOT_TRACKING_MODE/);
    }
  );

  it.each([undefined, '', ' '])(
    'treats blank bot dimension IDs as unset in native mode (%j)',
    (value) => {
      const config = getConfig({
        ...baseEnv,
        MATOMO_BOT_STATUS_DIMENSION_ID: value,
        MATOMO_BOT_NAME_DIMENSION_ID: value
      });
      expect(config.matomoBotStatusDimensionId).toBeUndefined();
      expect(config.matomoBotNameDimensionId).toBeUndefined();
    }
  );

  it.each(['MATOMO_BOT_STATUS_DIMENSION_ID', 'MATOMO_BOT_NAME_DIMENSION_ID'])(
    'validates %s as a complete positive integer within Matomo limits',
    (name) => {
      for (const value of [
        '0',
        '-1',
        '1000',
        '1.5',
        '1invalid',
        '1e2',
        '+1',
        'NaN',
        'Infinity'
      ]) {
        expect(() => getConfig({ ...baseEnv, [name]: value })).toThrow(
          `Invalid ${name}. Expected an integer between 1 and 999.`
        );
      }
    }
  );

  it.each(['native', 'visits'])(
    'rejects conflicting bot dimension IDs in %s mode',
    (mode) => {
      expect(() =>
        getConfig({
          ...baseEnv,
          MATOMO_BOT_TRACKING_MODE: mode,
          MATOMO_BOT_STATUS_DIMENSION_ID: ' 7 ',
          MATOMO_BOT_NAME_DIMENSION_ID: '7'
        })
      ).toThrow(/must be different/);
    }
  );

  it.each([
    {},
    { MATOMO_BOT_STATUS_DIMENSION_ID: '1' },
    { MATOMO_BOT_NAME_DIMENSION_ID: '2' },
    { MATOMO_BOT_STATUS_DIMENSION_ID: ' ', MATOMO_BOT_NAME_DIMENSION_ID: '2' },
    { MATOMO_BOT_STATUS_DIMENSION_ID: '1', MATOMO_BOT_NAME_DIMENSION_ID: '' }
  ])('requires both dimension IDs for visits mode (%j)', (dimensions) => {
    expect(() =>
      getConfig({
        ...baseEnv,
        MATOMO_BOT_TRACKING_MODE: 'visits',
        ...dimensions
      })
    ).toThrow(
      /MATOMO_BOT_TRACKING_MODE=visits requires MATOMO_BOT_STATUS_DIMENSION_ID and MATOMO_BOT_NAME_DIMENSION_ID/
    );
  });

  it('treats blank CloudFront fallbacks as unset', () => {
    const config = getConfig({
      ...baseEnv,
      CLOUDFRONT_DEFAULT_PROTOCOL: ' ',
      CLOUDFRONT_DEFAULT_HOST: ''
    });
    expect(config.cloudFrontDefaultProtocol).toBeUndefined();
    expect(config.cloudFrontDefaultHost).toBeUndefined();
  });

  it.each(['true', 'TRUE', ' True ', '1', ' 1 '])(
    'enables Cloudflare client IP handling for CLOUDFRONT_BEHIND_CLOUDFLARE=%j',
    (value) => {
      const config = getConfig({
        ...baseEnv,
        MATOMO_TOKEN_AUTH: ' secret ',
        CLOUDFRONT_BEHIND_CLOUDFLARE: value
      });
      expect(config.cloudFrontBehindCloudflare).toBe(true);
      expect(config.matomoTokenAuth).toBe('secret');
    }
  );

  it.each([undefined, '', ' ', 'false', 'FALSE', ' False ', '0', ' 0 '])(
    'disables Cloudflare client IP handling for CLOUDFRONT_BEHIND_CLOUDFLARE=%j',
    (value) => {
      expect(
        getConfig({
          ...baseEnv,
          CLOUDFRONT_BEHIND_CLOUDFLARE: value
        }).cloudFrontBehindCloudflare
      ).toBe(false);
    }
  );

  it.each(['yes', '2', 'trueish'])(
    'rejects invalid CLOUDFRONT_BEHIND_CLOUDFLARE=%j',
    (value) => {
      expect(() =>
        getConfig({ ...baseEnv, CLOUDFRONT_BEHIND_CLOUDFLARE: value })
      ).toThrow(/Invalid CLOUDFRONT_BEHIND_CLOUDFLARE/);
    }
  );

  it.each(['true', 'TRUE', ' True ', '1', ' 1 '])(
    'enables User-Agent decoding for CLOUDFRONT_DECODE_USER_AGENT=%j',
    (value) => {
      expect(
        getConfig({ ...baseEnv, CLOUDFRONT_DECODE_USER_AGENT: value })
          .cloudFrontDecodeUserAgent
      ).toBe(true);
    }
  );

  it.each([undefined, '', ' ', 'false', 'FALSE', ' False ', '0', ' 0 '])(
    'disables User-Agent decoding for CLOUDFRONT_DECODE_USER_AGENT=%j',
    (value) => {
      expect(
        getConfig({ ...baseEnv, CLOUDFRONT_DECODE_USER_AGENT: value })
          .cloudFrontDecodeUserAgent
      ).toBe(false);
    }
  );

  it.each(['yes', '2', 'trueish'])(
    'rejects invalid CLOUDFRONT_DECODE_USER_AGENT=%j',
    (value) => {
      expect(() =>
        getConfig({ ...baseEnv, CLOUDFRONT_DECODE_USER_AGENT: value })
      ).toThrow(/Invalid CLOUDFRONT_DECODE_USER_AGENT/);
    }
  );

  it.each([undefined, '', '   '])(
    'requires an authentication token when Cloudflare handling is enabled (token: %j)',
    (token) => {
      expect(() =>
        getConfig({
          ...baseEnv,
          CLOUDFRONT_BEHIND_CLOUDFLARE: 'true',
          MATOMO_TOKEN_AUTH: token
        })
      ).toThrow(/MATOMO_TOKEN_AUTH/);
    }
  );

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
