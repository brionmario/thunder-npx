'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log } = require('@clack/prompts');
const colors = require('picocolors');

function getRailwayToml() {
  return [
    `[build]`,
    `  builder = "dockerfile"`,
    ``,
    `[deploy]`,
    `  healthcheckPath = "/health"`,
    `  healthcheckTimeout = 60`,
  ].join('\n') + '\n';
}

const railway = {
  id: 'railway',
  displayName: 'Railway',
  description: 'Simple deploys, built-in managed Postgres option',
  cliName: 'railway',
  installCmd: 'npm install -g @railway/cli',

  async preflight() {
    const auth = spawnSync('railway', ['whoami'], { stdio: 'pipe' });
    if (auth.status !== 0) {
      log.info('Not logged in to Railway — opening browser to authenticate...');
      execSync('railway login', { stdio: 'inherit' });
    }
  },

  async deploy({ appName, dbType, dbUrl }) {
    const cwd = process.cwd();

    fs.writeFileSync(path.join(cwd, 'railway.toml'), getRailwayToml(), 'utf8');
    log.success('Generated railway.toml');

    log.info(`Initializing Railway project: ${colors.cyan(appName)}`);
    execSync(`railway init --name "${appName}"`, { stdio: 'inherit' });

    if (dbType === 'postgres' && dbUrl) {
      log.info('Setting DATABASE_URL...');
      execSync(`railway variables set "DATABASE_URL=${dbUrl}"`, { stdio: 'inherit' });
    }

    log.info('Deploying (this takes a few minutes)...');
    execSync('railway up --detach', { stdio: 'inherit' });

    const domainResult = spawnSync('railway', ['domain'], { stdio: 'pipe', encoding: 'utf8' });
    const domain = domainResult.stdout?.trim();
    if (domain) {
      log.success(`${colors.bold(colors.green('Deployed!'))} ${colors.cyan(`https://${domain}`)}`);
    } else {
      log.success(
        `${colors.bold(colors.green('Deployed!'))} Run ${colors.cyan('railway open')} to view your app.`
      );
    }
  },
};

module.exports = railway;
