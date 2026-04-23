'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log, select, isCancel, cancel } = require('@clack/prompts');
const colors = require('picocolors');

function getRailwayToml() {
  return [
    `[build]`,
    `  builder = "dockerfile"`,
    ``,
    `[deploy]`,
    `  healthcheckPath = "/health/readiness"`,
    `  healthcheckTimeout = 120`,
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

    let existingProjects = [];
    try {
      const result = spawnSync('railway', ['list', '--json'], { stdio: 'pipe', encoding: 'utf8' });
      if (result.status === 0) existingProjects = JSON.parse(result.stdout);
    } catch (_) {}

    let linkToProject = null;
    if (existingProjects.length > 0) {
      const choice = await select({
        message: 'Railway project:',
        options: [
          ...existingProjects.map((p) => ({ value: p.id, label: p.name })),
          { value: '__new__', label: 'Create new project', hint: appName },
        ],
      });
      if (isCancel(choice)) {
        cancel('Deploy cancelled.');
        process.exit(0);
      }
      if (choice !== '__new__') linkToProject = choice;
    }

    fs.writeFileSync(path.join(cwd, 'railway.toml'), getRailwayToml(), 'utf8');
    log.success('Generated railway.toml');

    if (linkToProject) {
      log.info('Linking to existing Railway project...');
      execSync(`railway link -p "${linkToProject}"`, { stdio: 'inherit' });
    } else {
      log.info(`Initializing Railway project: ${colors.cyan(appName)}`);
      execSync(`railway init --name "${appName}"`, { stdio: 'inherit' });
    }

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
