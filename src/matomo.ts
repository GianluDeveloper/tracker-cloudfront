import type {
  CloudFrontLogEntry,
  MatomoConfig,
  MatomoPayload
} from './types.js';

const toIntIfNumeric = (value?: string) => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? value : parsed;
};

const secondsToMsIntIfNumeric = (value?: string) => {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return value;
  return Math.round(parsed * 1000);
};

export function buildMatomoPayload(
  entry: CloudFrontLogEntry,
  config: MatomoConfig
): MatomoPayload {
  if (!config || !config.matomoSiteId) {
    throw new Error('matomoSiteId is required in config');
  }

  const date = entry.date;
  const time = entry.time;
  if (!date || !time) {
    throw new Error('Missing timestamp fields');
  }
  const isoCandidate = `${date}T${time}Z`;
  const parsedDate = new Date(isoCandidate);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error('Invalid timestamp fields');
  }

  const documentRegex = config.documentRegex;
  const protocol = entry['cs-protocol'] || config.cloudFrontDefaultProtocol;
  const host = entry['x-host-header'] || config.cloudFrontDefaultHost;
  const path = entry['cs-uri-stem'] || '/';
  const query = entry['cs-uri-query'] || '';
  const url = query
    ? `${protocol}://${host}${path}?${query}`
    : `${protocol}://${host}${path}`;

  const cdt = `${date} ${time}`;
  const userAgent = entry['cs(User-Agent)'] || '';

  if (!protocol || !host) {
    throw new Error('Missing required protocol or host in log entry');
  }

  const payload: MatomoPayload = {
    idsite: config.matomoSiteId,
    rec: 1,
    recMode: config.matomoRecMode ?? 1,
    url,
    source: 'CloudFront',
    cdt,
    ua: userAgent
  };

  if (entry['sc-status']) {
    payload.http_status = toIntIfNumeric(entry['sc-status']);
  }
  if (entry['sc-bytes']) {
    payload.bw_bytes = toIntIfNumeric(entry['sc-bytes']);
  }
  if (entry['time-taken']) {
    payload.pf_srv = secondsToMsIntIfNumeric(entry['time-taken']);
  }
  if (documentRegex && documentRegex.test(url)) {
    payload.download = url;
  }

  return payload;
}
