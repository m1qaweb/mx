import * as path from 'path';
import * as fs from 'fs';

// Default site URL - should be configured for actual deployment
const DEFAULT_SITE_URL = process.env.SITE_URL || 'http://localhost:4321';
const EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', 'data', 'reports', '.cache'];

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
      if (EXCLUDE_DIRS.includes(file)) return;

      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(findMarkdownFiles(fullPath));
      } else {
        if (file.endsWith('.md')) {
          results.push(fullPath);
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

function extractLinksFromNewsJson(): string[] {
  const newsJsonPath = path.join(__dirname, '..', 'src', 'data', 'news.json');
  const newsArchiveJsonPath = path.join(__dirname, '..', 'src', 'data', 'news-archive.json');
  const links: string[] = [];

  try {
    if (fs.existsSync(newsJsonPath)) {
      const content = fs.readFileSync(newsJsonPath, 'utf-8');
      const data = JSON.parse(content);
      if (Array.isArray(data)) {
        data.forEach((item: any) => {
          if (item.url && typeof item.url === 'string') {
            links.push(item.url);
          }
        });
      }
    }
  } catch (error) {
    console.error('Error reading news.json:', error);
  }

  try {
    if (fs.existsSync(newsArchiveJsonPath)) {
      const content = fs.readFileSync(newsArchiveJsonPath, 'utf-8');
      const data = JSON.parse(content);
      if (Array.isArray(data)) {
        data.forEach((item: any) => {
          if (item.url && typeof item.url === 'string') {
            links.push(item.url);
          }
        });
      }
    }
  } catch (error) {
    console.error('Error reading news-archive.json:', error);
  }

  return links;
}

async function checkLinksWithLinkinator(links: string[]): Promise<LinkCheckResult> {
  // Dynamic import for ESM-only package
  // Cast to any to bypass TS resolution issues in CJS environment
  const linkinator = await import('linkinator') as any;
  const { LinkChecker } = linkinator;
  const checker = new LinkChecker();

  console.log(`Checking ${links.length} links using Linkinator...`);

  // Create temporary HTML file
  const tempFileName = `temp-links-${Date.now()}.html`;
  const tempFile = path.join(__dirname, tempFileName);

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head><title>Link Check</title></head>
      <body>
        <ul>
          ${links.map(link => `<li><a href="${link}">${link}</a></li>`).join('\n')}
        </ul>
      </body>
    </html>
  `;

  fs.writeFileSync(tempFile, htmlContent);

  try {
    const results = await checker.check({
      path: tempFile,
      recurse: false,
      linksToSkip: async (link: string) => {
        return /twitter\.com/.test(link) || /x\.com/.test(link) || /anthropic\.com/.test(link);
      }
    });

    // Filter out the temp file itself from results if it appears
    const checkedLinks = results.links.filter((l: any) => l.url !== `file://${tempFile}` && l.url !== tempFile);

    const brokenLinks = checkedLinks.filter((link: any) => link.state === 'BROKEN');

    let output = '';
    if (brokenLinks.length > 0) {
      output = brokenLinks.map((link: any) => `[${link.status}] ${link.url} (from Markdown)`).join('\n');
    }

    // Print results
    if (brokenLinks.length > 0) {
      console.log('\nBroken links found:');
      console.log(output);
    } else {
      console.log('\nNo broken links found.');
    }

    return {
      url: 'Markdown Files',
      brokenLinks: brokenLinks.length,
      totalLinks: checkedLinks.length,
      success: results.passed,
      output
    };
  } finally {
    // Cleanup
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

async function runLinkinator(target: string): Promise<LinkCheckResult> {
  // Dynamic import for ESM-only package
  // Cast to any to bypass TS resolution issues in CJS environment
  const linkinator = await import('linkinator') as any;
  const { LinkChecker } = linkinator;
  const checker = new LinkChecker();

  console.log(`Scanning URL ${target} ...`);

  const results = await checker.check({
    path: target,
    recurse: true,
    linksToSkip: async (link: string) => {
      return /twitter\.com/.test(link) || /x\.com/.test(link) || /anthropic\.com/.test(link);
    }
  });

  const brokenLinks = results.links.filter((link: any) => link.state === 'BROKEN');

  let output = '';
  if (brokenLinks.length > 0) {
    output = brokenLinks.map((link: any) => `[${link.status}] ${link.url} (on ${link.parent})`).join('\n');
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
    target = path.join(__dirname, '..');
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

      console.log(`Scanning news.json and news-archive.json for links...`);
      const newsLinks = extractLinksFromNewsJson();
      console.log(`Found ${newsLinks.length} links in news data files.`);
      newsLinks.forEach(link => allLinks.add(link));

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
        result = await checkLinksWithLinkinator(uniqueLinks);
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
