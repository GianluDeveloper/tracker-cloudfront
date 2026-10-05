import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRequestsFromFile } from '../scripts/parseLog.js';
import { getConfig } from '../src/config.js';
import type { MatomoConfig } from '../src/types.js';

const config: MatomoConfig = {
  matomoSiteId: 1,
  matomoUrl: 'https://analytics.example.com',
  batchSize: 10,
  matomoTimeoutMs: 1000,
  logLevel: 'info',
  userAgentAllowlistRegex: /.*/i,
  httpMethodAllowlist: ['GET']
};

const sampleLog = `#Fields: date time cs-method cs-protocol x-host-header cs-uri-stem cs-uri-query sc-status time-taken sc-bytes cs(User-Agent)
2025-02-18 12:00:00 GET https example.com /path foo=bar 200 0.123 512 Mozilla/5.0
`;

async function writeTempFile(contents: string, gz = false) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-log-'));
  const filePath = path.join(tmpDir, gz ? 'log.gz' : 'log.log');
  if (gz) {
    const compressed = gzipSync(contents, { level: 1 });
    await fs.writeFile(filePath, compressed);
  } else {
    await fs.writeFile(filePath, contents);
  }
  return { filePath, tmpDir };
}

describe('buildRequestsFromFile', () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tmpDirs.splice(0).map(async (dir) => {
        try {
          await fs.rm(dir, { recursive: true, force: true });
        } catch {
          // ignore cleanup failures
        }
      })
    );
  });

  it('parses plain log file', async () => {
    const { filePath, tmpDir } = await writeTempFile(sampleLog, false);
    tmpDirs.push(tmpDir);
    const requests = await buildRequestsFromFile(filePath, config);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('idsite=1');
    expect(requests[0]).toContain(
      'url=https%3A%2F%2Fexample.com%2Fpath%3Ffoo%3Dbar'
    );
  });

  it('parses gzipped log file', async () => {
    const { filePath, tmpDir } = await writeTempFile(sampleLog, true);
    tmpDirs.push(tmpDir);
    const requests = await buildRequestsFromFile(filePath, config);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('idsite=1');
  });

  it.each([false, true])(
    'builds Matomo requests from JSON Lines using environment fallbacks (gzip: %s)',
    async (gz) => {
      const entry = {
        date: '2026-09-10',
        time: '11:05:16',
        'cs-method': 'GET',
        'cs-uri-stem': '/chi-sono/',
        'cs-uri-query': '-',
        'cs(User-Agent)': 'Mozilla/5.0%20(iPhone)',
        'sc-status': '200',
        'sc-bytes': '4987',
        'time-taken': '0.722'
      };
      const { filePath, tmpDir } = await writeTempFile(
        `${JSON.stringify(entry)}\n`,
        gz
      );
      tmpDirs.push(tmpDir);
      const fallbackConfig = getConfig({
        MATOMO_URL: 'https://analytics.example.com',
        MATOMO_SITE_ID: '1',
        CLOUDFRONT_DEFAULT_PROTOCOL: 'https',
        CLOUDFRONT_DEFAULT_HOST: 'www.example.com',
        USER_AGENT_ALLOWLIST_REGEX: '.*'
      });
      const requests = await buildRequestsFromFile(filePath, fallbackConfig);
      expect(requests).toHaveLength(1);
      const params = new URLSearchParams(requests[0].slice(1));
      expect(params.get('url')).toBe('https://www.example.com/chi-sono/');
      expect(params.get('cdt')).toBe('2026-09-10 11:05:16');
      expect(params.get('http_status')).toBe('200');
      expect(params.get('bw_bytes')).toBe('4987');
      expect(params.get('pf_srv')).toBe('722');
    }
  );
});
