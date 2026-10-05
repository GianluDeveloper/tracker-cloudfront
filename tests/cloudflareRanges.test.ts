import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadCloudflareRanges,
  updateCloudflareRanges
} from '../scripts/updateCloudflareRanges.js';

const ipv4Url = 'https://www.cloudflare.com/ips-v4';
const ipv6Url = 'https://www.cloudflare.com/ips-v6';
const validIpv4 = '173.245.48.0/20\n104.16.0.0/13\n';
const validIpv6 = '2606:4700::/32\n2400:cb00::/32\n';
const sortedRanges = [
  '104.16.0.0/13',
  '173.245.48.0/20',
  '2400:cb00::/32',
  '2606:4700::/32'
];
const tempDirs: string[] = [];

const mockFetcher = (ipv4 = validIpv4, ipv6 = validIpv6) =>
  vi.fn<typeof fetch>(
    async (input) => new Response(String(input) === ipv4Url ? ipv4 : ipv6)
  );

async function createSnapshot() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-ranges-'));
  tempDirs.push(directory);
  const snapshotPath = path.join(directory, 'cloudflareRanges.json');
  const existingSnapshot = '["198.51.100.0/24"]\n';
  await fs.writeFile(snapshotPath, existingSnapshot);
  return { snapshotPath, existingSnapshot };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe('downloadCloudflareRanges', () => {
  it('downloads the official lists, accepts CRLF, and sorts and deduplicates CIDRs', async () => {
    const fetcher = mockFetcher(
      ' 173.245.48.0/20\r\n104.16.0.0/13\r\n173.245.48.0/20\r\n\r\n',
      '2606:4700::/32\r\n2400:cb00::/32\r\n2606:4700::/32\r\n'
    );
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    expect(await downloadCloudflareRanges(fetcher)).toEqual(sortedRanges);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const url of [ipv4Url, ipv6Url]) {
      expect(fetcher).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    }
    expect(timeout).toHaveBeenCalledWith(15000);
  });

  it('starts both list requests before the first response arrives', async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const fetcher = vi.fn<typeof fetch>(
      () => new Promise<Response>((resolve) => resolvers.push(resolve))
    );
    const downloading = downloadCloudflareRanges(fetcher);
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(2);
    resolvers.forEach((resolve, index) =>
      resolve(new Response(index === 0 ? validIpv4 : validIpv6))
    );
    expect(await downloading).toEqual(sortedRanges);
  });

  it('accepts the minimum and maximum prefix lengths for both families', async () => {
    const fetcher = mockFetcher(
      '0.0.0.0/0\n198.51.100.1/32\n',
      '::/0\n2001:db8::1/128\n'
    );
    expect(await downloadCloudflareRanges(fetcher)).toEqual(
      ['0.0.0.0/0', '198.51.100.1/32', '::/0', '2001:db8::1/128'].sort()
    );
  });

  it.each([
    { endpoint: ipv4Url, body: '', reason: 'empty IPv4 list' },
    { endpoint: ipv6Url, body: ' \r\n', reason: 'empty IPv6 list' },
    { endpoint: ipv4Url, body: 'invalid/24', reason: 'invalid IP' },
    { endpoint: ipv4Url, body: '999.1.2.3/24', reason: 'invalid IPv4' },
    { endpoint: ipv4Url, body: '104.16.0.0', reason: 'missing prefix' },
    { endpoint: ipv4Url, body: '104.16.0.0/13/1', reason: 'extra slash' },
    { endpoint: ipv4Url, body: '104.16.0.0/-1', reason: 'negative prefix' },
    {
      endpoint: ipv4Url,
      body: '104.16.0.0/33',
      reason: 'oversized IPv4 prefix'
    },
    { endpoint: ipv4Url, body: '104.16.0.0/1.5', reason: 'fractional prefix' },
    { endpoint: ipv4Url, body: '104.16.0.0/1e1', reason: 'exponential prefix' },
    { endpoint: ipv4Url, body: '104.16.0.0/', reason: 'empty prefix' },
    { endpoint: ipv4Url, body: '2606:4700::/32', reason: 'IPv6 in IPv4 list' },
    { endpoint: ipv6Url, body: '104.16.0.0/13', reason: 'IPv4 in IPv6 list' },
    {
      endpoint: ipv6Url,
      body: '2606:4700::/129',
      reason: 'oversized IPv6 prefix'
    },
    { endpoint: ipv6Url, body: 'fe80::1%eth0/64', reason: 'scoped IPv6' },
    { endpoint: ipv6Url, body: '[2606:4700::]/32', reason: 'bracketed IPv6' }
  ])('rejects $reason', async ({ endpoint, body }) => {
    const fetcher = vi.fn<typeof fetch>(
      async (input) =>
        new Response(
          String(input) === endpoint
            ? body
            : String(input) === ipv4Url
              ? validIpv4
              : validIpv6
        )
    );
    await expect(downloadCloudflareRanges(fetcher)).rejects.toThrow();
  });

  it('rejects unsuccessful HTTP responses', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input) === ipv4Url
        ? new Response('Unavailable', { status: 503 })
        : new Response(validIpv6)
    );
    await expect(downloadCloudflareRanges(fetcher)).rejects.toThrow();
  });

  it('propagates download timeout failures', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new DOMException('The download timed out.', 'TimeoutError')
      );
    await expect(downloadCloudflareRanges(fetcher)).rejects.toThrow(
      /timed out/
    );
  });
});

describe('updateCloudflareRanges', () => {
  it('writes the sorted JSON snapshot with two-space indentation and a final newline', async () => {
    const { snapshotPath } = await createSnapshot();
    await updateCloudflareRanges(snapshotPath, mockFetcher());
    expect(await fs.readFile(snapshotPath, 'utf8')).toBe(
      `${JSON.stringify(sortedRanges, null, 2)}\n`
    );
  });

  it.each([ipv4Url, ipv6Url])(
    'preserves the previous snapshot when %s cannot be downloaded',
    async (failedEndpoint) => {
      const { snapshotPath, existingSnapshot } = await createSnapshot();
      const fetcher = vi.fn<typeof fetch>(async (input) => {
        if (String(input) === failedEndpoint) {
          throw new Error('Network unavailable');
        }
        return new Response(String(input) === ipv4Url ? validIpv4 : validIpv6);
      });

      await expect(
        updateCloudflareRanges(snapshotPath, fetcher)
      ).rejects.toThrow(/Network unavailable/);
      expect(await fs.readFile(snapshotPath, 'utf8')).toBe(existingSnapshot);
    }
  );

  it.each([ipv4Url, ipv6Url])(
    'preserves the previous snapshot when %s contains invalid ranges',
    async (invalidEndpoint) => {
      const { snapshotPath, existingSnapshot } = await createSnapshot();
      const fetcher = vi.fn<typeof fetch>(
        async (input) =>
          new Response(
            String(input) === invalidEndpoint
              ? 'not-a-valid-cidr'
              : String(input) === ipv4Url
                ? validIpv4
                : validIpv6
          )
      );

      await expect(
        updateCloudflareRanges(snapshotPath, fetcher)
      ).rejects.toThrow();
      expect(await fs.readFile(snapshotPath, 'utf8')).toBe(existingSnapshot);
    }
  );
});
