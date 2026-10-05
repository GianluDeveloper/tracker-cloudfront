import { describe, expect, it } from 'vitest';
import { getCloudFrontClientIp } from '../src/clientIp.js';

const clientIp = '43.166.244.192';
const cloudflareIp = '172.68.245.145';

describe('getCloudFrontClientIp', () => {
  it.each([
    ['173.245.48.0', '173.245.63.255'],
    ['103.21.244.0', '103.21.247.255'],
    ['103.22.200.0', '103.22.203.255'],
    ['103.31.4.0', '103.31.7.255'],
    ['141.101.64.0', '141.101.127.255'],
    ['108.162.192.0', '108.162.255.255'],
    ['190.93.240.0', '190.93.255.255'],
    ['188.114.96.0', '188.114.111.255'],
    ['197.234.240.0', '197.234.243.255'],
    ['198.41.128.0', '198.41.255.255'],
    ['162.158.0.0', '162.159.255.255'],
    ['104.16.0.0', '104.23.255.255'],
    ['104.24.0.0', '104.27.255.255'],
    ['172.64.0.0', '172.71.255.255'],
    ['131.0.72.0', '131.0.75.255']
  ])('trusts Cloudflare IPv4 range from %s through %s', (first, last) => {
    for (const address of [first, last]) {
      expect(
        getCloudFrontClientIp({
          'c-ip': address,
          'x-forwarded-for': clientIp
        })
      ).toBe(clientIp);
    }
  });

  it.each([
    '104.15.255.255',
    '104.28.0.0',
    '172.63.255.255',
    '172.72.0.0',
    '131.0.71.255',
    '131.0.76.0',
    '198.41.127.255',
    '198.42.0.0'
  ])('does not trust addresses outside Cloudflare IPv4 ranges (%s)', (ip) => {
    expect(
      getCloudFrontClientIp({ 'c-ip': ip, 'x-forwarded-for': clientIp })
    ).toBe(ip);
  });

  it.each([
    '2400:cb00::1',
    '2606:4700::1',
    '2803:f800::1',
    '2405:b500::1',
    '2405:8100::1',
    '2a06:98c0::1',
    '2a06:98c7:ffff:ffff:ffff:ffff:ffff:ffff',
    '2c0f:f248::1',
    '::ffff:172.68.245.145'
  ])('trusts Cloudflare IPv6 and mapped IPv4 addresses (%s)', (ip) => {
    expect(
      getCloudFrontClientIp({ 'c-ip': ip, 'x-forwarded-for': clientIp })
    ).toBe(clientIp);
  });

  it.each(['2a06:98bf::1', '2a06:98c8::1', '2606:4701::1', '2001:db8::1'])(
    'does not trust IPv6 addresses outside Cloudflare ranges (%s)',
    (ip) => {
      expect(
        getCloudFrontClientIp({ 'c-ip': ip, 'x-forwarded-for': clientIp })
      ).toBe(ip);
    }
  );

  it('ignores a spoofed forwarded header from a direct visitor', () => {
    expect(
      getCloudFrontClientIp({
        'c-ip': '198.51.100.17',
        'x-forwarded-for': '1.2.3.4, 43.166.244.192'
      })
    ).toBe('198.51.100.17');
  });

  it.each(['cf-connecting-ip', 'CF-Connecting-IP'])(
    'prefers a validated %s over the forwarded chain for Cloudflare peers',
    (field) => {
      expect(
        getCloudFrontClientIp({
          'c-ip': cloudflareIp,
          'x-forwarded-for': '1.2.3.4, 43.166.244.192',
          [field]: ' 2001:db8::1234 '
        })
      ).toBe('2001:db8::1234');
    }
  );

  it('decodes an escaped IPv6 CF-Connecting-IP once', () => {
    expect(
      getCloudFrontClientIp({
        'c-ip': cloudflareIp,
        'cf-connecting-ip': '2001%3Adb8%3A%3A1234',
        'x-forwarded-for': clientIp
      })
    ).toBe('2001:db8::1234');
  });

  it.each([
    '',
    '-',
    'invalid',
    '1.2.3.4, 5.6.7.8',
    'fe80::1%eth0',
    'fe80::1%25eth0',
    '%',
    '2001%253Adb8%253A%253A1234'
  ])(
    'falls back to XFF when CF-Connecting-IP is unusable (%j)',
    (connectingIp) => {
      expect(
        getCloudFrontClientIp({
          'c-ip': cloudflareIp,
          'cf-connecting-ip': connectingIp,
          'x-forwarded-for': clientIp
        })
      ).toBe(clientIp);
    }
  );

  it('ignores a spoofed CF-Connecting-IP header from a direct visitor', () => {
    expect(
      getCloudFrontClientIp({
        'c-ip': '198.51.100.17',
        'cf-connecting-ip': '1.2.3.4',
        'x-forwarded-for': '5.6.7.8'
      })
    ).toBe('198.51.100.17');
  });

  it.each([
    clientIp,
    `1.2.3.4, ${clientIp}`,
    `not-an-ip, ${clientIp}`,
    `bad%, ${clientIp}`,
    `bad%%2C%20${clientIp}`,
    `1.2.3.4%2C%20${clientIp}%20`,
    ` 1.2.3.4, ${clientIp} `
  ])('uses only the last forwarded address from Cloudflare (%j)', (xff) => {
    expect(
      getCloudFrontClientIp({
        'c-ip': cloudflareIp,
        'x-forwarded-for': xff
      })
    ).toBe(clientIp);
  });

  it('preserves a valid IPv6 visitor address', () => {
    expect(
      getCloudFrontClientIp({
        'c-ip': cloudflareIp,
        'x-forwarded-for': '1.2.3.4, 2001:db8::1234'
      })
    ).toBe('2001:db8::1234');
  });

  it.each([
    undefined,
    '',
    '-',
    ' ',
    'not-an-ip',
    '1.2.3.4, invalid',
    '1.2.3.4,',
    '1.2.3.4, -',
    '1.2.3.4, 198.51.100.1:1234',
    '1.2.3.4, [2001:db8::1]',
    '1.2.3.4, fe80::1%25eth0',
    '1.2.3.4%2C%20%',
    '1.2.3.4%252C%252043.166.244.192'
  ])(
    'falls back to the proxy when the last forwarded address is unusable (%j)',
    (xff) => {
      const entry: Record<string, string> = { 'c-ip': cloudflareIp };
      if (xff !== undefined) entry['x-forwarded-for'] = xff;
      expect(getCloudFrontClientIp(entry)).toBe(cloudflareIp);
    }
  );

  it.each([undefined, '', '-', 'not-an-ip', '999.1.2.3', 'fe80::1%eth0'])(
    'omits the IP when c-ip is missing or invalid (%j)',
    (ip) => {
      const entry: Record<string, string> = { 'x-forwarded-for': clientIp };
      if (ip !== undefined) entry['c-ip'] = ip;
      expect(getCloudFrontClientIp(entry)).toBeUndefined();
    }
  );
});
