import { spawn } from 'child_process';
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

async function runBrokenLinkChecker(url: string): Promise<LinkCheckResult> {
  return new Promise((resolve) => {
    const result: LinkCheckResult = {
      url,
      brokenLinks: 0,
      totalLinks: 0,
      success: true,
      output: ''
    };

    // Use npx to run broken-link-checker
    const blc = spawn('npx', ['blc', url, '-ro', '--exclude', 'twitter.com', '--exclude', 'x.com'], {
      shell: true,
      cwd: path.join(__dirname, '..')
    });

    let output = '';

    blc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });

    blc.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      process.stderr.write(text);
    });

    blc.on('close', (code: number | null) => {
      result.output = output;
      
      // Parse output for statistics
      const brokenMatch = output.match(/(\d+)\s+broken/i);
      const totalMatch = output.match(/(\d+)\s+links?\s+checked/i);
      
      if (brokenMatch) {
        result.brokenLinks = parseInt(brokenMatch[1], 10);
      }
      if (totalMatch) {
        result.totalLinks = parseInt(totalMatch[1], 10);
      }
      
      result.success = code === 0 && result.brokenLinks === 0;
      resolve(result);
    });

    blc.on('error', (error: Error) => {
      result.success = false;
      result.output = `Error running broken-link-checker: ${error.message}`;
      console.error(result.output);
      resolve(result);
    });
  });
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
  // Get URL from command line args or default
  const args = process.argv.slice(2);
  const targetUrl = args[0] || DEFAULT_SITE_URL;

  console.log('Running broken link check...\n');
  console.log(`Target URL: ${targetUrl}`);
  console.log('Note: Twitter/X links are excluded due to anti-scraping measures.\n');
  console.log('---\n');
  
  // Check if we're checking a real site or localhost
  if (targetUrl.includes('localhost')) {
    console.log('Warning: Checking localhost. Make sure your dev server is running.\n');
    console.log('To check a production site, pass the URL as an argument or set the SITE_URL environment variable:\n');
    console.log('  npm run check-links -- https://your-site.com');
    console.log('  SITE_URL=https://your-site.com npm run check-links\n');
  }
  
  const result = await runBrokenLinkChecker(targetUrl);
  
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
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
