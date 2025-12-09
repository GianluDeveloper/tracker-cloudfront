#!/usr/bin/env node
import { buildRequestsFromFile } from './parseLog.js';
import { getConfig } from '../src/config.js';

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npm run parse:log -- <path/to/log or log.gz>');
    process.exit(1);
  }

  const config = getConfig();
  const requests = await buildRequestsFromFile(filePath, config);
  console.log(JSON.stringify({ requests }, null, 2));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
