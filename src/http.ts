import https, { type RequestOptions } from 'https';
import type { ClientRequest, IncomingMessage } from 'http';
import { URL } from 'url';
import { createLogger } from './logger.js';
import type { LogLevel } from './types.js';

type MatomoBatchPayload = Array<string | Record<string, unknown>>;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function buildMatomoRequestPayload(
  payload: Record<string, string | number | boolean | null | undefined>
): string {
  const search = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.append(key, String(value));
    }
  });
  return `?${search.toString()}`;
}

export async function sendMatomoBatch(
  matomoUrl: string,
  payloads: MatomoBatchPayload,
  timeoutMs = 5000,
  logLevel: LogLevel = 'info',
  tokenAuth?: string
): Promise<void> {
  const url = new URL('/matomo.php', matomoUrl);
  const body = JSON.stringify({ requests: payloads });
  const log = createLogger(logLevel);

  const requestOptions: RequestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(tokenAuth ? { Authorization: `Bearer ${tokenAuth}` } : {})
    },
    timeout: timeoutMs
  };

  const parseResponse = (
    statusCode: number | undefined,
    responseBody: string
  ) => {
    const trimmed = (responseBody || '').trim();
    if (!trimmed && statusCode === 204)
      return { ok: true, message: 'no content' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null;
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      ('status' in parsed || 'success' in parsed)
    ) {
      const status = (parsed as { status?: string }).status;
      const success = (parsed as { success?: boolean }).success;
      if (status === 'success' || success === true) {
        return { ok: true, message: status || 'success' };
      }
    }
    if (parsed && typeof parsed === 'object') {
      const error = (parsed as { error?: unknown }).error;
      const errors = (parsed as { errors?: unknown }).errors;
      if (error || errors) {
        const msg =
          typeof error === 'string' ? error : JSON.stringify(error ?? errors);
        return { ok: false, message: msg };
      }
    }
    if (!parsed) {
      const lower = trimmed.toLowerCase();
      if (!trimmed || lower === 'success' || lower === 'ok') {
        return { ok: true, message: trimmed || 'success' };
      }
      return { ok: false, message: trimmed };
    }
    return { ok: false, message: trimmed || 'Unknown Matomo response' };
  };

  const maxAttempts = 3;
  const baseDelayMs = 1000;
  const maxDelayMs = 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptLog = {
      attempt,
      url: url.toString(),
      payloadCount: payloads.length,
      timeoutMs
    };
    try {
      log.info('Matomo batch send start', attemptLog);
      await new Promise<void>((resolve, reject) => {
        const req: ClientRequest = https.request(
          url,
          requestOptions,
          (res: IncomingMessage) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => {
              chunks.push(chunk);
            });
            res.on('end', () => {
              const responseBody = Buffer.concat(chunks).toString('utf-8');
              if (
                res.statusCode &&
                res.statusCode >= 200 &&
                res.statusCode < 300
              ) {
                const parsed = parseResponse(res.statusCode, responseBody);
                if (parsed.ok) {
                  log.info('Matomo batch send success', {
                    ...attemptLog,
                    statusCode: res.statusCode,
                    message: parsed.message
                  });
                  resolve();
                } else {
                  log.error('Matomo batch logical failure (no retry)', {
                    ...attemptLog,
                    statusCode: res.statusCode,
                    message: parsed.message?.slice(0, 500)
                  });
                  reject(
                    new Error(
                      parsed.message
                        ? `Matomo error response: ${parsed.message}`
                        : 'Matomo error response'
                    )
                  );
                }
              } else if (
                res.statusCode &&
                res.statusCode >= 400 &&
                res.statusCode < 500 &&
                res.statusCode !== 429
              ) {
                log.error('Matomo batch non-retriable status', {
                  ...attemptLog,
                  statusCode: res.statusCode,
                  body: responseBody.slice(0, 500)
                });
                reject(
                  new Error(
                    `Matomo non-retriable status ${res.statusCode}: ${responseBody || 'unknown error'}`
                  )
                );
              } else {
                log.warn('Matomo batch send non-2xx', {
                  ...attemptLog,
                  statusCode: res.statusCode
                });
                reject(
                  new Error(
                    `Matomo responded with status ${res.statusCode ?? 'unknown'}`
                  )
                );
              }
            });
          }
        );
        req.on('error', reject);
        req.on('timeout', () => {
          log.warn('Matomo batch send timeout', attemptLog);
          req.destroy(new Error('Request timed out'));
        });
        req.write(body);
        req.end();
      });
      return;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const isLogicalFailure =
        typeof error.message === 'string' &&
        error.message.toLowerCase().includes('matomo error response');
      const isPermanentStatus =
        typeof error.message === 'string' &&
        error.message.toLowerCase().includes('non-retriable status');
      if (attempt >= maxAttempts || isLogicalFailure) {
        log.error(
          isLogicalFailure
            ? 'Matomo batch failed logically (no retry)'
            : 'Matomo batch send failed after retries',
          {
            ...attemptLog,
            error: error.message
          }
        );
        throw error;
      }
      if (isPermanentStatus) {
        log.error('Matomo batch non-retriable (no retry)', {
          ...attemptLog,
          error: error.message
        });
        throw error;
      }
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      log.warn('Matomo batch send retrying', {
        ...attemptLog,
        backoffMs: backoff,
        error: error.message
      });
      await delay(backoff);
    }
  }
}
