import * as fs from 'fs';
import * as path from 'path';

// Path constants relative to project root
const NEWS_JSON_PATH = path.join(__dirname, '..', 'src', 'data', 'news.json');
const ARCHIVE_JSON_PATH = path.join(__dirname, '..', 'src', 'data', 'news-archive.json');

// Archive threshold in days (configurable via environment variable)
const ARCHIVE_DAYS = parseInt(process.env.ARCHIVE_DAYS || '30', 10);

interface NewsItem {
  id: string;
  source: string;
  title: string;
  date: string;
  url: string;
}

function readJsonFile(filePath: string): NewsItem[] {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
  }
  return [];
}

function writeJsonFile(filePath: string, data: NewsItem[]): void {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
    throw error;
  }
}

function getArchiveThresholdDate(): Date {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - ARCHIVE_DAYS);
  threshold.setHours(0, 0, 0, 0);
  return threshold;
}

function identifyOldEntries(items: NewsItem[], threshold: Date): { old: NewsItem[]; current: NewsItem[] } {
  const old: NewsItem[] = [];
  const current: NewsItem[] = [];

  for (const item of items) {
    const itemDate = new Date(item.date);
    if (itemDate < threshold) {
      old.push(item);
    } else {
      current.push(item);
    }
  }

  return { old, current };
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

async function main() {
  console.log('Starting news archival process...\n');
  console.log(`Archive threshold: ${ARCHIVE_DAYS} days`);
  console.log(`Items older than ${formatDate(getArchiveThresholdDate())} will be archived.\n`);
  console.log('='.repeat(50));

  // Read current news
  const currentNews = readJsonFile(NEWS_JSON_PATH);
  console.log(`\nCurrent news items: ${currentNews.length}`);

  // Read existing archive
  const existingArchive = readJsonFile(ARCHIVE_JSON_PATH);
  console.log(`Existing archive items: ${existingArchive.length}`);

  // Identify items to archive
  const threshold = getArchiveThresholdDate();
  const { old, current } = identifyOldEntries(currentNews, threshold);
  
  console.log(`\nItems to archive: ${old.length}`);
  console.log(`Items to keep: ${current.length}`);

  if (old.length === 0) {
    console.log('\n✅ No items need to be archived.');
    console.log('='.repeat(50));
    return;
  }

  // Show items being archived
  console.log('\n' + '='.repeat(50));
  console.log('Items being archived:');
  console.log('-'.repeat(50));
  
  for (const item of old) {
    console.log(`- [${item.source}] ${item.title.slice(0, 50)}${item.title.length > 50 ? '...' : ''}`);
    console.log(`  Date: ${item.date}`);
  }

  // Merge with existing archive (avoiding duplicates)
  const existingIds = new Set(existingArchive.map(item => item.id));
  const newArchiveItems = old.filter(item => !existingIds.has(item.id));
  const updatedArchive = [...existingArchive, ...newArchiveItems];

  // Sort archive by date (newest first)
  updatedArchive.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Write updated files
  console.log('\n' + '='.repeat(50));
  console.log('Writing updated files...');

  writeJsonFile(NEWS_JSON_PATH, current);
  console.log(`✓ Updated news.json: ${current.length} items`);

  writeJsonFile(ARCHIVE_JSON_PATH, updatedArchive);
  console.log(`✓ Updated news-archive.json: ${updatedArchive.length} items`);

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Summary:');
  console.log(`- Archived: ${old.length} items`);
  console.log(`- Remaining in news.json: ${current.length} items`);
  console.log(`- Total in archive: ${updatedArchive.length} items`);
  console.log(`- New items added to archive: ${newArchiveItems.length}`);
  console.log(`- Duplicates skipped: ${old.length - newArchiveItems.length}`);
  console.log('\n✅ Archival complete.');
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
