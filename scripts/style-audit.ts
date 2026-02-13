import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.join(__dirname, '..');
const EXCLUDE_DIRS = ['data', 'node_modules', '.git', 'dist', 'build', '.cache', 'reports'];
const EXCLUDE_FILES = ['tailwind.config.js', 'style-audit.ts', 'daily-polish.ts'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.astro', '.html', '.css', '.md'];

interface Violation {
  file: string;
  line: number;
  type: 'HEX_COLOR' | 'NON_STANDARD_SPACING' | 'INLINE_STYLE';
  match: string;
  message: string;
}

function scanFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      // Check for Hex Colors
      // Matches #ABC (3 chars) or #ABCDEF (6 chars). Strict check to avoid 4 or 5 char matches.
      const hexMatch = line.match(/#([0-9a-fA-F]{3}){1,2}\b/g);
      if (hexMatch) {
        // Filter out likely non-color matches (e.g. markdown headers)
        hexMatch.forEach(match => {
           const trimmedLine = line.trim();
           // Skip markdown headers
           if (filePath.endsWith('.md') && trimmedLine.startsWith('#')) return;

           // Skip purely numeric IDs in markdown files (likely issue references)
           if (filePath.endsWith('.md') && /^#[0-9]+$/.test(match)) return;

           // Skip if it's inside a URL (e.g. anchor link)
           if (line.includes(`](${match}`) || line.includes(`href="${match}"`)) return;

           // Skip if strictly 4 or 5 chars (regex captures groups, so we check length)
           if (match.length !== 4 && match.length !== 7) return;

           violations.push({
             file: filePath,
             line: index + 1,
             type: 'HEX_COLOR',
             match: match,
             message: `Hardcoded hex color found: ${match}. Use Tailwind colors instead.`
           });
        });
      }

      // Check for Non-Standard Spacing
      // Regex to find arbitrary values in square brackets for spacing utilities
      // e.g. p-[3px], m-[10px], w-[13px], h-[2.5px]
      // We look for p-, m-, w-, h-, gap-, top-, bottom-, left-, right- followed by [value]
      const spacingRegex = /\b(p|m|w|h|gap|top|bottom|left|right|px|py|mx|my|pt|pb|pl|pr|mt|mb|ml|mr)-\[([0-9\.]+)px\]/g;
      let spacingMatch;
      while ((spacingMatch = spacingRegex.exec(line)) !== null) {
        const value = parseFloat(spacingMatch[2]);
        if (value % 4 !== 0) {
          violations.push({
            file: filePath,
            line: index + 1,
            type: 'NON_STANDARD_SPACING',
            match: spacingMatch[0],
            message: `Non-standard spacing value: ${spacingMatch[0]}. Use multiples of 4px (e.g., 4, 8, 12, 16) or standard Tailwind classes.`
          });
        }
      }

      // Check for Inline Styles with px values
      const inlineStyleMatch = line.match(/style="[^"]*:\s*[^"]*px[^"]*"/g);
      if (inlineStyleMatch) {
         inlineStyleMatch.forEach(match => {
            violations.push({
              file: filePath,
              line: index + 1,
              type: 'INLINE_STYLE',
              match: match,
              message: `Inline style with pixel values found: ${match}. Use Tailwind classes instead.`
            });
         });
      }

      // Check for Raw CSS Properties with px values (e.g. padding: 13px) in .css files
      if (filePath.endsWith('.css')) {
        const cssPropertyRegex = /(padding|margin|width|height|gap|top|bottom|left|right|font-size|line-height|border-radius|border-width)(?:-[a-z]+)?\s*:\s*([^;]+)/g;
        let cssMatch;
        while ((cssMatch = cssPropertyRegex.exec(line)) !== null) {
          const propertyName = cssMatch[0].split(':')[0].trim();
          const valueString = cssMatch[2];

          const pxRegex = /([0-9\.]+)px/g;
          let pxMatch;
          while ((pxMatch = pxRegex.exec(valueString)) !== null) {
            const value = parseFloat(pxMatch[1]);
            if (value % 4 !== 0) {
              violations.push({
                file: filePath,
                line: index + 1,
                type: 'NON_STANDARD_SPACING',
                match: `${propertyName}: ${pxMatch[0]}`,
                message: `Non-standard CSS spacing value: ${pxMatch[0]}. Use multiples of 4px.`
              });
            }
          }
        }
      }
    });
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
  }
  return violations;
}

function walkDir(dir: string): string[] {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        if (!EXCLUDE_DIRS.includes(file)) {
          results = results.concat(walkDir(fullPath));
        }
      } else {
        if (EXTENSIONS.includes(path.extname(file)) && !EXCLUDE_FILES.includes(file)) {
          results.push(fullPath);
        }
      }
    });
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }
  return results;
}

function generateReport(violations: Violation[]) {
  const timestamp = new Date().toISOString().split('T')[0];
  const reportPath = path.join(__dirname, '..', 'reports', `style-audit-${timestamp}.md`);

  let report = `# Style Audit Report\n\n`;
  report += `**Date:** ${new Date().toISOString()}\n`;

  if (violations.length === 0) {
    report += `## Status: ✅ PASSED\n\n`;
    report += `No style violations found.\n`;
  } else {
    report += `## Status: ❌ ISSUES FOUND\n\n`;
    report += `**Total Violations:** ${violations.length}\n\n`;
    report += `### Details\n\n`;
    violations.forEach(v => {
      const relativePath = path.relative(path.join(__dirname, '..'), v.file);
      report += `- **[${v.type}]** \`${relativePath}:${v.line}\`: ${v.message} (Match: \`${v.match}\`)\n`;
    });
  }

  // Ensure reports directory exists
  const reportsDir = path.dirname(reportPath);
  if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
  }

  fs.writeFileSync(reportPath, report);
  console.log(`Report written to ${reportPath}`);
}

function main() {
  console.log('Starting Style Audit...');
  console.log(`Scanning ${SRC_DIR}...\n`);

  const files = walkDir(SRC_DIR);
  let allViolations: Violation[] = [];

  files.forEach(file => {
    const violations = scanFile(file);
    allViolations = allViolations.concat(violations);
  });

  generateReport(allViolations);

  if (allViolations.length > 0) {
    console.log(`❌ Found ${allViolations.length} violations:\n`);
    allViolations.forEach(v => {
      const relativePath = path.relative(process.cwd(), v.file);
      console.log(`[${v.type}] ${relativePath}:${v.line}`);
      console.log(`  Match: ${v.match}`);
      console.log(`  ${v.message}\n`);
    });
    console.log('Please fix these issues before committing.');
    process.exit(1);
  } else {
    console.log('✅ No style violations found.');
    console.log('- No hardcoded hex colors found.');
    console.log('- No non-standard spacing found.');
    process.exit(0);
  }
}

main();
