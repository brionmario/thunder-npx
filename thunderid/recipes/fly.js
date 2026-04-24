'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { log } = require('@clack/prompts');
const colors = require('picocolors');

function getFlyToml({ appName, dbType }) {
  const lines = [
    `app = "${appName}"`,
    `primary_region = "iad"`,
    ``,
    `[http_service]`,
    `  internal_port = 8090`,
    `  force_https = true`,
    `  auto_stop_machines = true`,
    `  auto_start_machines = true`,
    `  min_machines_running = 0`,
  ];

  if (dbType === 'sqlite') {
    lines.push(``, `[[mounts]]`, `  source = "thunder_data"`, `  destination = "/data"`);
  }

  return lines.join('\n') + '\n';
}

const fly = {
  id: 'fly',
  displayName: 'Fly.io',
  description: 'Free tier, persistent volumes for SQLite, single command',
  comingSoon: true,
  cliName: 'flyctl',
  installCmd: 'curl -L https://fly.io/install.sh | sh',
  postInstallPath: path.join(os.homedir(), '.fly', 'bin'),

  async preflight() {
    const auth = spawnSync('flyctl', ['auth', 'whoami'], { stdio: 'pipe' });
    if (auth.status !== 0) {
      log.info('Not logged in to Fly.io — opening browser to authenticate...');
      execSync('flyctl auth login', { stdio: 'inherit' });
    }
  },

  async deploy({ appName, dbType, dbUrl }) {
    const cwd = process.cwd();

    fs.writeFileSync(path.join(cwd, 'fly.toml'), getFlyToml({ appName, dbType }), 'utf8');
    log.success('Generated fly.toml');

    log.info(`Creating Fly.io app: ${colors.cyan(appName)}`);
    execSync(`flyctl launch --name "${appName}" --no-deploy --copy-config --yes`, { stdio: 'inherit' });

    if (dbType === 'sqlite') {
      log.info('Creating persistent volume for SQLite...');
      execSync(`flyctl volumes create thunder_data --size 1 --yes --app "${appName}"`, { stdio: 'inherit' });
    }

    if (dbType === 'postgres' && dbUrl) {
      log.info('Setting database secret...');
      execSync(`flyctl secrets set "DATABASE_URL=${dbUrl}" --app "${appName}"`, { stdio: 'inherit' });
    }

    log.info('Building and deploying (this takes a few minutes)...');
    execSync('flyctl deploy', { stdio: 'inherit' });

    log.success(`${colors.bold(colors.green('Deployed!'))} ${colors.cyan(`https://${appName}.fly.dev`)}`);
  },
};

module.exports = fly;
