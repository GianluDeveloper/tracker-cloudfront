import { Readable } from 'stream';
import { gzipSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { getObjectLineIterator } from '../src/s3.js';
import { MockS3Client } from './s3.mock.js';
import {
  createConsoleSpies,
  restoreConsoleSpies,
  type ConsoleSpies
} from './helpers/console.js';

describe('getObjectBody', () => {
  let consoleSpies: ConsoleSpies;

  beforeEach(() => {
    consoleSpies = createConsoleSpies();
  });

  afterEach(() => {
    restoreConsoleSpies(consoleSpies);
  });

  it('streams and gunzips object to lines', async () => {
    const mockClient = new MockS3Client({ 'bucket/key': 'hello' });
    const sendSpy = vi
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation((command) =>
        mockClient.send(
          command as unknown as { input: { Bucket: string; Key: string } }
        )
      );
    const linesIterator = await getObjectLineIterator('bucket', 'key', 'info');
    const lines = [];
    for await (const line of linesIterator) {
      lines.push(line);
    }
    expect(lines).toEqual(['hello']);
    expect(mockClient.sent[0]).toEqual({ Bucket: 'bucket', Key: 'key' });
    sendSpy.mockRestore();
  });

  it('logs and rethrows on errors after processing some lines', async () => {
    const gzBuffer = gzipSync('hello\nsecond\n');
    const gzStream = new Readable({
      read() {
        this.push(gzBuffer);
        setImmediate(() => this.destroy(new Error('boom')));
      }
    });
    const mockClient = new MockS3Client({
      'bucket/key': gzStream
    });
    const sendSpy = vi
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation((command) =>
        mockClient.send(
          command as unknown as { input: { Bucket: string; Key: string } }
        )
      );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const iter = await getObjectLineIterator('bucket', 'key', 'info');
      await expect(
        (async () => {
          for await (const line of iter) {
            void line; // consume until stream error
          }
        })()
      ).rejects.toThrow(/boom/);
      expect(errorSpy).toHaveBeenCalledWith(
        'S3 stream error',
        expect.objectContaining({
          bucket: 'bucket',
          key: 'key',
          lines: expect.any(Number),
          error: 'boom'
        })
      );
    } finally {
      errorSpy.mockRestore();
      sendSpy.mockRestore();
    }
  });

  it('errors on non-gzipped object bodies', async () => {
    const plainStream = Readable.from(['hello world\n']);
    const mockClient = new MockS3Client({
      'bucket/plain': plainStream
    });
    const sendSpy = vi
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation((command) =>
        mockClient.send(
          command as unknown as { input: { Bucket: string; Key: string } }
        )
      );

    await expect(
      getObjectLineIterator('bucket', 'plain', 'info').then(async (iter) => {
        for await (const line of iter) {
          void line;
        }
      })
    ).rejects.toThrow();
    sendSpy.mockRestore();
  });
});
