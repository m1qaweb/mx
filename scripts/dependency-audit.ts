import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface AuditResult {
  success: boolean;
  criticalCount: number;
  highCount: number;
  moderateCount: number;
  lowCount: number;
  output: string;
}

interface OutdatedResult {
  packages: OutdatedPackage[];
  output: string;
}

interface OutdatedPackage {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  type: string;
}

async function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      shell: true,
      cwd: path.join(__dirname, '..')
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code: number | null) => {
      resolve({ code: code || 0, stdout, stderr });
    });

    proc.on('error', (error: Error) => {
      resolve({ code: 1, stdout, stderr: error.message });
    });
  });
}

async function runAudit(): Promise<AuditResult> {
  console.log('Running npm audit...\n');
  
  const result = await runCommand('npm', ['audit', '--json']);
  
  const auditResult: AuditResult = {
    success: true,
    criticalCount: 0,
    highCount: 0,
    moderateCount: 0,
    lowCount: 0,
    output: result.stdout
  };

  try {
    const auditData = JSON.parse(result.stdout);
    
    if (auditData.metadata && auditData.metadata.vulnerabilities) {
      const vulns = auditData.metadata.vulnerabilities;
      auditResult.criticalCount = vulns.critical || 0;
      auditResult.highCount = vulns.high || 0;
      auditResult.moderateCount = vulns.moderate || 0;
      auditResult.lowCount = vulns.low || 0;
    }
    
    auditResult.success = auditResult.criticalCount === 0 && auditResult.highCount === 0;
  } catch (error) {
    // JSON parsing failed, fall back to text parsing
    const criticalMatch = result.stdout.match(/(\d+)\s+critical/i);
    const highMatch = result.stdout.match(/(\d+)\s+high/i);
    
    if (criticalMatch) auditResult.criticalCount = parseInt(criticalMatch[1], 10);
    if (highMatch) auditResult.highCount = parseInt(highMatch[1], 10);
    
    auditResult.success = auditResult.criticalCount === 0 && auditResult.highCount === 0;
  }

  return auditResult;
}

async function runOutdated(): Promise<OutdatedResult> {
  console.log('Running npm outdated...\n');
  
  const result = await runCommand('npm', ['outdated', '--json']);
  
  const outdatedResult: OutdatedResult = {
    packages: [],
    output: result.stdout
  };

  try {
    const outdatedData = JSON.parse(result.stdout || '{}');
    
    for (const [name, info] of Object.entries(outdatedData)) {
      const pkgInfo = info as { current?: string; wanted?: string; latest?: string; type?: string };
      outdatedResult.packages.push({
        name,
        current: pkgInfo.current || 'unknown',
        wanted: pkgInfo.wanted || 'unknown',
        latest: pkgInfo.latest || 'unknown',
        type: pkgInfo.type || 'dependencies'
      });
    }
  } catch (error) {
    // Empty or invalid JSON is expected when no packages are outdated
  }

  return outdatedResult;
}

function generateReport(audit: AuditResult, outdated: OutdatedResult): string {
  const timestamp = new Date().toISOString();
  
  let report = `# Dependency Audit Report\n\n`;
  report += `**Date:** ${timestamp}\n\n`;

  // Audit Section
  report += `## Security Audit\n\n`;
  
  if (audit.success) {
    report += `### Status: ✅ PASSED\n\n`;
    report += `No critical or high severity vulnerabilities found.\n\n`;
  } else {
    report += `### Status: ❌ ACTION REQUIRED\n\n`;
  }
  
  report += `| Severity | Count |\n`;
  report += `|----------|-------|\n`;
  report += `| Critical | ${audit.criticalCount} |\n`;
  report += `| High | ${audit.highCount} |\n`;
  report += `| Moderate | ${audit.moderateCount} |\n`;
  report += `| Low | ${audit.lowCount} |\n\n`;

  // Outdated Section
  report += `## Outdated Packages\n\n`;
  
  if (outdated.packages.length === 0) {
    report += `All packages are up to date. ✅\n\n`;
  } else {
    report += `| Package | Current | Wanted | Latest | Type |\n`;
    report += `|---------|---------|--------|--------|------|\n`;
    
    for (const pkg of outdated.packages) {
      const majorUpdate = pkg.current.split('.')[0] !== pkg.latest.split('.')[0];
      const indicator = majorUpdate ? ' ⚠️' : '';
      report += `| ${pkg.name}${indicator} | ${pkg.current} | ${pkg.wanted} | ${pkg.latest} | ${pkg.type} |\n`;
    }
    report += `\n`;
  }

  // Recommendations
  report += `## Recommendations\n\n`;
  
  if (audit.criticalCount > 0 || audit.highCount > 0) {
    report += `1. **Immediate Action Required**: Run \`npm audit fix\` to fix vulnerabilities automatically.\n`;
    report += `2. If automatic fix is not possible, run \`npm audit fix --force\` (may include breaking changes).\n`;
    report += `3. Review the audit output and update packages manually if needed.\n\n`;
  }
  
  if (outdated.packages.length > 0) {
    const majorUpdates = outdated.packages.filter(p => p.current.split('.')[0] !== p.latest.split('.')[0]);
    if (majorUpdates.length > 0) {
      report += `4. **Major Updates Available**: The following packages have major version updates available:\n`;
      for (const pkg of majorUpdates) {
        report += `   - ${pkg.name}: ${pkg.current} → ${pkg.latest}\n`;
      }
      report += `   Review changelogs before updating.\n\n`;
    }
  }

  return report;
}

async function main() {
  console.log('Starting dependency audit...\n');
  console.log('='.repeat(50));

  // Run audit
  const auditResult = await runAudit();
  
  console.log('\nAudit Results:');
  console.log(`- Critical: ${auditResult.criticalCount}`);
  console.log(`- High: ${auditResult.highCount}`);
  console.log(`- Moderate: ${auditResult.moderateCount}`);
  console.log(`- Low: ${auditResult.lowCount}`);

  console.log('\n' + '='.repeat(50));

  // Run outdated
  const outdatedResult = await runOutdated();
  
  console.log('\nOutdated Packages:');
  if (outdatedResult.packages.length === 0) {
    console.log('All packages are up to date.');
  } else {
    for (const pkg of outdatedResult.packages) {
      console.log(`- ${pkg.name}: ${pkg.current} → ${pkg.latest}`);
    }
  }

  console.log('\n' + '='.repeat(50));

  // Generate and save report
  const reportDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const report = generateReport(auditResult, outdatedResult);
  const reportPath = path.join(reportDir, `dependency-audit-${new Date().toISOString().split('T')[0]}.md`);
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport written to: ${reportPath}`);

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Summary:');
  
  const needsAction = auditResult.criticalCount > 0 || auditResult.highCount > 0;
  
  if (needsAction) {
    console.log('\n⚠️  ACTION REQUIRED: Critical or high severity vulnerabilities found.');
    console.log('   Consider creating a PR to fix these issues.');
    console.log('   Run: npm audit fix');
  } else {
    console.log('\n✅ No critical issues found.');
  }

  // Exit with appropriate code
  process.exit(needsAction ? 1 : 0);
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
