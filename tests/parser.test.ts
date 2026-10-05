import { describe, expect, it, vi } from 'vitest';
import { parseCloudFrontLog } from '../src/parser.js';

const sampleWithFields = `#Version: 1.0
#Fields: date time cs-method cs-protocol x-host-header cs-uri-stem cs-uri-query sc-status time-taken sc-bytes cs(User-Agent)
2025-02-18 12:00:00 GET https example.com /path foo=bar 200 0.123 512 Mozilla/5.0
2025-02-18 12:00:01 GET http example.com /path2 - 404 0.200 256 curl/8.1.0
`;
const sampleWithMissingParts = `#Fields: date time cs-protocol x-host-header cs-uri-stem cs-uri-query sc-status time-taken sc-bytes cs(User-Agent)
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
      'cs-method': 'GET',
      'cs-protocol': 'https',
      'x-host-header': 'example.com',
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
      'cs-method': 'GET',
      'cs-protocol': 'http',
      'x-host-header': 'example.com',
      'cs-uri-stem': '/path2',
      'cs-uri-query': '',
      'sc-status': '404',
      'time-taken': '0.200',
      'sc-bytes': '256',
      'cs(User-Agent)': 'curl/8.1.0'
    });
  });

  it('parses JSON Lines with spaces and normalizes optional and numeric fields', async () => {
    const entry = {
      date: '2026-09-10',
      time: '11:05:16',
      'cs-method': 'GET',
      'cs-uri-stem': '/chi-sono/',
      'cs-uri-query': '-',
      'cs(Referer)': null,
      'cs(User-Agent)': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3)',
      'sc-status': 200,
      'time-taken': 0.722
    };
    const entries = await parseCloudFrontLog(
      `${JSON.stringify(entry)}\r\n${JSON.stringify({ ...entry, 'cs-uri-stem': '/' })}`
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      ...entry,
      'cs-uri-query': '',
      'cs(Referer)': '',
      'sc-status': '200',
      'time-taken': '0.722'
    });
    expect(entries[1]['cs-uri-stem']).toBe('/');
  });

  it('skips invalid JSON and nested values and continues reading valid lines', async () => {
    const logger = {
      warn: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    };
    const content = [
      '{invalid json}',
      '[]',
      '{"date": {"value": "2026-09-10"}}',
      '{"date": ["2026-09-10"]}',
      '{"date": "2026-09-10", "time": "11:05:16"}'
    ].join('\n');
    expect(await parseCloudFrontLog(content, logger)).toEqual([
      { date: '2026-09-10', time: '11:05:16' }
    ]);
    expect(logger.warn).toHaveBeenCalledWith('Parser skipped malformed lines', {
      malformed: 4
    });
  });

  it('can parse JSON Lines alongside logs with a #Fields header', async () => {
    const entries = await parseCloudFrontLog(
      `${sampleWithFields}{"date":"2026-09-10","time":"11:05:16"}\n`
    );
    expect(entries).toHaveLength(3);
    expect(entries[2]).toEqual({ date: '2026-09-10', time: '11:05:16' });
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
