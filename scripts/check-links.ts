import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

// Default site URL - should be configured for actual deployment
const DEFAULT_SITE_URL = process.env.SITE_URL || 'http://localhost:4321';

interface LinkCheckResult {
  url: string | string[];
  brokenLinks: number;
  totalLinks: number;
  success: boolean;
  output: string;
}

function findMarkdownFiles(dir: string): string[] {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      file = path.join(dir, file);
      const stat = fs.statSync(file);
      if (stat && stat.isDirectory()) {
        results = results.concat(findMarkdownFiles(file));
      } else {
        if (file.endsWith('.md')) {
          results.push(file);
        }
      }
    });
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }
  return results;
}

function extractLinksFromMarkdown(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Match [text](url) format
    const regex = /\[.*?\]\((https?:\/\/[^\s\)]+)\)/g;
    const links: string[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
      links.push(match[1]);
    }
    return links;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return [];
  }
}

async function checkLinksWithAxios(links: string[]): Promise<LinkCheckResult> {
  const brokenLinksList: { url: string; status: any; parent: string }[] = [];
  let checkedCount = 0;

  console.log(`Checking ${links.length} links...`);

  // Filter out Twitter/X links before checking
  const filteredLinks = links.filter(link => !/twitter\.com/.test(link) && !/x\.com/.test(link));
  const skippedCount = links.length - filteredLinks.length;
  if (skippedCount > 0) {
    console.log(`Skipped ${skippedCount} Twitter/X links.`);
  }

  for (const link of filteredLinks) {
    try {
      // Try HEAD first
      await axios.head(link, {
        timeout: 10000,
        headers: { 'User-Agent': 'AI-Pulse-Monitor/1.0' }
      });
    } catch (error: any) {
       // If HEAD fails, try GET (some servers block HEAD or return 405)
       try {
         await axios.get(link, {
            timeout: 10000,
            headers: { 'User-Agent': 'AI-Pulse-Monitor/1.0' }
         });
       } catch (getError: any) {
          const status = getError.response ? getError.response.status : (getError.code || 'UNKNOWN');
          brokenLinksList.push({ url: link, status, parent: 'Markdown File' });
       }
    }
    checkedCount++;
    if (checkedCount % 5 === 0) process.stdout.write('.');
  }
  console.log('\nDone.');

  const brokenOutput = brokenLinksList.map(item => `[${item.status}] ${item.url} (on ${item.parent})`).join('\n');

  if (brokenLinksList.length > 0) {
    console.log('\nBroken links found:');
    console.log(brokenOutput);
  } else {
    console.log('\nNo broken links found.');
  }

  return {
    url: 'Markdown Files',
    brokenLinks: brokenLinksList.length,
    totalLinks: filteredLinks.length, // Only report checked links
    success: brokenLinksList.length === 0,
    output: brokenOutput
  };
}

async function runLinkinator(target: string): Promise<LinkCheckResult> {
  // Dynamic import for ESM-only package
  const { LinkChecker } = await import('linkinator');
  const checker = new LinkChecker();

  console.log(`Scanning URL ${target} ...`);

  const results = await checker.check({
    path: target,
    recurse: true,
    linksToSkip: async (link) => {
      return /twitter\.com/.test(link) || /x\.com/.test(link);
    }
  });

  const brokenLinks = results.links.filter(link => link.state === 'BROKEN');

  let output = '';
  if (brokenLinks.length > 0) {
    output = brokenLinks.map(link => `[${link.status}] ${link.url} (on ${link.parent})`).join('\n');
  }

  // Also print to console
  if (brokenLinks.length > 0) {
    console.log('\nBroken links found:');
    console.log(output);
  } else {
    console.log('\nNo broken links found.');
  }

  return {
    url: target,
    brokenLinks: brokenLinks.length,
    totalLinks: results.links.length,
    success: results.passed,
    output
  };
}

function generateReport(result: LinkCheckResult): string {
  const timestamp = new Date().toISOString();
  
  let report = `# Broken Link Check Report\n\n`;
  report += `**Date:** ${timestamp}\n`;
  const urlDisplay = Array.isArray(result.url) ? 'Multiple Links' : result.url;
  report += `**Target Checked:** ${urlDisplay}\n\n`;
  
  if (result.success) {
    report += `## Status: ✅ PASSED\n\n`;
    report += `No broken links were found.\n\n`;
  } else {
    report += `## Status: ❌ ISSUES FOUND\n\n`;
    report += `**Broken Links:** ${result.brokenLinks}\n`;
    report += `**Total Links Checked:** ${result.totalLinks}\n\n`;
    report += `### Details\n\n`;
    report += '```\n' + result.output + '\n```\n';
  }
  
  return report;
}

async function main() {
  let target = process.argv[2];

  if (!target) {
    const dailyDir = path.join(__dirname, '..', 'src', 'pages', 'daily');
    if (fs.existsSync(dailyDir)) {
      target = dailyDir;
    } else {
      target = DEFAULT_SITE_URL;
    }
  }

  console.log('Running broken link check...\n');
  console.log(`Target: ${target}`);
  console.log('Note: Twitter/X links are excluded due to anti-scraping measures.\n');
  console.log('---\n');
  
  try {
    let result: LinkCheckResult;

    // Check if target is directory
    let isDirectory = false;
    try {
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        isDirectory = true;
      }
    } catch (e) {}

    if (isDirectory) {
      console.log(`Scanning directory ${target} for markdown files...`);
      const files = findMarkdownFiles(target);
      console.log(`Found ${files.length} markdown files.`);

      const allLinks = new Set<string>();
      files.forEach(file => {
        const links = extractLinksFromMarkdown(file);
        links.forEach(link => allLinks.add(link));
      });

      const uniqueLinks = Array.from(allLinks);
      console.log(`Found ${uniqueLinks.length} unique links to check.`);

      if (uniqueLinks.length === 0) {
         result = {
          url: target,
          brokenLinks: 0,
          totalLinks: 0,
          success: true,
          output: 'No links found in markdown files.'
        };
      } else {
        result = await checkLinksWithAxios(uniqueLinks);
      }

    } else {
      // Use linkinator for URLs
      result = await runLinkinator(target);
    }

    console.log('\n---\n');
    console.log('Summary:');
    console.log(`- Total links checked: ${result.totalLinks}`);
    console.log(`- Broken links found: ${result.brokenLinks}`);
    console.log(`- Status: ${result.success ? 'PASSED' : 'FAILED'}`);

    // Write report to file
    const reportDir = path.join(__dirname, '..', 'reports');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const report = generateReport(result);
    const reportPath = path.join(reportDir, `link-check-${new Date().toISOString().split('T')[0]}.md`);
    fs.writeFileSync(reportPath, report);
    console.log(`\nReport written to: ${reportPath}`);

    process.exit(result.success ? 0 : 1);
  } catch (error: any) {
    console.error('Error running link checker:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
