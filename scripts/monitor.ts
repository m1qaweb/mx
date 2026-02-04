import { chromium, Browser, Page, ElementHandle } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Path to news.json relative to project root
const NEWS_JSON_PATH = path.join(__dirname, '..', 'src', 'data', 'news.json');

interface MonitorArgs {
  source: 'web' | 'twitter' | 'mixed';
  name: string;
  urls: string[];
  selector?: string;
}

interface NewsItem {
  id: string;
  source: string;
  title: string;
  date: string;
  url: string;
}

interface ScrapedResult {
  url: string;
  source: string;
  name: string;
  content: string | null;
  timestamp: string;
  error?: string;
}

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 30000;

const DEFAULT_SELECTORS: Record<string, string> = {
  'openai.com': 'h3, a[href*="/news/"]',
  'anthropic.com': '[class*="title"], h3',
  'windsurf.com': 'h2',
  'kiro.dev': 'h2',
  'cursor.com': 'h2',
  'antigravity.google': 'h3',
  'developers.googleblog.com': '.post-title'
};

function parseArgs(): MonitorArgs {
  const args = process.argv.slice(2);
  const result: Partial<MonitorArgs> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--source':
        result.source = args[++i] as 'web' | 'twitter' | 'mixed';
        break;
      case '--name':
        result.name = args[++i];
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
  if (!result.source || !['web', 'twitter', 'mixed'].includes(result.source)) {
    console.error('Error: --source must be "web", "twitter", or "mixed"');
    process.exit(1);
  }

  if (!result.name) {
    console.error('Error: --name is required');
    process.exit(1);
  }

  if (!result.urls || result.urls.length === 0) {
    console.error('Error: --url is required (comma-separated)');
    process.exit(1);
  }

  if (result.source === 'web' && !result.selector) {
    // Allow missing selector if we might have defaults
    // We will validate per-URL in main()
  }

  return result as MonitorArgs;
}

function readNewsJson(): NewsItem[] {
  try {
    if (fs.existsSync(NEWS_JSON_PATH)) {
      const content = fs.readFileSync(NEWS_JSON_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Error reading news.json:', error);
  }
  return [];
}

function writeNewsJson(news: NewsItem[]): void {
  try {
    // Ensure directory exists
    const dir = path.dirname(NEWS_JSON_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(NEWS_JSON_PATH, JSON.stringify(news, null, 2));
  } catch (error) {
    console.error('Error writing news.json:', error);
    throw error;
  }
}

function isDuplicate(news: NewsItem[], title: string, url: string): boolean {
  return news.some(item => 
    item.title.toLowerCase() === title.toLowerCase() || 
    item.url === url
  );
}

function createNewsItem(source: string, title: string, url: string): NewsItem {
  // Clean title: remove newlines and excessive whitespace
  const cleanTitle = title.replace(/\s+/g, ' ').trim();
  return {
    id: uuidv4(),
    source,
    title: cleanTitle,
    date: new Date().toISOString(),
    url
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch (e) {
    return relative;
  }
}

async function scrapeTwitter(page: Page, url: string): Promise<{ title: string, url: string } | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS });
    
    // Wait for tweets to load with extended timeout for Twitter's slow loading
    await page.waitForSelector('[data-testid="tweet"]', { timeout: 15000 });
    
    // Try to find pinned tweet first (per AGENTS.md requirement)
    let tweetElement = await page.$('[data-testid="tweet"]:has([aria-label*="Pinned"])');
    if (!tweetElement) {
        // Fallback to latest tweet
        tweetElement = await page.$('[data-testid="tweet"]');
    }
    
    if (tweetElement) {
      const textEl = await tweetElement.$('[data-testid="tweetText"]');
      if (textEl) {
        const text = await textEl.innerText();

        // Find link to the specific tweet
        let tweetUrl = url;
        const timeEl = await tweetElement.$('time');
        if (timeEl) {
            // Usually the time element is inside an anchor or is one, linking to the tweet
            const anchor = await timeEl.evaluateHandle(el => el.closest('a'));
            const anchorEl = anchor.asElement();
            if (anchorEl) {
                const href = await anchorEl.getAttribute('href');
                if (href) {
                    tweetUrl = resolveUrl('https://x.com', href);
                }
            }
        }

        return { title: text, url: tweetUrl };
      }
    }
  } catch (error) {
    // Twitter often blocks scraping, this is expected
    console.log(`Note: Twitter scraping may be blocked for ${url}`);
  }
  
  return null;
}

