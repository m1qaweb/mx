import * as fs from 'fs';
import * as path from 'path';

interface NewsItem {
  id: string;
  source: string;
  title: string;
  date: string;
  url: string;
}

const DATA_DIR = path.join(__dirname, '..', 'src', 'data');
const NEWS_FILES = ['news.json', 'news-archive.json'];

function validateFile(filename: string): boolean {
  const filepath = path.join(DATA_DIR, filename);
  console.log(`Verifying ${filename}...`);

  if (!fs.existsSync(filepath)) {
    console.error(`Error: File not found: ${filepath}`);
    return false;
  }

  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const data = JSON.parse(content);

    if (!Array.isArray(data)) {
      console.error(`Error: ${filename} is not an array`);
      return false;
    }

    const ids = new Set<string>();
    const urls = new Set<string>();
    let hasErrors = false;

    data.forEach((item: any, index: number) => {
      // Schema check
      const missingFields = [];
      if (!item.id) missingFields.push('id');
      if (!item.source) missingFields.push('source');
      if (!item.title) missingFields.push('title');
      if (!item.date) missingFields.push('date');
      if (!item.url) missingFields.push('url');

      if (missingFields.length > 0) {
        console.error(`Error in ${filename} at index ${index}: Missing fields: ${missingFields.join(', ')}`);
        hasErrors = true;
        return;
      }

      // Type checks
      if (typeof item.id !== 'string' || typeof item.source !== 'string' ||
          typeof item.title !== 'string' || typeof item.date !== 'string' ||
          typeof item.url !== 'string') {
        console.error(`Error in ${filename} at index ${index}: Invalid field types`);
        hasErrors = true;
        return;
      }

      // Date check
      if (isNaN(Date.parse(item.date))) {
         console.error(`Error in ${filename} at index ${index}: Invalid date format: ${item.date}`);
         hasErrors = true;
      }

      // Duplicate checks
      if (ids.has(item.id)) {
        console.error(`Error in ${filename} at index ${index}: Duplicate ID: ${item.id}`);
        hasErrors = true;
      }
      ids.add(item.id);

      if (urls.has(item.url)) {
         console.error(`Error in ${filename} at index ${index}: Duplicate URL: ${item.url}`);
         hasErrors = true;
      }
      urls.add(item.url);
    });

    if (hasErrors) {
      return false;
    }

    console.log(`✅ ${filename} passed validation (${data.length} items)`);
    return true;

  } catch (error) {
    console.error(`Error parsing ${filename}:`, error);
    return false;
  }
}

function main() {
  console.log('Starting data integrity check...\n');
  let allValid = true;

  for (const file of NEWS_FILES) {
    if (!validateFile(file)) {
      allValid = false;
    }
  }

  if (!allValid) {
    console.error('\n❌ Data integrity check FAILED');
    process.exit(1);
  } else {
    console.log('\n✨ Data integrity check PASSED');
  }
}

main();
