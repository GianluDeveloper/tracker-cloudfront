import type { CloudFrontLogEntry } from './types.js';

export function getCloudFrontUserAgent(
  entry: CloudFrontLogEntry | undefined,
  decode = false
): string {
  const userAgent = entry?.['cs(User-Agent)'] || '';
  if (!decode) return userAgent;
  try {
    // CloudFront escapes log fields; Matomo applies its own transport encoding.
    // Decode only one layer and preserve literal '+' in User-Agent headers.
    return decodeURIComponent(userAgent);
  } catch {
    // A malformed escape must not prevent a request from being tracked.
    return userAgent;
  }
}
