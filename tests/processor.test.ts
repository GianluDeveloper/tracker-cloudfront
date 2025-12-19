import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { sendLogLinesToMatomo } from '../src/processor.js';
import * as http from '../src/http.js';
import { sendLogContentToMatomo } from './helpers/processorHelpers.js';
import {
  createConsoleSpies,
  restoreConsoleSpies,
  type ConsoleSpies
} from './helpers/console.js';
import type { MatomoConfig } from '../src/types.js';

let consoleSpies: ConsoleSpies;

beforeEach(() => {
  consoleSpies = createConsoleSpies();
});

afterEach(() => {
  restoreConsoleSpies(consoleSpies);
});

const config: MatomoConfig = {
  matomoSiteId: 1,
  matomoUrl: 'https://analytics.example.com',
  batchSize: 10,
  matomoTimeoutMs: 2000,
  logLevel: 'info',
  userAgentAllowlistRegex: /.*/i,
  documentRegex: undefined,
  matomoTokenAuth: undefined
};
const smallConfig: MatomoConfig = {
  ...config,
  batchSize: 1,
  matomoTimeoutMs: 1000,
  logLevel: 'debug'
};

const log = `#Fields: date time cs-protocol x-host-header cs-uri-stem cs-uri-query sc-status time-taken sc-bytes cs(User-Agent)
2025-02-18 12:00:00 https example.com /path foo=bar 200 0.123 512 Mozilla/5.0
2025-02-18 12:00:01 http example.com /path2 - 404 0.200 256 curl/8.1.0
`;
const toAsyncLines = (content: string) =>
  (async function* () {
    yield* content.split('\n');
  })();

describe('buildPayloadsFromLogContent', () => {
  it('batches entries from async line iterator with provided timeout and log level', async () => {
    const sender = vi
      .spyOn(http, 'sendMatomoBatch')
      .mockResolvedValue(undefined);
    await sendLogContentToMatomo(log, smallConfig);
    expect(sender).toHaveBeenCalledTimes(2);
    sender.mock.calls.forEach((call) => {
      expect(call[0]).toBe('https://analytics.example.com');
      expect(call[2]).toBe(1000);
      expect(call[3]).toBe('debug');
    });
    sender.mockRestore();
  });

  it('skips entries with disallowed user agents', async () => {
    const sender = vi
      .spyOn(http, 'sendMatomoBatch')
      .mockResolvedValue(undefined);
    const filteredConfig = {
      ...config,
      batchSize: 10,
      matomoTimeoutMs: 1000,
      userAgentAllowlistRegex: /^curl/i
    };
    await sendLogContentToMatomo(log, filteredConfig);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0][1][0]).toContain('curl');
    sender.mockRestore();
  });

  it('counts pages and documents in summary log', async () => {
    const sender = vi
      .spyOn(http, 'sendMatomoBatch')
      .mockResolvedValue(undefined);
    const logWithDoc = `${log}2025-02-18 12:00:02 https example.com /file.pdf - 200 0.100 128 AgentX\n`;
    const docConfig = { ...config, batchSize: 10, matomoTimeoutMs: 1000 };
    await sendLogContentToMatomo(logWithDoc, docConfig);
    const summaryCall = consoleSpies.info.mock.calls.find(
      (call) => call[0] === 'Processing summary'
    );
    expect(summaryCall).toBeDefined();
    if (!summaryCall) throw new Error('Missing summary log');
    const summaryPayload = summaryCall[1] as {
      sent: number;
      skipped: number;
      pages: number;
      documents: number;
    };
    expect(summaryPayload.sent).toBe(3);
    expect(summaryPayload.skipped).toBe(0);
    expect(summaryPayload.pages + summaryPayload.documents).toBe(3);
    expect(summaryPayload.documents + summaryPayload.pages).toBe(3);
    sender.mockRestore();
  });

  it('logs and skips entries when buildMatomoPayload throws', async () => {
    const sender = vi
      .spyOn(http, 'sendMatomoBatch')
      .mockResolvedValue(undefined);
    const badLog = `#Fields: date time cs-protocol x-host-header cs-uri-stem cs-uri-query sc-status time-taken sc-bytes cs(User-Agent)
2025-02-18 12:00:00 https example.com /path foo=bar 200 0.123 512 Mozilla/5.0
2025-02-18 12:00:01 https - /missing-host foo=bar 200 0.123 512 Mozilla/5.0
`;
    await sendLogLinesToMatomo(toAsyncLines(badLog), {
      ...config,
      batchSize: 10
    });
    const summaryCall = consoleSpies.info.mock.calls.find(
      (call) => call[0] === 'Processing summary'
    );
    expect(summaryCall).toBeDefined();
    if (!summaryCall) throw new Error('Missing summary log');
    expect(summaryCall[1]).toMatchObject({ sent: 1, skipped: 1 });
    expect(consoleSpies.warn).toHaveBeenCalledWith(
      'Skipping entry due to build error',
      expect.objectContaining({ error: expect.any(String) })
    );
    sender.mockRestore();
  });

  it('propagates errors from sendMatomoBatch and logs partial progress', async () => {
    const sender = vi
      .spyOn(http, 'sendMatomoBatch')
      .mockRejectedValueOnce(new Error('matomo down'));
    const failingConfig = { ...config, batchSize: 1, matomoTimeoutMs: 1000 };
    await expect(
      sendLogLinesToMatomo(toAsyncLines(log), failingConfig)
    ).rejects.toThrow(/matomo down/);
    const summaryCall = consoleSpies.info.mock.calls.find(
      (call) => call[0] === 'Processing summary'
    );
    expect(summaryCall).toBeDefined();
    if (!summaryCall) throw new Error('Missing summary log');
    const summaryPayload = summaryCall[1] as { sent: number; skipped: number };
    expect(summaryPayload.sent + summaryPayload.skipped).toBeGreaterThan(0);
    sender.mockRestore();
  });

  it('flushes a final partial batch', async () => {
    const sender = vi
      .spyOn(http, 'sendMatomoBatch')
      .mockResolvedValue(undefined);
    const threeEntryLog = `${log}2025-02-18 12:00:02 https example.com /extra - 200 0.050 128 AgentX\n`;
    const twoBatchConfig = { ...config, batchSize: 2, matomoTimeoutMs: 1000 };
    await sendLogContentToMatomo(threeEntryLog, twoBatchConfig);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[0][1]).toHaveLength(2);
    expect(sender.mock.calls[1][1]).toHaveLength(1);
    sender.mockRestore();
  });

  it('skips all entries when user agents are disallowed', async () => {
    const sender = vi
      .spyOn(http, 'sendMatomoBatch')
      .mockResolvedValue(undefined);
    const filteredConfig = {
      ...config,
      batchSize: 5,
      userAgentAllowlistRegex: /^BlockedUA$/i
    };
    await sendLogContentToMatomo(log, filteredConfig);
    expect(sender).not.toHaveBeenCalled();
    const summaryCall = consoleSpies.info.mock.calls.find(
      (call) => call[0] === 'Processing summary'
    );
    expect(summaryCall).toBeDefined();
    if (summaryCall) {
      expect(summaryCall[1]).toMatchObject({ sent: 0, skipped: 2 });
    }
    sender.mockRestore();
  });
});
