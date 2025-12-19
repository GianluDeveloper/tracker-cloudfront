import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as processor from '../src/processor.js';
import * as s3 from '../src/s3.js';
import { handler } from '../src/index.js';
import {
  createConsoleSpies,
  restoreConsoleSpies,
  type ConsoleSpies
} from './helpers/console.js';

let consoleSpies: ConsoleSpies;

beforeEach(() => {
  consoleSpies = createConsoleSpies();
});

afterEach(() => {
  restoreConsoleSpies(consoleSpies);
});

describe('handler', () => {
  it('returns ok for empty event', async () => {
    const response = await handler({});
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, records: 0 });
  });

  it('counts Records when provided', async () => {
    const response = await handler({ Records: [{}, {}] });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, records: 2 });
  });

  it('processes S3 records', async () => {
    const log = `#Fields: date time cs-method cs-protocol x-host-header cs-uri-stem cs-uri-query sc-status time-taken sc-bytes cs(User-Agent)
2025-02-18 12:00:00 GET https example.com /path foo=bar 200 0.123 512 Mozilla/5.0
`;
    const originalEnv = { ...process.env };
    process.env.MATOMO_URL = 'https://analytics.example.com';
    process.env.MATOMO_SITE_ID = '7';
    const sendSpy = vi
      .spyOn(processor, 'sendLogLinesToMatomo')
      .mockResolvedValue(undefined);
    const s3Spy = vi.spyOn(s3, 'getObjectLineIterator').mockResolvedValue(
      (async function* () {
        yield* log.split('\n');
      })()
    );

    try {
      const response = await handler({
        Records: [
          { s3: { bucket: { name: 'bucket' }, object: { key: 'key' } } }
        ]
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.records).toBe(1);
      expect(body.processed).toBe(1);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(s3Spy).toHaveBeenCalledWith('bucket', 'key', 'warn');
    } finally {
      process.env = originalEnv;
      sendSpy.mockRestore();
      s3Spy.mockRestore();
    }
  });

  it('returns 500 when config is missing', async () => {
    const originalEnv = { ...process.env };
    delete process.env.MATOMO_URL;
    delete process.env.MATOMO_SITE_ID;
    const response = await handler({
      Records: [{ s3: { bucket: { name: 'bucket' }, object: { key: 'key' } } }]
    });
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatch(/MATOMO_URL is required/);
    process.env = originalEnv;
  });

  it('returns 500 when S3 iterator fails', async () => {
    const originalEnv = { ...process.env };
    process.env.MATOMO_URL = 'https://analytics.example.com';
    process.env.MATOMO_SITE_ID = '7';
    vi.spyOn(s3, 'getObjectLineIterator').mockRejectedValue(new Error('boom'));

    try {
      const response = await handler({
        Records: [
          { s3: { bucket: { name: 'bucket' }, object: { key: 'key' } } }
        ]
      });
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).error).toMatch(/boom/);
    } finally {
      process.env = originalEnv;
      vi.restoreAllMocks();
    }
  });
});
