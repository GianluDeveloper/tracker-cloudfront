import type { Readable } from 'stream';
import type { CloudFrontLogEntry } from './types.js';

export const isUserAgentAllowed = (
  entry: CloudFrontLogEntry | undefined,
  regex?: RegExp
): boolean => {
  const ua = entry?.['cs(User-Agent)'];
  if (!regex) return true;
  if (!ua) return false;
  return regex.test(ua);
};

export const isHttpMethodAllowed = (
  entry: CloudFrontLogEntry | undefined,
  allowlist?: readonly string[]
): boolean => {
  const method = entry?.['cs-method'];
  if (!allowlist || allowlist.length === 0) return true;
  if (!method) return false;
  return allowlist.includes(method.toUpperCase());
};

export async function* linesFromStream(
  stream: Readable
): AsyncGenerator<string> {
  let buffer = '';
  let streamError: unknown;
  const onError = (err: unknown) => {
    streamError = err;
  };
  stream.on?.('error', onError);
  try {
    for await (const chunk of stream) {
      const text =
        typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString('utf-8')
            : (chunk?.toString?.('utf-8') ?? '');
      buffer += text;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        yield line;
      }
    }
    if (streamError) {
      throw streamError;
    }
    if (buffer.length) {
      yield buffer.replace(/\r$/, '');
    }
  } finally {
    stream.off?.('error', onError);
  }
}
