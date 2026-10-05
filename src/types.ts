export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export type CloudFrontLogEntry = Record<string, string>;

export interface MatomoConfig {
  matomoUrl: string;
  matomoSiteId: number;
  matomoTokenAuth?: string;
  matomoRecMode?: 1 | 2;
  cloudFrontDefaultProtocol?: string;
  cloudFrontDefaultHost?: string;
  batchSize: number;
  matomoTimeoutMs: number;
  logLevel: LogLevel;
  userAgentAllowlistRegex?: RegExp;
  httpMethodAllowlist?: string[];
  documentRegex?: RegExp;
  urlExcludeRegex?: RegExp;
}

export interface MatomoPayload {
  [key: string]: string | number | boolean | undefined;
  idsite: number;
  rec: 1;
  recMode: 1 | 2;
  url: string;
  source: 'CloudFront';
  cdt: string;
  ua: string;
  download?: string;
  http_status?: number | string;
  bw_bytes?: number | string;
  pf_srv?: number | string;
}
