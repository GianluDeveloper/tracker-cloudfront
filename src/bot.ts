export interface DetectedBot {
  name: string;
}

// Product tokens must be separated from words, hostnames, and other product
// names. CloudFront may leave delimiters escaped when decoding is disabled.
const escapedDelimiter = '%(?:20|09|0a|0d|28|29|3b|2b|2f|3a|2c)';
const delimiter = `(?:[^a-z0-9_%.-]|${escapedDelimiter})`;

function productPattern(token: string, flags = 'i'): RegExp {
  return new RegExp(`(?:^|${delimiter})${token}(?=$|${delimiter})`, flags);
}

// Keep variants before their broader family names and user-triggered
// assistants before crawlers that may also appear in the same User-Agent.
const knownBots: (DetectedBot & { pattern: RegExp })[] = [
  'ChatGPT-User',
  'MistralAI-User',
  'Gemini-Deep-Research',
  'Claude-User',
  'Perplexity-User',
  'Google-NotebookLM',
  'Google-GeminiNotebook',
  'OAI-SearchBot',
  'GPTBot',
  'Claude-SearchBot',
  'ClaudeBot',
  'PerplexityBot',
  'Googlebot-Image',
  'Googlebot-Video',
  'Googlebot-News',
  'Googlebot',
  'AdsBot-Google-Mobile',
  'AdsBot-Google',
  'Mediapartners-Google',
  'GoogleOther-Image',
  'GoogleOther-Video',
  'GoogleOther',
  'Google-InspectionTool',
  'FeedFetcher-Google',
  'Storebot-Google',
  'Bingbot',
  'BingPreview',
  'msnbot-media',
  'msnbot',
  'DuckDuckBot',
  'Applebot-Extended',
  'Applebot',
  'YandexImages',
  'YandexVideo',
  'YandexMobileBot',
  'YandexBot',
  'Baiduspider-image',
  'Baiduspider',
  'Slurp',
  'PetalBot',
  'Sogou web spider',
  'Sogou',
  'Exabot',
  'SeznamBot',
  'AhrefsBot',
  'SemrushBot',
  'MJ12bot',
  'DotBot',
  'BLEXBot',
  'Screaming Frog SEO Spider',
  'facebookexternalhit',
  'facebookcatalog',
  'Facebot',
  'Twitterbot',
  'LinkedInBot',
  'Pinterestbot',
  'Slackbot-LinkExpanding',
  'Slackbot',
  'Discordbot',
  'TelegramBot',
  'WhatsApp',
  'CCBot',
  'Bytespider',
  'Amazonbot'
].map((name) => ({
  name,
  pattern: productPattern(name.replace(/ /g, '(?: |%20)'))
}));

const unknownBotPattern = productPattern(
  '([a-z0-9_-]*(?:bot|crawler|spider))',
  'gi'
);
const nonBotProducts = new Set(['robot', 'cubot']);

// Encoded schemes come from escaped UA fields, whose escaped whitespace and
// parentheses also delimit the URL. Keep escapes inside literal URL paths
// intact so a path such as /foo%20Googlebot does not create a product token.
const contactUrlPattern =
  /https?:\/\/[^\s<>()]*|https?%3a(?:%2f){2}(?:(?!%(?:20|09|0a|0d|28|29))[^\s<>()])*/gi;

/** Identifies declared bot products, not the authenticity of their sender. */
export function detectBot(userAgent: string): DetectedBot | undefined {
  // Contact URLs often contain bot names even in ordinary browser strings.
  // Strip them without decoding or changing the logged User-Agent itself.
  const products = userAgent.replace(contactUrlPattern, ' ');

  const knownBot = knownBots.find(({ pattern }) => pattern.test(products));
  if (knownBot) {
    return { name: knownBot.name };
  }

  for (const match of products.matchAll(unknownBotPattern)) {
    if (!nonBotProducts.has(match[1].toLowerCase())) {
      return { name: 'Unknown bot' };
    }
  }
  return undefined;
}
