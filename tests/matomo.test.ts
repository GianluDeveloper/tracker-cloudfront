import { describe, expect, it } from 'vitest';
import { buildMatomoPayload } from '../src/matomo.js';
import { getConfig } from '../src/config.js';
import type { MatomoConfig } from '../src/types.js';

const config = getConfig({
  MATOMO_URL: 'https://analytics.example.com',
  MATOMO_SITE_ID: '99',
  USER_AGENT_ALLOWLIST_REGEX: '.*'
});
const configNoAllowlist = { ...config, userAgentAllowlistRegex: undefined };

describe('buildMatomoPayload', () => {
  it('builds payload with full URL and converted numeric fields', () => {
    const entry = {
      date: '2025-02-18',
      time: '12:00:00',
      'cs-protocol': 'https',
      'cs(Host)': 'example.com',
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
      pf_srv: 0.123
    });
  });

  it('omits query string when empty and optional fields when missing', () => {
    const entry = {
      date: '2025-02-18',
      time: '12:00:01',
      'cs-protocol': 'http',
      'cs(Host)': 'example.com',
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
      'cs(Host)': 'example.com',
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
          'cs(Host)': 'downloads.example.com',
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
          'cs(Host)': 'example.com',
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
      'cs(Host)': 'example.com',
      'cs-uri-stem': '/path'
    };
    const payload = buildMatomoPayload(entry, configNoAllowlist);
    expect(payload.ua).toBe('');
  });

  it('throws when timestamp fields are missing or invalid', () => {
    const base = {
      'cs-protocol': 'https',
      'cs(Host)': 'example.com',
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
          'cs(Host)': 'example.com',
          'cs-uri-stem': '/path',
          'sc-status': '200'
        },
        invalidConfig
      )
    ).toThrow(/matomoSiteId/);
  });
});
