import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://syndication.twitter.com/srv/timeline-profile/screen-name/kiro_dev');
  await page.waitForTimeout(2000);

  const content = await page.content();
  console.log(content.substring(0, 500));

  await browser.close();
}

main().catch(console.error);
