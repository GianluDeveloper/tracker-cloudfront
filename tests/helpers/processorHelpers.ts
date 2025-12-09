import { sendLogLinesToMatomo } from '../../src/processor.js';
import type { MatomoConfig } from '../../src/types.js';

export async function sendLogContentToMatomo(
  logContent: string,
  config: MatomoConfig
): Promise<void> {
  const lines = logContent.split('\n');
  async function* iterator(): AsyncGenerator<string> {
    for (const line of lines) {
      yield line;
    }
  }
  return sendLogLinesToMatomo(iterator(), config);
}
