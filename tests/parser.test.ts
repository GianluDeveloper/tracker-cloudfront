import { describe, expect, it, vi } from 'vitest';
import { parseCloudFrontLog } from '../src/parser.js';

const sampleWithFields = `#Version: 1.0
#Fields: date time cs-protocol cs(Host) cs-uri-stem cs-uri-query sc-status time-taken sc-bytes cs(User-Agent)
2025-02-18 12:00:00 https example.com /path foo=bar 200 0.123 512 Mozilla/5.0
2025-02-18 12:00:01 http example.com /path2 - 404 0.200 256 curl/8.1.0
`;
const sampleWithMissingParts = `#Fields: date time cs-protocol cs(Host) cs-uri-stem cs-uri-query sc-status time-taken sc-bytes cs(User-Agent)
2025-02-18 12:00:02 https example.com - - 200 - - -
`;

describe('parseCloudFrontLog', () => {
  it('returns empty array for empty content', async () => {
    expect(await parseCloudFrontLog('')).toEqual([]);
  });

  it('parses log entries with custom #Fields', async () => {
    const entries = await parseCloudFrontLog(sampleWithFields);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
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
    });
    expect(entries[1]).toEqual({
      date: '2025-02-18',
      time: '12:00:01',
      'cs-protocol': 'http',
      'cs(Host)': 'example.com',
      'cs-uri-stem': '/path2',
      'cs-uri-query': '',
      'sc-status': '404',
      'time-taken': '0.200',
      'sc-bytes': '256',
      'cs(User-Agent)': 'curl/8.1.0'
    });
  });

  it('skips malformed lines', async () => {
    const log = `#Fields: date time cs-protocol
2025-02-18 12:00:00
2025-02-18 12:00:01 https
`;
    const entries = await parseCloudFrontLog(log);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      date: '2025-02-18',
      time: '12:00:01',
      'cs-protocol': 'https'
    });
  });

  it('logs malformed counts when provided a logger', async () => {
    const logger = {
      warn: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    };
    const log = `#Fields: date time cs-protocol
2025-02-18 12:00:00
2025-02-18 12:00:01 https
`;
    await parseCloudFrontLog(log, logger);
    expect(logger.warn).toHaveBeenCalledWith(
      'Parser skipped malformed lines',
      expect.objectContaining({ malformed: 1 })
    );
  });

  it('parses "-" as empty strings for optional-ish fields', async () => {
    const entries = await parseCloudFrontLog(sampleWithMissingParts);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      'cs-uri-stem': '',
      'cs-uri-query': '',
      'time-taken': '',
      'sc-bytes': '',
      'cs(User-Agent)': ''
    });
  });
});
