import { chromium, Browser, Page } from 'playwright';
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

// Helper to create a slug from text for hash generation
function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')     // Replace spaces with -
    .replace(/[^\w\-]+/g, '') // Remove all non-word chars
    .replace(/\-\-+/g, '-')   // Replace multiple - with single -
    .slice(0, 50);            // Limit length
}

interface ScrapeResult {
  text: string;
  link: string | null;
}

async function scrapeTwitter(page: Page, url: string): Promise<ScrapeResult | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS });
    
    // Wait for tweets to load with extended timeout for Twitter's slow loading
    await page.waitForSelector('[data-testid="tweet"]', { timeout: 15000 });
    
    let tweetElement = null;

    // Try to find pinned tweet first (per AGENTS.md requirement)
    const pinnedTweet = await page.$('[data-testid="tweet"]:has([aria-label*="Pinned"])');
    
    if (pinnedTweet) {
      tweetElement = pinnedTweet;
    } else {
      // Fallback to latest tweet container
      tweetElement = await page.$('[data-testid="tweet"]');
    }

    if (tweetElement) {
      const tweetTextElement = await tweetElement.$('[data-testid="tweetText"]');
      const text = tweetTextElement ? await tweetTextElement.innerText() : null;

      if (text) {
        // Try to find the link (time element usually contains it)
        let link: string | null = null;

        // Strategy 1: Look for any link containing /status/ inside the tweet
        const statusLink = await tweetElement.$('a[href*="/status/"]');
        if (statusLink) {
          const href = await statusLink.getAttribute('href');
          if (href) {
            try {
              link = new URL(href, 'https://x.com').toString();
            } catch (e) {
              // Ignore invalid URLs
            }
          }
        }

        // Fallback to input URL if no specific status link found
        if (!link) {
          link = url;
        }

        return { text, link };
      }
    }
  } catch (error) {
    // Twitter often blocks scraping, this is expected
    console.log(`Note: Twitter scraping may be blocked for ${url}`);
  }
  
  return null;
}

async function scrapeWeb(page: Page, url: string, selector: string): Promise<ScrapeResult[]> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS });
  
  // Wait for the selector to ensure elements are present
  // If this times out, it will throw and trigger the retry mechanism
  await page.waitForSelector(selector, { timeout: 10000 });

  // Get all matching elements to find multiple news items
  const elements = await page.$$(selector);
  const results: ScrapeResult[] = [];
  
  for (const element of elements) {
    const text = await element.innerText();
    if (text && text.trim()) {
      let link: string | null = null;

      // 1. Try to find href in the element itself (if it's an 'a')
      const hrefHandle = await element.getAttribute('href');
      if (hrefHandle) {
          link = hrefHandle;
      } else {
          // 2. Try to find 'a' tag inside
          const anchor = await element.$('a[href]');
          if (anchor) {
              link = await anchor.getAttribute('href');
          }
      }

      // Resolve relative URLs
      if (link) {
          try {
              link = new URL(link, url).toString();
          } catch (e) {
              link = null;
          }
      }

      // 3. Try to find id for anchor
      if (!link) {
          const id = await element.getAttribute('id');
          if (id) {
              link = `${url}#${id}`;
          }
      }

      // 4. Fallback to title slug hash to ensure unique URL
      if (!link) {
           link = `${url}#${slugify(text.trim())}`;
      }

      results.push({ text: text.trim(), link });
    }
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
          const scrapeResult = await scrapeWithRetry(() => scrapeTwitter(page, url));
          result.content = scrapeResult ? scrapeResult.text : null;
          
          if (scrapeResult) {
            // For Twitter, use the tweet text as both title and content
            const title = scrapeResult.text.slice(0, 100) + (scrapeResult.text.length > 100 ? '...' : '');
            // Use extracted link or fallback to profile URL
            const itemUrl = scrapeResult.link || url;
            
            if (!isDuplicate([...existingNews, ...newItems], title, itemUrl)) {
              newItems.push(createNewsItem(args.name, title, itemUrl));
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

          const scrapedItems = await scrapeWithRetry(() => scrapeWeb(page, url, selector));
          
          if (scrapedItems && scrapedItems.length > 0) {
            result.content = scrapedItems.map(i => i.text).join(' | ');
            
            // Add each scraped title as a potential news item
            for (const item of scrapedItems) {
              const itemUrl = item.link || url;
              if (!isDuplicate([...existingNews, ...newItems], item.text, itemUrl)) {
                newItems.push(createNewsItem(args.name, item.text, itemUrl));
                addedCount++;
                console.log(`Added: "${item.text}" from ${args.name}`);
              } else {
                skippedCount++;
                console.log(`Skipped duplicate: "${item.text}"`);
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
