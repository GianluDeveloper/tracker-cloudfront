import { parseCloudFrontLines } from './parser.js';
import { buildMatomoPayload } from './matomo.js';
import { buildMatomoRequestPayload, sendMatomoBatch } from './http.js';
import { createLogger } from './logger.js';
import { isHttpMethodAllowed, isUserAgentAllowed } from './utils.js';
import type { MatomoConfig } from './types.js';

export async function sendLogLinesToMatomo(
  lines: AsyncIterable<string>,
  config: MatomoConfig
): Promise<void> {
  const logLevel = config.logLevel;
  const log = createLogger(logLevel);
  let batchIndex = 0;
  let batch: string[] = [];
  let sent = 0;
  let skipped = 0;
  let pages = 0;
  let documents = 0;
  const allowRegex = config.userAgentAllowlistRegex;
  const httpMethodAllowlist = config.httpMethodAllowlist;
  const urlExcludeRegex = config.urlExcludeRegex;
  try {
    for await (const entry of parseCloudFrontLines(lines, log)) {
      if (!isUserAgentAllowed(entry, allowRegex)) {
        skipped += 1;
        continue;
      }
      if (!isHttpMethodAllowed(entry, httpMethodAllowlist)) {
        skipped += 1;
        continue;
      }
      try {
        const payload = buildMatomoPayload(entry, config);
        if (urlExcludeRegex && urlExcludeRegex.test(payload.url)) {
          skipped += 1;
          continue;
        }
        if (payload.download) {
          documents += 1;
        } else {
          pages += 1;
        }
        batch.push(buildMatomoRequestPayload(payload));
        sent += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn('Skipping entry due to build error', { error: message });
        skipped += 1;
        continue;
      }
      if (batch.length >= config.batchSize) {
        log.info('Sending Matomo batch', {
          batchIndex,
          size: batch.length
        });
        await sendMatomoBatch(
          config.matomoUrl,
          batch,
          config.matomoTimeoutMs,
          logLevel,
          config.matomoTokenAuth
        );
        batchIndex += 1;
        batch = [];
      }
    }
    if (batch.length) {
      log.info('Sending Matomo final batch', {
        batchIndex,
        size: batch.length
      });
      await sendMatomoBatch(
        config.matomoUrl,
        batch,
        config.matomoTimeoutMs,
        logLevel,
        config.matomoTokenAuth
      );
    }
  } finally {
    log.info('Processing summary', { sent, skipped, pages, documents });
  }
}
