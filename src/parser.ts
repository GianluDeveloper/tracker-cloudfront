import type { CloudFrontLogEntry, Logger } from './types.js';

const defaultFields = [
  'date',
  'time',
  'cs-method',
  'cs-protocol',
  'x-host-header',
  'cs-uri-stem',
  'cs-uri-query',
  'sc-status',
  'time-taken',
  'sc-bytes',
  'cs(User-Agent)'
];

export async function parseCloudFrontLog(
  content: string,
  log?: Logger
): Promise<CloudFrontLogEntry[]> {
  if (!content) return [];
  const entries: CloudFrontLogEntry[] = [];
  for await (const entry of parseCloudFrontLines(content.split('\n'), log)) {
    entries.push(entry);
  }
  return entries;
}

export async function* parseCloudFrontLines(
  lines: AsyncIterable<string> | Iterable<string>,
  log?: Logger
): AsyncGenerator<CloudFrontLogEntry> {
  let fields = defaultFields;
  let malformed = 0;

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#Fields:')) {
      fields = line.slice('#Fields:'.length).trim().split(/\s+/);
      if (log) {
        log.debug('Parser detected fields header', { fields });
      }
      continue;
    }
    if (line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    if (parts.length < fields.length) {
      // Skip malformed line
      malformed += 1;
      continue;
    }

    const entry: CloudFrontLogEntry = {};
    for (let i = 0; i < fields.length; i += 1) {
      entry[fields[i]] = parts[i] === '-' ? '' : parts[i];
    }
    yield entry;
  }

  if (log && malformed > 0) {
    log.warn('Parser skipped malformed lines', { malformed });
  }
}
