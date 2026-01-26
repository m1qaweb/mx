import { chromium, Browser, Page } from 'playwright';

interface MonitorArgs {
  source: 'web' | 'twitter';
  urls: string[];
  selector?: string;
}

interface ScrapedResult {
  url: string;
  source: string;
  content: string | null;
  timestamp: string;
  error?: string;
}

function parseArgs(): MonitorArgs {
  const args = process.argv.slice(2);
  const result: Partial<MonitorArgs> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--source':
        result.source = args[++i] as 'web' | 'twitter';
        break;
      case '--url':
        result.urls = args[++i].split(',').map(u => u.trim());
        break;
      case '--selector':
        result.selector = args[++i];
        break;
    }
  }

  // Validation
  if (!result.source || !['web', 'twitter'].includes(result.source)) {
    console.error('Error: --source must be "web" or "twitter"');
    process.exit(1);
  }

  if (!result.urls || result.urls.length === 0) {
    console.error('Error: --url is required (comma-separated)');
    process.exit(1);
  }

  if (result.source === 'web' && !result.selector) {
    console.error('Error: --selector is required for web source');
    process.exit(1);
  }

  return result as MonitorArgs;
}

async function scrapeTwitter(page: Page, url: string): Promise<string | null> {
  await page.goto(url, { waitUntil: 'networkidle' });
  
  // Wait for tweets to load
  await page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 });
  
  // Try to find pinned tweet first
  const pinnedTweet = await page.$('[data-testid="tweet"]:has([aria-label*="Pinned"])');
  
  if (pinnedTweet) {
    const tweetText = await pinnedTweet.$('[data-testid="tweetText"]');
    if (tweetText) {
      return await tweetText.innerText();
    }
  }
  
  // Fallback to latest tweet
  const latestTweet = await page.$('[data-testid="tweet"] [data-testid="tweetText"]');
  if (latestTweet) {
    return await latestTweet.innerText();
  }
  
  return null;
}

async function scrapeWeb(page: Page, url: string, selector: string): Promise<string | null> {
  await page.goto(url, { waitUntil: 'networkidle' });
  
  const element = await page.$(selector);
  if (element) {
    return await element.innerText();
  }
  
  return null;
}

async function main() {
  const args = parseArgs();
  const results: ScrapedResult[] = [];
  
  let browser: Browser | null = null;
  
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    for (const url of args.urls) {
      const result: ScrapedResult = {
        url,
        source: args.source,
        content: null,
        timestamp: new Date().toISOString()
      };
      
      try {
        if (args.source === 'twitter') {
          result.content = await scrapeTwitter(page, url);
        } else {
          result.content = await scrapeWeb(page, url, args.selector!);
        }
      } catch (error) {
        result.error = error instanceof Error ? error.message : 'Unknown error';
      }
      
      results.push(result);
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
