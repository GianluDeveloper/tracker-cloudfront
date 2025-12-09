import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  S3Client
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { createGunzip } from 'zlib';
import type { ReadableStream as NodeReadableStream } from 'stream/web';
import { createLogger } from './logger.js';
import type { LogLevel } from './types.js';
import { linesFromStream } from './utils.js';

const client = new S3Client({});

const toNodeReadable = (body: GetObjectCommandOutput['Body']): Readable => {
  if (!body) throw new Error('S3 object has no body');
  if (body instanceof Readable) return body;
  const readableCandidate = body as unknown as Readable;
  if (typeof readableCandidate.pipe === 'function') {
    return readableCandidate;
  }
  if (
    typeof (body as { getReader?: unknown }).getReader === 'function' &&
    Readable.fromWeb
  ) {
    return Readable.fromWeb(body as unknown as NodeReadableStream);
  }
  if (
    typeof (body as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  ) {
    return Readable.from(body as AsyncIterable<unknown>);
  }
  throw new Error('Unsupported S3 Body type');
};

export async function getObjectLineIterator(
  bucket: string,
  key: string,
  logLevel: LogLevel = 'info'
): Promise<AsyncGenerator<string>> {
  const log = createLogger(logLevel);
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await client.send(command);
  log.info('S3 getObject start', {
    bucket,
    key,
    contentLength: response.ContentLength
  });
  const bodyStream = toNodeReadable(response.Body);
  const gunzip = createGunzip();
  const decompressed = bodyStream.pipe(gunzip);
  bodyStream.on('error', (err: Error) => decompressed.destroy(err));
  gunzip.on('error', (err: Error) => decompressed.destroy(err));
  let count = 0;
  const lines = linesFromStream(decompressed);
  async function* loggedLines(): AsyncGenerator<string> {
    try {
      for await (const line of lines) {
        count += 1;
        yield line;
      }
      log.info('S3 getObject complete', { bucket, key, lines: count });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('S3 stream error', {
        bucket,
        key,
        lines: count,
        error: message
      });
      throw err instanceof Error ? err : new Error(message);
    }
  }
  return loggedLines();
}
