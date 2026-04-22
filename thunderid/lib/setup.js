'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function findSetupScript(installPath) {
  // Check root first, then one level deep (handles zip subdirectory nesting)
  const rootScript = path.join(installPath, 'setup.sh');
  if (fs.existsSync(rootScript)) return rootScript;

  for (const entry of fs.readdirSync(installPath)) {
    const nested = path.join(installPath, entry, 'setup.sh');
    if (fs.existsSync(nested)) return nested;
  }

  return null;
}

function findThunderRoot(installPath) {
  // The zip may extract to a subdirectory like thunder-0.34.0-macos-arm64/
  const setupScript = findSetupScript(installPath);
  if (!setupScript) return null;
  return path.dirname(setupScript);
}

function runSetup(installPath, args = []) {
  if (process.platform === 'win32') {
    const { note } = require('@clack/prompts');
    note(
      'setup.sh requires a Unix shell.\n' +
      'Open WSL or Git Bash, navigate to:\n' +
      `  ${installPath}\n` +
      'and run:  bash setup.sh',
      'Windows users'
    );
    process.exit(0);
  }

  const thunderRoot = findThunderRoot(installPath);
  if (!thunderRoot) {
    throw new Error(`setup.sh not found in ${installPath}`);
  }

  execFileSync('bash', ['setup.sh', ...args], {
    cwd: thunderRoot,
    stdio: 'inherit',
  });
}

function runStart(installPath, args = []) {
  if (process.platform === 'win32') {
    const { note } = require('@clack/prompts');
    note(
      'Thunder requires a Unix shell to start.\n' +
      'Open WSL or Git Bash, navigate to:\n' +
      `  ${installPath}\n` +
      'and run the Thunder binary directly.',
      'Windows users'
    );
    process.exit(0);
  }

  const thunderRoot = findThunderRoot(installPath);
  if (!thunderRoot) {
    throw new Error(`Thunder installation not found in ${installPath}`);
  }

  // Prefer a dedicated start script, then fall back to the binary
  const startScript = path.join(thunderRoot, 'start.sh');
  if (fs.existsSync(startScript)) {
    execFileSync('bash', ['start.sh', ...args], { cwd: thunderRoot, stdio: 'inherit' });
    return;
  }

  const binary = path.join(thunderRoot, 'thunder');
  if (fs.existsSync(binary)) {
    execFileSync(binary, args, { cwd: thunderRoot, stdio: 'inherit' });
    return;
  }

  throw new Error(`No start.sh or thunder binary found in ${thunderRoot}`);
}

module.exports = { runSetup, runStart, findThunderRoot, findSetupScript };
