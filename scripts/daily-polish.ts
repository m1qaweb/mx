import { execSync } from 'child_process';

// Last verified: 2026-02-21 (UI/UX Sweep)

function runCommand(command: string, description: string) {
  console.log(`\n--- Running ${description} ---\n`);
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`\n✅ ${description} Passed\n`);
  } catch (error) {
    console.error(`\n❌ ${description} Failed\n`);
    process.exit(1);
  }
}

function main() {
  console.log('Starting Daily Polish (UI/UX Sweep)...\n');

  // 1. Check for hardcoded hex colors and standard spacing
  runCommand('npm run lint:styles', 'Style Audit');

  // 2. Check for broken links
  runCommand('npm run check-links', 'Link Check');

  console.log('✨ All Daily Polish checks passed! Ready for PR.');
}

main();
