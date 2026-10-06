import { describe, expect, it } from 'vitest';
import { buildMatomoPayload } from '../src/matomo.js';
import { getConfig } from '../src/config.js';
import type { MatomoConfig } from '../src/types.js';
import { buildMatomoRequestPayload } from '../src/http.js';

const config = getConfig({
  MATOMO_URL: 'https://analytics.example.com',
  MATOMO_SITE_ID: '99',
  USER_AGENT_ALLOWLIST_REGEX: '.*'
});
const configNoAllowlist = { ...config, userAgentAllowlistRegex: undefined };

describe('buildMatomoPayload', () => {
  describe('domain site ID overrides', () => {
    const env = {
      MATOMO_URL: 'https://analytics.example.com',
      MATOMO_SITE_ID: '99',
      MATOMO_SITE_ID_MAP: '{"latopratico.com":2,"guida.com":3}',
      CLOUDFRONT_DEFAULT_PROTOCOL: 'https',
      CLOUDFRONT_DEFAULT_HOST: 'latopratico.com'
    };
    const entry = {
      date: '2026-10-06',
      time: '10:00:00',
      'cs-uri-stem': '/page'
    };

    it.each([
      ['latopratico.com', 2],
      ['guida.com', 3],
      ['LATOPRATICO.COM.:443', 2],
      ['unknown.com', 99],
      ['www.latopratico.com', 99],
      ['blog.guida.com', 99],
      ['constructor', 99],
      ['toString', 99]
    ])(
      'routes host %s to site %s and preserves the logged URL',
      (host, siteId) => {
        const payload = buildMatomoPayload(
          { ...entry, 'x-host-header': host },
          getConfig(env)
        );
        expect(payload.idsite).toBe(siteId);
        expect(payload.url).toBe(`https://${host}/page`);
      }
    );

    it('uses the mapped fallback host when the logged host is missing', () => {
      const payload = buildMatomoPayload(entry, getConfig(env));
      expect(payload.idsite).toBe(2);
      expect(payload.url).toBe('https://latopratico.com/page');
    });

    it.each([undefined, '{}'])(
      'keeps the default site ID when the map is %s',
      (map) => {
        const payload = buildMatomoPayload(
          entry,
          getConfig({ ...env, MATOMO_SITE_ID_MAP: map })
        );
        expect(payload.idsite).toBe(99);
      }
    );
  });

  describe('bot visits and action dimensions', () => {
    const entry = {
      date: '2026-10-06',
      time: '10:00:00',
      'cs-protocol': 'https',
      'x-host-header': 'example.com',
      'cs-uri-stem': '/'
    };
    const visitConfig = getConfig({
      MATOMO_URL: 'https://analytics.example.com',
      MATOMO_SITE_ID: '99',
      MATOMO_REC_MODE: '2',
      MATOMO_BOT_TRACKING_MODE: 'visits',
      MATOMO_BOT_STATUS_DIMENSION_ID: '3',
      MATOMO_BOT_NAME_DIMENSION_ID: '8',
      CLOUDFRONT_DECODE_USER_AGENT: 'true'
    });

    it.each([
      [
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Googlebot'
      ],
      [
        'Mozilla/5.0%20(compatible;%20ChatGPT-User/1.0;%20+https://openai.com/bot)',
        'ChatGPT-User'
      ],
      ['GPTBot/1.2', 'GPTBot'],
      ['Perplexity-User/1.0', 'Perplexity-User'],
      ['CustomCrawler/1.0', 'Unknown bot']
    ])('records %s as a labeled bot visit (%s)', (userAgent, name) => {
      const payload = buildMatomoPayload(
        { ...entry, 'cs(User-Agent)': userAgent },
        visitConfig
      );
      const params = new URLSearchParams(
        buildMatomoRequestPayload(payload).slice(1)
      );
      expect(params.get('rec')).toBe('1');
      expect(params.get('bots')).toBe('1');
      expect(params.has('recMode')).toBe(false);
      expect(params.get('dimension3')).toBe('Bot');
      expect(params.get('dimension8')).toBe(name);
      expect(params.get('ua')).toBe(decodeURIComponent(userAgent));
      expect(params.get('url')).toBe('https://example.com/');
    });

    it('labels browsers without claiming a verified human identity', () => {
      const payload = buildMatomoPayload(
        { ...entry, 'cs(User-Agent)': 'Mozilla/5.0 Safari/604.1' },
        visitConfig
      );
      expect(payload.recMode).toBe(2);
      expect(payload).not.toHaveProperty('bots');
      expect(payload.dimension3).toBe('Not detected');
      expect(payload.dimension8).toBe('Not detected');
    });

    it.each([1, 2] as const)(
      'permits bot visits and downloads independently of recording mode %s',
      (mode) => {
        const payload = buildMatomoPayload(
          {
            ...entry,
            'cs(User-Agent)': 'Googlebot/2.1',
            'cs-uri-stem': '/file.pdf'
          },
          { ...visitConfig, matomoRecMode: mode }
        );
        expect(payload.bots).toBe(1);
        expect(payload).not.toHaveProperty('recMode');
        expect(payload.download).toBe('https://example.com/file.pdf');
        expect(payload.dimension8).toBe('Googlebot');
      }
    );

    it.each([undefined, 'native'] as const)(
      'preserves native routing when bot tracking mode is %s',
      (mode) => {
        const payload = buildMatomoPayload(
          { ...entry, 'cs(User-Agent)': 'ChatGPT-User/1.0' },
          { ...visitConfig, matomoBotTrackingMode: mode }
        );
        expect(payload.recMode).toBe(2);
        expect(payload).not.toHaveProperty('bots');
        expect(payload).not.toHaveProperty('dimension3');
        expect(payload).not.toHaveProperty('dimension8');
      }
    );
  });

  it('builds payload with full URL and converted numeric fields', () => {
    const entry = {
      date: '2025-02-18',
      time: '12:00:00',
      'cs-protocol': 'https',
      'x-host-header': 'example.com',
      'cs-uri-stem': '/path',
      'cs-uri-query': 'foo=bar',
      'sc-status': '200',
      'time-taken': '0.123',
      'sc-bytes': '512',
      'cs(User-Agent)': 'Mozilla/5.0'
    };

    const payload = buildMatomoPayload(entry, config);

    expect(payload).toEqual({
      idsite: 99,
      rec: 1,
      recMode: 1,
      url: 'https://example.com/path?foo=bar',
      source: 'CloudFront',
      cdt: '2025-02-18 12:00:00',
      ua: 'Mozilla/5.0',
      http_status: 200,
      bw_bytes: 512,
      pf_srv: 123
    });
  });

  it('omits query string when empty and optional fields when missing', () => {
    const entry = {
      date: '2025-02-18',
      time: '12:00:01',
      'cs-protocol': 'http',
      'x-host-header': 'example.com',
      'cs-uri-stem': '',
      'cs-uri-query': '',
      'sc-status': '',
      'time-taken': '',
      'sc-bytes': '',
      'cs(User-Agent)': 'AgentX'
    };

    const payload = buildMatomoPayload(entry, config);

    expect(payload.url).toBe('http://example.com/');
    expect(payload).not.toHaveProperty('http_status');
    expect(payload).not.toHaveProperty('bw_bytes');
    expect(payload).not.toHaveProperty('pf_srv');
    expect(payload.ua).toBe('AgentX');
  });

  describe('document regex handling', () => {
    const baseEntry = {
      date: '2025-02-18',
      time: '12:00:00',
      'cs-protocol': 'https',
      'x-host-header': 'example.com',
      'cs-uri-stem': '/files/report.pdf',
      'cs-uri-query': '',
      'cs(User-Agent)': 'Mozilla/5.0'
    };

    const cases = [
      {
        name: 'matches default regex for document paths (keeps query)',
        entry: { 'cs-uri-query': 'token=abc' },
        expectedDownload: 'https://example.com/files/report.pdf?token=abc'
      },
      {
        name: 'does not treat query-only extension as document',
        entry: { 'cs-uri-stem': '/page', 'cs-uri-query': 'next=/file.pdf' },
        expectedDownload: undefined
      },
      {
        name: 'matches custom regex on document path',
        configOverride: { documentRegex: /\.pdf$/i },
        entry: {},
        expectedDownload: 'https://example.com/files/report.pdf'
      },
      {
        name: 'allows custom regex to inspect query string',
        configOverride: { documentRegex: /report\.pdf\?download=true$/i },
        entry: { 'cs-uri-query': 'download=true' },
        expectedDownload: 'https://example.com/files/report.pdf?download=true'
      },
      {
        name: 'allows custom regex to inspect host and query string',
        configOverride: {
          documentRegex:
            /https?:\/\/downloads\.example\.com\/files\/report\.pdf\?download=true$/i
        },
        entry: {
          'x-host-header': 'downloads.example.com',
          'cs-uri-query': 'download=true'
        },
        expectedDownload:
          'https://downloads.example.com/files/report.pdf?download=true'
      }
    ];

    cases.forEach(({ name, entry, configOverride, expectedDownload }) => {
      it(name, () => {
        const mergedConfig = configOverride
          ? { ...config, ...configOverride }
          : config;
        const payload = buildMatomoPayload(
          { ...baseEntry, ...entry },
          mergedConfig
        );
        if (expectedDownload) {
          expect(payload.download).toBe(expectedDownload);
        } else {
          expect(payload.download).toBeUndefined();
        }
      });
    });
  });

  it('uses configured fallbacks only for missing or empty URL fields', () => {
    const fallbackConfig = getConfig({
      MATOMO_URL: 'https://analytics.example.com',
      MATOMO_SITE_ID: '99',
      CLOUDFRONT_DEFAULT_PROTOCOL: 'https',
      CLOUDFRONT_DEFAULT_HOST: 'fallback.example.com'
    });
    const entry = {
      date: '2026-09-10',
      time: '11:05:16',
      'cs-uri-stem': '/chi-sono/'
    };
    expect(buildMatomoPayload(entry, fallbackConfig).url).toBe(
      'https://fallback.example.com/chi-sono/'
    );
    expect(
      buildMatomoPayload(
        { ...entry, 'cs-protocol': '', 'x-host-header': '' },
        fallbackConfig
      ).url
    ).toBe('https://fallback.example.com/chi-sono/');
    expect(
      buildMatomoPayload({ ...entry, 'cs-protocol': 'http' }, fallbackConfig)
        .url
    ).toBe('http://fallback.example.com/chi-sono/');
    expect(
      buildMatomoPayload(
        { ...entry, 'x-host-header': 'logged.example.com' },
        fallbackConfig
      ).url
    ).toBe('https://logged.example.com/chi-sono/');
    expect(
      buildMatomoPayload(
        {
          ...entry,
          'cs-protocol': 'http',
          'x-host-header': 'logged.example.com'
        },
        fallbackConfig
      ).url
    ).toBe('http://logged.example.com/chi-sono/');
  });

  it('throws when required fields are missing', () => {
    expect(() => buildMatomoPayload({}, config)).toThrow(/timestamp/);
    expect(() =>
      buildMatomoPayload(
        { date: '2025-02-18', time: '12:00:00', 'cs-protocol': 'https' },
        config
      )
    ).toThrow(/Missing required protocol/);
    expect(() =>
      buildMatomoPayload(
        {
          date: '2025-02-18',
          time: '12:00:00',
          'cs-protocol': 'https',
          'x-host-header': 'example.com',
          'cs-uri-stem': '/path',
          'cs(User-Agent)': 'AgentX'
        },
        config
      )
    ).not.toThrow();
    expect(() => buildMatomoPayload({ date: '2025-02-18' }, config)).toThrow(
      /timestamp/
    );
  });

  it('allows empty user agent when no allowlist is set', () => {
    const entry = {
      date: '2025-02-18',
      time: '12:00:00',
      'cs-protocol': 'https',
      'x-host-header': 'example.com',
      'cs-uri-stem': '/path'
    };
    const payload = buildMatomoPayload(entry, configNoAllowlist);
    expect(payload.ua).toBe('');
  });

  describe('opt-in CloudFront User-Agent decoding', () => {
    const entry = {
      date: '2026-10-05',
      time: '10:51:23',
      'cs-protocol': 'https',
      'x-host-header': 'example.com',
      'cs-uri-stem': '/'
    };

    it.each([undefined, false])(
      'preserves the logged User-Agent when the option is %s',
      (enabled) => {
        const payload = buildMatomoPayload(
          { ...entry, 'cs(User-Agent)': 'Mozilla/5.0%20(iPhone)' },
          { ...config, cloudFrontDecodeUserAgent: enabled }
        );
        expect(payload.ua).toBe('Mozilla/5.0%20(iPhone)');
      }
    );

    it.each([
      ['Mozilla/5.0%20(iPhone)', 'Mozilla/5.0 (iPhone)'],
      ['Mozilla/5.0 (iPhone)', 'Mozilla/5.0 (iPhone)'],
      [
        'Bot/1.0%20(+https://example.com/a+b)',
        'Bot/1.0 (+https://example.com/a+b)'
      ],
      ['Custom%2520Agent', 'Custom%20Agent'],
      ['Custom%20Agent%ZZ', 'Custom%20Agent%ZZ'],
      ['Custom%20Agent%', 'Custom%20Agent%'],
      ['Custom%20Agent%C3%28', 'Custom%20Agent%C3%28'],
      ['', ''],
      [undefined, '']
    ])('decodes %j exactly once, safely producing %j', (logged, expected) => {
      const input =
        logged === undefined ? entry : { ...entry, 'cs(User-Agent)': logged };
      const payload = buildMatomoPayload(input, {
        ...config,
        cloudFrontDecodeUserAgent: true
      });
      expect(payload.ua).toBe(expected);
      if (logged !== undefined)
        expect(input).toHaveProperty('cs(User-Agent)', logged);
    });
  });

  describe('Cloudflare client IP handling', () => {
    const entry = {
      date: '2026-10-05',
      time: '10:51:23',
      'cs-protocol': 'https',
      'x-host-header': 'example.com',
      'cs-uri-stem': '/',
      'cs(User-Agent)': 'Mozilla/5.0',
      'c-ip': '172.68.245.145',
      'x-forwarded-for': '1.2.3.4, 43.166.244.192',
      'c-country': 'US'
    };
    const cloudflareConfig = {
      ...config,
      cloudFrontBehindCloudflare: true,
      matomoTokenAuth: 'secret'
    };

    it.each([undefined, false])(
      'does not set cip when the option is %s',
      (enabled) => {
        const payload = buildMatomoPayload(entry, {
          ...config,
          cloudFrontBehindCloudflare: enabled
        });
        expect(payload).not.toHaveProperty('cip');
      }
    );

    it.each([1, 2] as const)(
      'sets the visitor IP independently of recording mode %s',
      (mode) => {
        const payload = buildMatomoPayload(entry, {
          ...cloudflareConfig,
          matomoRecMode: mode
        });
        expect(payload.cip).toBe('43.166.244.192');
        expect(payload.recMode).toBe(mode);
        expect(payload).not.toHaveProperty('country');
        expect(payload).not.toHaveProperty('c-country');
        expect(payload).not.toHaveProperty('token_auth');
      }
    );

    it('uses c-ip for visitors connecting directly to CloudFront', () => {
      const payload = buildMatomoPayload(
        { ...entry, 'c-ip': '198.51.100.17' },
        cloudflareConfig
      );
      expect(payload.cip).toBe('198.51.100.17');
    });

    it('uses the Cloudflare IP when no usable forwarded IP is available', () => {
      const payload = buildMatomoPayload(
        { ...entry, 'x-forwarded-for': '43.166.244.192, invalid' },
        cloudflareConfig
      );
      expect(payload.cip).toBe('172.68.245.145');
    });

    it('omits cip when c-ip cannot be validated', () => {
      const payload = buildMatomoPayload(
        { ...entry, 'c-ip': '-' },
        cloudflareConfig
      );
      expect(payload).not.toHaveProperty('cip');
    });
  });

  it('throws when timestamp fields are missing or invalid', () => {
    const base = {
      'cs-protocol': 'https',
      'x-host-header': 'example.com',
      'cs-uri-stem': '/path',
      'cs(User-Agent)': 'AgentX'
    };
    expect(() =>
      buildMatomoPayload({ ...base, time: '12:00:00' }, config)
    ).toThrow(/timestamp/);
    expect(() =>
      buildMatomoPayload({ ...base, date: '2025-02-18' }, config)
    ).toThrow(/timestamp/);
    expect(() =>
      buildMatomoPayload(
        { ...base, date: '2025-02-18', time: '99:99:99' },
        config
      )
    ).toThrow(/timestamp/);
  });

  it('throws when config is missing matomoSiteId', () => {
    const invalidConfig = {} as MatomoConfig;
    expect(() =>
      buildMatomoPayload(
        {
          date: '2025-02-18',
          time: '12:00:00',
          'cs-protocol': 'https',
          'x-host-header': 'example.com',
          'cs-uri-stem': '/path',
          'sc-status': '200'
        },
        invalidConfig
      )
    ).toThrow(/matomoSiteId/);
  });
});
