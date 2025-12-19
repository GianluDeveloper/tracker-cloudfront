import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import https from 'https';
import type { IncomingMessage } from 'http';
import { buildMatomoRequestPayload, sendMatomoBatch } from '../src/http.js';
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
  vi.useRealTimers();
});

describe('buildMatomoRequestPayload', () => {
  it('builds query string payload', () => {
    const qs = buildMatomoRequestPayload({
      idsite: 1,
      url: 'https://example.com/path?foo=bar',
      ua: 'AgentX',
      rec: 1
    });

    expect(qs).toContain('idsite=1');
    expect(qs).toContain('rec=1');
    expect(qs).toContain('url=https%3A%2F%2Fexample.com%2Fpath%3Ffoo%3Dbar');
    expect(qs).toContain('ua=AgentX');
    expect(qs.startsWith('?')).toBe(true);
  });
});

describe('sendMatomoBatch', () => {
  type MockResponse = {
    statusCode: number;
    on: (event: string, handler: (chunk?: Buffer) => void) => void;
  };

  const makeResponse = (status = 200, body = ''): MockResponse => ({
    statusCode: status,
    on(event, handler) {
      if (event === 'data') handler(Buffer.from(body));
      if (event === 'end') handler();
    }
  });

  const buildRequestMock = (
    res: MockResponse,
    callback?: (res: IncomingMessage) => void
  ) =>
    ({
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(() => callback?.(res as unknown as IncomingMessage)),
      destroy: vi.fn()
    }) as unknown as ReturnType<typeof https.request>;

  it('sends POST request with batch payload and auth when provided', async () => {
    const requestSpy = vi
      .spyOn(https, 'request')
      .mockImplementation(
        (
          _url: string | URL,
          _options: https.RequestOptions,
          callback?: (res: IncomingMessage) => void
        ) => buildRequestMock(makeResponse(204), callback)
      );

    await sendMatomoBatch(
      'https://analytics.example.com',
      [{ idsite: 1, rec: 1 }],
      1000,
      'info',
      'token123'
    );

    expect(requestSpy).toHaveBeenCalled();
    const [url, options] = requestSpy.mock.calls[0] as [
      string | URL,
      https.RequestOptions
    ];
    expect(String(url)).toContain('/matomo.php');
    expect(options.method).toBe('POST');
    const headers = options.headers as Record<string, string>;
    expect(headers?.['Content-Type']).toBe('application/json');
    expect(headers?.Authorization).toBe('Bearer token123');

    requestSpy.mockRestore();
  });

  it('preserves subdirectory when building Matomo endpoint', async () => {
    const requestSpy = vi
      .spyOn(https, 'request')
      .mockImplementation(
        (
          _url: string | URL,
          _options: https.RequestOptions,
          callback?: (res: IncomingMessage) => void
        ) => buildRequestMock(makeResponse(204), callback)
      );

    await sendMatomoBatch(
      'https://analytics.example.com/matomo',
      [{ idsite: 1 }],
      1000
    );

    const url = requestSpy.mock.calls[0]?.[0] as string | URL;
    expect(String(url)).toContain('/matomo/matomo.php');

    requestSpy.mockRestore();
  });

  it('avoids double matomo.php when base includes it', async () => {
    const requestSpy = vi
      .spyOn(https, 'request')
      .mockImplementation(
        (
          _url: string | URL,
          _options: https.RequestOptions,
          callback?: (res: IncomingMessage) => void
        ) => buildRequestMock(makeResponse(204), callback)
      );

    await sendMatomoBatch(
      'https://analytics.example.com/matomo.php',
      [{ idsite: 1 }],
      1000
    );

    const url = requestSpy.mock.calls[0]?.[0] as string | URL;
    expect(String(url)).toContain('/matomo.php');
    expect(String(url)).not.toContain('/matomo.php/matomo.php');

    requestSpy.mockRestore();
  });

  it('treats 204 with empty body as success', async () => {
    const requestSpy = vi
      .spyOn(https, 'request')
      .mockImplementation(
        (
          _url: string | URL,
          _options: https.RequestOptions,
          callback?: (res: IncomingMessage) => void
        ) => buildRequestMock(makeResponse(204, ''), callback)
      );

    await expect(
      sendMatomoBatch('https://analytics.example.com', [{ idsite: 1 }], 1000)
    ).resolves.toBeUndefined();
    expect(requestSpy).toHaveBeenCalledTimes(1);
    requestSpy.mockRestore();
  });

  it('retries on failure and eventually succeeds', async () => {
    vi.useFakeTimers();
    const responses = [
      makeResponse(500),
      makeResponse(500),
      makeResponse(200, 'success')
    ];
    const requestSpy = vi
      .spyOn(https, 'request')
      .mockImplementation(
        (
          _url: string | URL,
          _options: https.RequestOptions,
          callback?: (res: IncomingMessage) => void
        ) => {
          const res = responses.shift() ?? makeResponse(500);
          return buildRequestMock(res, callback);
        }
      );

    const promise = sendMatomoBatch(
      'https://analytics.example.com',
      [{ idsite: 1, rec: 1 }],
      50
    );
    await vi.runAllTimersAsync();
    await promise;
    expect(requestSpy).toHaveBeenCalledTimes(3);
    requestSpy.mockRestore();
  });

  it('throws after max retries', async () => {
    vi.useFakeTimers();
    const requestSpy = vi
      .spyOn(https, 'request')
      .mockImplementation(
        (
          _url: string | URL,
          _options: https.RequestOptions,
          callback?: (res: IncomingMessage) => void
        ) => buildRequestMock(makeResponse(500), callback)
      );

    const promise = sendMatomoBatch(
      'https://analytics.example.com',
      [{ idsite: 1 }],
      50
    );
    const swallowed = promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow(/status 500/);
    await swallowed;
    expect(requestSpy).toHaveBeenCalledTimes(3);
    requestSpy.mockRestore();
  });

  it('treats 200 with error body as failure', async () => {
    vi.useFakeTimers();
    const responses = [
      makeResponse(200, '{"status":"error","message":"bad auth"}'),
      makeResponse(200, 'success')
    ];
    const requestSpy = vi
      .spyOn(https, 'request')
      .mockImplementation(
        (
          _url: string | URL,
          _options: https.RequestOptions,
          callback?: (res: IncomingMessage) => void
        ) => {
          const res = responses.shift() ?? makeResponse(500);
          return buildRequestMock(res, callback);
        }
      );

    const promise = sendMatomoBatch(
      'https://analytics.example.com',
      [{ idsite: 1 }],
      50
    );
    const swallowed = promise.catch(() => {});
    await expect(promise).rejects.toThrow(/Matomo error response/);
    await swallowed;

    // logical failure should not retry
    expect(requestSpy).toHaveBeenCalledTimes(1);
    requestSpy.mockRestore();
  });

  it('handles timeout and request error paths and retries transport failures', async () => {
    vi.useFakeTimers();
    let callIndex = 0;
    const requestSpy = vi
      .spyOn(https, 'request')
      .mockImplementation(
        (
          _url: string | URL,
          _options: https.RequestOptions,
          callback?: (res: IncomingMessage) => void
        ) => {
          callIndex += 1;
          const res =
            callIndex === 3 ? makeResponse(200, 'success') : makeResponse(500);
          const handlers: Record<string, (...args: unknown[]) => void> = {};
          const req = {
            on: vi.fn(
              (event: string, handler: (...args: unknown[]) => void) => {
                handlers[event] = handler;
              }
            ),
            write: vi.fn(),
            end: vi.fn(() => {
              if (callIndex === 1) {
                setTimeout(() => {
                  handlers.timeout?.();
                  handlers.error?.(new Error('Request timed out'));
                }, 0);
              } else if (callIndex === 2) {
                setTimeout(() => handlers.error?.(new Error('boom')), 0);
              } else {
                setTimeout(
                  () => callback?.(res as unknown as IncomingMessage),
                  0
                );
              }
            }),
            destroy: vi.fn((err?: unknown) =>
              handlers.error?.((err as Error) || new Error('destroyed'))
            )
          };
          return req as unknown as ReturnType<typeof https.request>;
        }
      );

    const promise = sendMatomoBatch(
      'https://analytics.example.com',
      [{ idsite: 1 }],
      50
    );
    const swallowed = promise.catch(() => {});
    await vi.runAllTimersAsync();
    await promise;
    await swallowed;
    expect(requestSpy).toHaveBeenCalledTimes(3);
    requestSpy.mockRestore();
  });

  it('does not retry on non-retriable 4xx status', async () => {
    const requestSpy = vi
      .spyOn(https, 'request')
      .mockImplementation(
        (
          _url: string | URL,
          _options: https.RequestOptions,
          callback?: (res: IncomingMessage) => void
        ) => buildRequestMock(makeResponse(401, '{"status":"error"}'), callback)
      );

    await expect(
      sendMatomoBatch('https://analytics.example.com', [{ idsite: 1 }], 50)
    ).rejects.toThrow(/non-retriable status/);
    expect(requestSpy).toHaveBeenCalledTimes(1);
    requestSpy.mockRestore();
  });

  it('retries on 429 rate limit responses', async () => {
    vi.useFakeTimers();
    const responses = [
      makeResponse(429, '{"status":"error","message":"rate limit"}'),
      makeResponse(429, '{"status":"error","message":"rate limit"}'),
      makeResponse(200, 'success')
    ];
    const requestSpy = vi
      .spyOn(https, 'request')
      .mockImplementation(
        (
          _url: string | URL,
          _options: https.RequestOptions,
          callback?: (res: IncomingMessage) => void
        ) => {
          const res = responses.shift() ?? makeResponse(500);
          return buildRequestMock(res, callback);
        }
      );

    const promise = sendMatomoBatch(
      'https://analytics.example.com',
      [{ idsite: 1 }],
      50
    );
    await vi.runAllTimersAsync();
    await promise;
    expect(requestSpy).toHaveBeenCalledTimes(3);
    requestSpy.mockRestore();
  });
});
