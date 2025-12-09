import type {
  GetObjectCommand,
  GetObjectCommandInput
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { gzipSync } from 'zlib';

type MockBody = string | AsyncIterable<unknown> | Readable | Error;

export class MockS3Client {
  responses: Record<string, MockBody>;
  sent: Array<{ Bucket: string; Key: string }>;

  constructor(responses: Record<string, MockBody>) {
    this.responses = responses;
    this.sent = [];
  }

  async send(command: GetObjectCommand | { input: GetObjectCommandInput }) {
    const input = command.input;
    if (!input.Bucket || !input.Key) {
      throw new Error('Bucket and Key are required');
    }
    this.sent.push(input as { Bucket: string; Key: string });
    const key = `${input.Bucket}/${input.Key}`;
    const body = this.responses[key];
    if (body === undefined) throw new Error('No mock response');
    if (typeof body === 'string') {
      const gzipped = gzipSync(body, { level: 1 });
      return { Body: Readable.from([gzipped]) };
    }
    if (
      body &&
      typeof (body as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
        'function'
    ) {
      return { Body: Readable.from(body as AsyncIterable<unknown>) };
    }
    if (body instanceof Error) {
      const errStream = new Readable({
        read() {
          this.destroy(body);
        }
      });
      return { Body: errStream };
    }
    return { Body: body };
  }
}
