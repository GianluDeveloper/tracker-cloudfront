import { describe, expect, it } from 'vitest';
import { detectBot } from '../src/bot.js';

describe('detectBot', () => {
  it.each([
    'ChatGPT-User',
    'MistralAI-User',
    'Gemini-Deep-Research',
    'Claude-User',
    'Perplexity-User',
    'Google-NotebookLM',
    'Google-GeminiNotebook'
  ])('identifies the assistant product %s', (name) => {
    expect(detectBot(`${name.toLowerCase()}/1.0`)).toEqual({
      name
    });
  });

  it.each([
    'GPTBot',
    'OAI-SearchBot',
    'ClaudeBot',
    'Claude-SearchBot',
    'PerplexityBot',
    'Googlebot',
    'Googlebot-Image',
    'Googlebot-Video',
    'Googlebot-News',
    'AdsBot-Google-Mobile',
    'GoogleOther-Image',
    'Bingbot',
    'msnbot',
    'msnbot-media',
    'DuckDuckBot',
    'Applebot',
    'Applebot-Extended',
    'YandexBot',
    'Baiduspider',
    'Slurp',
    'AhrefsBot',
    'SemrushBot',
    'facebookexternalhit',
    'Twitterbot',
    'Slackbot-LinkExpanding'
  ])('identifies the crawler product %s', (name) => {
    expect(
      detectBot(`Mozilla/5.0 (compatible; ${name.toUpperCase()}/2.1)`)
    ).toEqual({ name });
  });

  it('prefers a specific variant over the family token in the same header', () => {
    expect(detectBot('Googlebot/2.1 Googlebot-Image/1.0')).toEqual({
      name: 'Googlebot-Image'
    });
  });

  it('prefers a user-triggered assistant over a crawler in the same header', () => {
    expect(detectBot('GPTBot/1.0 ChatGPT-User/1.0')).toEqual({
      name: 'ChatGPT-User'
    });
  });

  it.each(['Sogou web spider', 'Screaming Frog SEO Spider'])(
    'recognizes escaped spaces inside the product %s',
    (name) => {
      expect(detectBot(`${name.replace(/ /g, '%20')}/1.0`)).toEqual({ name });
    }
  );

  it.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0%20(compatible;%20Googlebot/2.1;%20+http://www.google.com/bot.html)',
    'Mozilla%2F5.0%20%28compatible%3B%20Googlebot%2F2.1%3B%20%2Bhttp%3A%2F%2Fwww.google.com%2Fbot.html%29',
    'Mozilla%2F5.0%20%28%2Bhttps%3A%2F%2Fexample.com%29%20Googlebot%2F2.1',
    'Mozilla%2F5.0%20%2Bhttps%3A%2F%2Fexample.com%20Googlebot%2F2.1',
    'Mozilla/5.0 (+https://example.com) Googlebot/2.1'
  ])('detects a product with escaped or plain delimiters: %s', (userAgent) => {
    expect(detectBot(userAgent)).toEqual({
      name: 'Googlebot'
    });
  });

  it.each([
    '',
    '-',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 Chrome/135.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Robot; botany)',
    'ChatGPT',
    'ChatGPT-UserFake/1.0',
    'FakeChatGPT-User/1.0',
    'Googlebot.example.com',
    'my_googlebot_version',
    'Googlebot%41',
    'Mozilla/5.0 (+https://example.com/Googlebot)',
    'Mozilla/5.0 (+http://example.com/ChatGPT-User)',
    'https://example.com/foo%20Googlebot',
    'Mozilla/5.0 (+https://example.com/foo%20Googlebot)',
    'https://example.com/CustomBot',
    'https://Googlebot.example.com',
    'Mozilla%2F5.0%20%28%2Bhttps%3A%2F%2Fexample.com%2FChatGPT-User%29'
  ])('does not infer automation from %j', (userAgent) => {
    expect(detectBot(userAgent)).toBeUndefined();
  });

  it.each([false, true])(
    'does not infer a bot from a CUBOT mobile browser (escaped: %s)',
    (escaped) => {
      const browser =
        'Mozilla/5.0 (Linux; Android 6.0; CUBOT X16S Build/MRA58K) AppleWebKit/537.36 Chrome/58.0.3029.125 Mobile Safari/537.36';
      expect(
        detectBot(escaped ? encodeURIComponent(browser) : browser)
      ).toBeUndefined();
    }
  );

  it.each([
    'CustomBot/1.0',
    'ExampleCrawler/2.0',
    'Spider/3.0',
    'Robot CustomBot/1.0',
    'CUBOT CustomBot/1.0',
    'Mozilla/5.0%20(compatible;%20CustomBot/1.0)',
    'Mozilla/5.0 (compatible; CustomBot/1.0; +https://example.com)'
  ])('labels an unrecognized bot product generically: %s', (userAgent) => {
    expect(detectBot(userAgent)).toEqual({
      name: 'Unknown bot'
    });
  });

  it('does not decode a percent-escaped product name', () => {
    expect(detectBot('Mozilla/5.0%20%47ooglebot/2.1')).toBeUndefined();
  });
});