async function scrapeWeb(page: Page, url: string, selector: string): Promise<{ title: string, url: string }[]> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS });
  
  // Wait for the selector to ensure elements are present
  // If this times out, it will throw and trigger the retry mechanism
  await page.waitForSelector(selector, { timeout: 10000 });

  // Get all matching elements to find multiple news items
  const elements = await page.$$(selector);
  const results: { title: string, url: string }[] = [];
  
  for (const element of elements) {
    const text = await element.innerText();
    if (!text || !text.trim()) continue;

    let href = await element.getAttribute('href');
    if (!href) {
        // Check ancestor
        const parentA = await element.evaluateHandle(el => el.closest('a'));
        const parentAEl = parentA.asElement();
        if (parentAEl) {
             href = await parentAEl.getAttribute('href');
        }
    }
    if (!href) {
        // Check descendant
        const childA = await element.$('a');
        if (childA) {
             href = await childA.getAttribute('href');
        }
    }

    const fullUrl = href ? resolveUrl(url, href) : url;
    results.push({ title: text.trim(), url: fullUrl });
  }
  
  return results;
}

async function scrapeWithRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES
): Promise<T | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`Attempt ${attempt}/${retries} failed: ${errorMessage}`);
      
      if (attempt < retries) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  return null;
}

async function main() {
  const args = parseArgs();
  const results: ScrapedResult[] = [];
  
  // Read existing news items
  const existingNews = readNewsJson();
  const newItems: NewsItem[] = [];
  let addedCount = 0;
  let skippedCount = 0;
  
  let browser: Browser | null = null;
  
  try {
    browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    for (const url of args.urls) {
      let currentSource = args.source;
      if (currentSource === 'mixed') {
        if (url.includes('twitter.com') || url.includes('x.com')) {
          currentSource = 'twitter';
        } else {
          currentSource = 'web';
        }
      }

      const result: ScrapedResult = {
        url,
        source: currentSource,
        name: args.name,
        content: null,
        timestamp: new Date().toISOString()
      };
      
      try {
        if (currentSource === 'twitter') {
          const item = await scrapeWithRetry(() => scrapeTwitter(page, url));
          
          if (item) {
            result.content = item.title;
            // For Twitter, use the tweet text as both title and content
            const title = item.title.slice(0, 100) + (item.title.length > 100 ? '...' : '');
            
            if (!isDuplicate([...existingNews, ...newItems], title, item.url)) {
              newItems.push(createNewsItem(args.name, title, item.url));
              addedCount++;
              console.log(`Added: "${title}" from ${args.name}`);
            } else {
              skippedCount++;
              console.log(`Skipped duplicate: "${title}"`);
            }
          }
        } else {
          let selector = args.selector;

          if (!selector) {
            for (const [domain, sel] of Object.entries(DEFAULT_SELECTORS)) {
              if (url.includes(domain)) {
                selector = sel;
                break;
              }
            }
          }

          if (!selector) {
            console.log(`Skipping ${url}: No selector provided and no default found`);
            results.push({
              url,
              source: currentSource,
              name: args.name,
              content: null,
              timestamp: new Date().toISOString(),
              error: 'Missing selector'
            });
            continue;
          }

          const contents = await scrapeWithRetry(() => scrapeWeb(page, url, selector));
          
          if (contents && contents.length > 0) {
            result.content = contents.map(c => c.title).join(' | ');
            
            // Add each scraped item
            for (const item of contents) {
              if (!isDuplicate([...existingNews, ...newItems], item.title, item.url)) {
                newItems.push(createNewsItem(args.name, item.title, item.url));
                addedCount++;
                console.log(`Added: "${item.title}" from ${args.name}`);
              } else {
                skippedCount++;
                console.log(`Skipped duplicate: "${item.title}"`);
              }
            }
          }
        }
      } catch (error) {
        result.error = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error scraping ${url}:`, result.error);
      }
      
      results.push(result);
      
      // Add delay between requests to avoid rate limiting
      await sleep(1000);
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  // Write updated news to file
  if (newItems.length > 0) {
    const updatedNews = [...existingNews, ...newItems];
    writeNewsJson(updatedNews);
    console.log(`\nSummary: Added ${addedCount} new items, skipped ${skippedCount} duplicates`);
    console.log(`Total items in news.json: ${updatedNews.length}`);
  } else {
    console.log(`\nSummary: No new items added, skipped ${skippedCount} duplicates`);
    console.log(`Total items in news.json: ${existingNews.length}`);
  }
  
  // Output results for debugging
  console.log('\nScraping Results:');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
