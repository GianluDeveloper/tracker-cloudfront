import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sources = [
  { url: 'https://www.cloudflare.com/ips-v4', family: 4 },
  { url: 'https://www.cloudflare.com/ips-v6', family: 6 }
] as const;

export async function downloadCloudflareRanges(
  fetcher: typeof fetch = fetch
): Promise<string[]> {
  const lists = await Promise.all(
    sources.map(async ({ url, family }) => {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
        redirect: 'error'
      });
      if (!response.ok) {
        throw new Error(
          `Cloudflare IP download failed: ${url} HTTP ${response.status}`
        );
      }
      const content = (await response.text()).trim();
      if (!content) throw new Error(`Empty Cloudflare IP list: ${url}`);
      const ranges = content.split(/\r?\n/).map((line) => line.trim());
      for (const range of ranges) {
        const parts = range.split('/');
        const [address, prefix] = parts;
        if (
          parts.length !== 2 ||
          address.includes('%') ||
          isIP(address) !== family ||
          !/^(?:0|[1-9]\d*)$/.test(prefix) ||
          Number(prefix) > (family === 4 ? 32 : 128)
        ) {
          throw new Error(
            `Invalid IPv${family} CIDR in Cloudflare IP list: ${url}`
          );
        }
      }
      return ranges;
    })
  );
  return [...new Set(lists.flat())].sort();
}

export async function updateCloudflareRanges(
  outputPath: string | URL = new URL(
    '../src/cloudflareRanges.json',
    import.meta.url
  ),
  fetcher: typeof fetch = fetch
): Promise<void> {
  const ranges = await downloadCloudflareRanges(fetcher);
  const content = `${JSON.stringify(ranges, null, 2)}\n`;
  const destination =
    typeof outputPath === 'string' ? outputPath : fileURLToPath(outputPath);
  try {
    if ((await readFile(destination, 'utf8')) === content) return;
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
  }
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { flag: 'wx' });
    await rename(temporaryPath, destination);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  updateCloudflareRanges()
    .then(() =>
      console.info('Cloudflare IP ranges refreshed from official sources')
    )
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
