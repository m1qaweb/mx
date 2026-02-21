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

interface ScrapedItem {
  title: string;
  link: string;
  date?: string;
}

interface ScrapedResult {
  url: string;
  source: string;
  name: string;
  content: string | null; // Kept for logging/summary (titles joined)
  items: ScrapedItem[];    // New field for structured items
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
  'kiro.dev': 'h2, h3',
  'cursor.com': "h1, h2, h3, a[href^='/changelog']",
  'antigravity.google': 'h3',
  'developers.googleblog.com': '.post-title, h2, h3'
};

const INVALID_TITLES = [
  "Sorry, the page you're looking for doesn't exist.",
  "404 Not Found",
  "Page Not Found",
  "Select your cookie preferences",
  "Customize cookie preferences",
  "Your privacy choices",
  "Unable to save cookie preferences",
  "Advertising",
  "Functional",
  "Performance",
  "Essential",
  "Product",
  "Resources",
  "Company",
  "Legal",
  "Connect",
  "Next →Older posts",
  "Changelog",
  "Solutions",
  "Claude Developer Platform",
  "Learn",
  "Help and security",
  "Terms and policies"
];

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

function createNewsItem(source: string, title: string, url: string, date?: string): NewsItem {
  // Clean title: remove newlines and excessive whitespace
  const cleanTitle = title.replace(/\s+/g, ' ').trim();
  return {
    id: uuidv4(),
    source,
    title: cleanTitle,
    date: date || new Date().toISOString(),
    url
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to extract link from an element (ancestor, self, or descendant)
async function extractLink(element: ElementHandle, baseUrl: string): Promise<string | null> {
  try {
    // Check if element itself is <a>
    const tagName = await element.evaluate((el: any) => el.tagName.toLowerCase());
    if (tagName === 'a') {
      const href = await element.getAttribute('href');
      if (href) return new URL(href, baseUrl).toString();
    }

    // Check ancestors
    const ancestorHandle = await element.evaluateHandle((el: any) => el.closest('a'));
    const ancestorElement = ancestorHandle.asElement();
    if (ancestorElement) {
      const href = await ancestorElement.getAttribute('href');
      if (href) return new URL(href, baseUrl).toString();
    }

    // Check descendants (pick first)
    const descendantLink = await element.$('a');
    if (descendantLink) {
      const href = await descendantLink.getAttribute('href');
      if (href) return new URL(href, baseUrl).toString();
    }
  } catch (e) {
    // Ignore errors in link extraction
  }
  return null;
}

async function scrapeTwitter(page: Page, url: string): Promise<ScrapedItem | null> {
  // Let errors propagate to scrapeWithRetry for automatic retries
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS });

  // Wait for tweets
  await page.waitForSelector('[data-testid="tweet"]', { timeout: 20000 });

  let tweetElement = await page.$('[data-testid="tweet"]:has([aria-label*="Pinned"])');

  if (!tweetElement) {
     // Fallback to latest
     tweetElement = await page.$('[data-testid="tweet"]');
  }

  if (tweetElement) {
    const textEl = await tweetElement.$('[data-testid="tweetText"]');
    const text = textEl ? await textEl.innerText() : '';

    // Extract permalink from <time> parent
    let link = url;
    const timeEl = await tweetElement.$('time');
    if (timeEl) {
      const linkHref = await extractLink(timeEl, url);
      if (linkHref) link = linkHref;
    }

    if (text) {
      return {
        title: text,
        link: link
      };
    }
  }
  
  return null;
}

async function scrapeWeb(page: Page, url: string, selector: string): Promise<ScrapedItem[]> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS });
  
  await page.waitForSelector(selector, { timeout: 10000 });

  const elements = await page.$$(selector);
  const items: ScrapedItem[] = [];
  
  for (const element of elements) {
    const text = await element.innerText();
    if (text && text.trim()) {
      const cleanText = text.trim();
      if (INVALID_TITLES.some(t => cleanText.includes(t))) {
        continue;
      }

      const link = await extractLink(element, url);
      // Use synthesized link with hash if no real link found, to avoid duplicates
      const finalLink = link || `${url}#${cleanText.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

      items.push({
        title: cleanText,
        link: finalLink
      });
    }
  }
  
  return items;
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
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
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

      // Handle mixed source mode: dynamically select scraper based on URL pattern
      if (currentSource === 'mixed') {
        if (url.includes('twitter.com') || url.includes('x.com')) {
          currentSource = 'twitter';
        } else {
          currentSource = 'web';
        }
        console.log(`[Mixed Mode] Processing ${url} as ${currentSource}`);
      }

      const result: ScrapedResult = {
        url,
        source: currentSource,
        name: args.name,
        content: null,
        items: [],
        timestamp: new Date().toISOString()
      };
      
      try {
        if (currentSource === 'twitter') {
          const item = await scrapeWithRetry(() => scrapeTwitter(page, url));
          
          if (item) {
            result.items.push(item);
            result.content = item.title;

            // Use tweet text as title (truncated)
            const title = item.title.slice(0, 100) + (item.title.length > 100 ? '...' : '');
            
            if (!isDuplicate([...existingNews, ...newItems], title, item.link)) {
              newItems.push(createNewsItem(args.name, title, item.link));
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
            result.error = 'Missing selector';
            results.push(result);
            continue;
          }

          const items = await scrapeWithRetry(() => scrapeWeb(page, url, selector));
          
          if (items && items.length > 0) {
            result.items = items;
            result.content = items.map(i => i.title).join(' | ');
            
            for (const item of items) {
               // If link is fallback URL, checking duplicates against item.link is correct
               // but allows only one item per page if they all fallback.
               // If extractLink works, we get unique links.
              if (!isDuplicate([...existingNews, ...newItems], item.title, item.link)) {
                newItems.push(createNewsItem(args.name, item.title, item.link));
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
      await sleep(1000);
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  if (newItems.length > 0) {
    const updatedNews = [...existingNews, ...newItems];
    writeNewsJson(updatedNews);
    console.log(`\nSummary: Added ${addedCount} new items, skipped ${skippedCount} duplicates`);
    console.log(`Total items in news.json: ${updatedNews.length}`);
  } else {
    console.log(`\nSummary: No new items added, skipped ${skippedCount} duplicates`);
    console.log(`Total items in news.json: ${existingNews.length}`);
  }
  
  console.log('\nScraping Results:');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
