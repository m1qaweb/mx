import * as path from 'path';
import * as fs from 'fs';

// Default site URL - should be configured for actual deployment
const DEFAULT_SITE_URL = process.env.SITE_URL || 'http://localhost:4321';

interface LinkCheckResult {
  url: string;
  brokenLinks: number;
  totalLinks: number;
  success: boolean;
  output: string;
}

async function runLinkinator(url: string): Promise<LinkCheckResult> {
  // Dynamic import for ESM-only package
  const { LinkChecker } = await import('linkinator');
  const checker = new LinkChecker();

  console.log(`Scanning ${url} ...`);

  const results = await checker.check({
    path: url,
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
    url,
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
  report += `**URL Checked:** ${result.url}\n\n`;
  
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
  // Get URL from command line arg or env or default
  const targetUrl = process.argv[2] || DEFAULT_SITE_URL;

  console.log('Running broken link check (via linkinator)...\n');
  console.log(`Target URL: ${targetUrl}`);
  console.log('Note: Twitter/X links are excluded due to anti-scraping measures.\n');
  console.log('---\n');
  
  // Check if we're checking a real site or localhost
  if (targetUrl.includes('localhost')) {
    console.log('Warning: Checking localhost. Make sure your dev server is running.\n');
    console.log('To check a production site, pass the URL as an argument or set SITE_URL:\n');
    console.log('  npm run check-links -- https://your-site.com\n');
  }
  
  try {
    const result = await runLinkinator(targetUrl);

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

    // Exit with appropriate code for CI
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
