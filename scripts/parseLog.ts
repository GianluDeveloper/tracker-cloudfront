import fs from 'fs';
import { createGunzip } from 'zlib';
import { parseCloudFrontLines } from '../src/parser.js';
import { buildMatomoPayload } from '../src/matomo.js';
import { buildMatomoRequestPayload } from '../src/http.js';
import {
  isHttpMethodAllowed,
  isUserAgentAllowed,
  linesFromStream
} from '../src/utils.js';
import type { MatomoConfig } from '../src/types.js';

const fileLines = async function* (filePath: string) {
  const stream = fs.createReadStream(filePath);
  const isGzip = filePath.endsWith('.gz');
  const source = isGzip ? stream.pipe(createGunzip()) : stream;
  for await (const line of linesFromStream(source)) {
    yield line;
  }
};

export async function buildRequestsFromFile(
  filePath: string,
  config: MatomoConfig
): Promise<string[]> {
  const requests: string[] = [];
  for await (const entry of parseCloudFrontLines(fileLines(filePath))) {
    if (
      !isUserAgentAllowed(
        entry,
        config.userAgentAllowlistRegex,
        config.cloudFrontDecodeUserAgent,
        config.matomoBotTrackingMode === 'visits' && config.matomoRecMode !== 2
      )
    ) {
      continue;
    }
    if (!isHttpMethodAllowed(entry, config.httpMethodAllowlist)) {
      continue;
    }
    const payload = buildMatomoPayload(entry, config);
    requests.push(buildMatomoRequestPayload(payload));
  }
  return requests;
}
