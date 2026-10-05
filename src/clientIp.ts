import { BlockList, isIP } from 'node:net';
import type { CloudFrontLogEntry } from './types.js';
import cloudflareRanges from './cloudflareRanges.json';

const trustedProxies = new BlockList();
for (const range of cloudflareRanges) {
  const [address, prefix] = range.split('/');
  trustedProxies.addSubnet(
    address,
    Number(prefix),
    isIP(address) === 6 ? 'ipv6' : 'ipv4'
  );
}

const validIp = (value: string | undefined): string | undefined => {
  const ip = value?.trim();
  return ip && !ip.includes('%') && isIP(ip) ? ip : undefined;
};

const decodedIp = (value: string | undefined): string | undefined => {
  try {
    return validIp(decodeURIComponent(value || ''));
  } catch {
    return undefined;
  }
};

export function getCloudFrontClientIp(
  entry: CloudFrontLogEntry
): string | undefined {
  const peer = validIp(entry['c-ip']);
  if (!peer) return undefined;
  const family = isIP(peer) === 6 ? 'ipv6' : 'ipv4';
  if (!trustedProxies.check(peer, family)) return peer;

  // Custom/enriched logs can include this single-IP Cloudflare header.
  const connectingIp = decodedIp(
    entry['cf-connecting-ip'] || entry['CF-Connecting-IP']
  );
  if (connectingIp) return connectingIp;

  // Cloudflare appends its incoming peer; earlier values can be client-supplied.
  // Split before decoding so malformed earlier values cannot hide the final IP.
  // An invalid final value must not cause a fallback to an earlier value.
  const lastForwarded = (entry['x-forwarded-for'] || '').split(/,|%2c/i).at(-1);
  return decodedIp(lastForwarded) || peer;
}
