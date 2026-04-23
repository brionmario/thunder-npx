'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');
const { intro, outro, select, text, confirm, spinner, note, isCancel, cancel } = require('@clack/prompts');
const colors = require('picocolors');
const { getLatestThunderVersion } = require('./download');
const { readState } = require('./state');
const { loadRecipes } = require('../recipes/index');

// Cloud-ready deployment.yaml.
// Placeholders (__PUBLIC_URL__ etc.) are substituted at container startup by entrypoint.sh.
function getDeploymentYamlContent() {
  return [
    'server:',
    '  hostname: "0.0.0.0"',
    '  port: 8090',
    '  http_only: true',
    '  public_url: "__PUBLIC_URL__"',
    '',
    'gate_client:',
    '  hostname: "__PUBLIC_HOST__"',
    '  port: __GATE_PORT__',
    '  scheme: "__GATE_SCHEME__"',
    '  path: "/gate"',
    '',
    'cors:',
    '  allowed_origins:',
    '    - "__PUBLIC_URL__"',
    '',
    'passkey:',
    '  allowed_origins:',
    '    - "__PUBLIC_URL__"',
  ].join('\n') + '\n';
}

function getDockerfileContent(version) {
  const dirName = `thunder-${version}-linux-x64`;
  return `FROM alpine:3.19
RUN apk add --no-cache sqlite openssl ca-certificates bash curl unzip lsof

RUN mkdir -p /app \\
    && curl -fsSL -o /tmp/thunder.zip \\
       "https://github.com/asgardeo/thunder/releases/download/v${version}/${dirName}.zip" \\
    && unzip /tmp/thunder.zip -d /app \\
    && rm /tmp/thunder.zip

WORKDIR /app/${dirName}

# Replace the bundled deployment.yaml with a cloud-ready template.
# Placeholders are substituted at runtime by entrypoint.sh using provider env vars.
COPY .thunderdeploy/deployment.yaml repository/conf/deployment.yaml

RUN addgroup -S thunder && adduser -S thunder -G thunder \\
    && chown -R thunder:thunder .

COPY .thunderdeploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER thunder
EXPOSE 8090
ENTRYPOINT ["/entrypoint.sh"]
`;
}

function getEntrypointContent() {
  return `#!/bin/bash
set -e

# Resolve the public URL from provider-injected environment variables.
# Each platform sets a different variable; we normalise them into PUBLIC_URL.
# Users can also set PUBLIC_URL explicitly to override auto-detection.
if [ -z "$PUBLIC_URL" ]; then
  if [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
    PUBLIC_URL="https://$RAILWAY_PUBLIC_DOMAIN"
  elif [ -n "$RENDER_EXTERNAL_URL" ]; then
    PUBLIC_URL="$RENDER_EXTERNAL_URL"
  elif [ -n "$FLY_APP_NAME" ]; then
    PUBLIC_URL="https://$FLY_APP_NAME.fly.dev"
  fi
fi

# Fill in deployment.yaml placeholders with the resolved public URL.
DEPLOY_YAML="repository/conf/deployment.yaml"
if [ -n "$PUBLIC_URL" ]; then
  PUBLIC_HOST=$(echo "$PUBLIC_URL" | sed 's|https://||; s|http://||; s|[:/].*||')
  if echo "$PUBLIC_URL" | grep -q "^https://"; then
    GATE_SCHEME="https"
    GATE_PORT="443"
  else
    GATE_SCHEME="http"
    GATE_PORT="8090"
  fi
else
  PUBLIC_URL="http://localhost:8090"
  PUBLIC_HOST="localhost"
  GATE_SCHEME="http"
  GATE_PORT="8090"
fi
sed -i "s|__PUBLIC_URL__|$PUBLIC_URL|g" "$DEPLOY_YAML"
sed -i "s|__PUBLIC_HOST__|$PUBLIC_HOST|g" "$DEPLOY_YAML"
sed -i "s|__GATE_SCHEME__|$GATE_SCHEME|g" "$DEPLOY_YAML"
sed -i "s|__GATE_PORT__|$GATE_PORT|g" "$DEPLOY_YAML"

# Use /data as sentinel location when a volume is mounted (e.g. Fly.io SQLite),
# otherwise fall back to WORKDIR (resets on redeploy, which is correct since the DB does too).
if [ -d "/data" ]; then
  SENTINEL="/data/.thunder-setup-complete"
else
  SENTINEL=".setup-complete"
fi

if [ ! -f "$SENTINEL" ]; then
  THUNDER_SKIP_SECURITY=true bash setup.sh
  touch "$SENTINEL"
  # setup.sh spawns Thunder (which starts the embedded OpenFGA server as a child process).
  # When setup.sh kills Thunder, OpenFGA can be orphaned on port 9090.
  # If the port is still occupied, the real start below can't start OpenFGA → readiness fails.
  lsof -ti tcp:9090 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1
fi

exec bash start.sh
`;
}

function isCLIAvailable(cliName) {
  if (!cliName) return true;
  const result = spawnSync(cliName, ['--version'], { stdio: 'pipe' });
  return !result.error && result.status === 0;
}

async function ensureCLI(recipe) {
  if (!recipe.cliName || isCLIAvailable(recipe.cliName)) return;

  note(
    `${colors.cyan(recipe.cliName)} is not installed.\n\nInstall command:\n  ${colors.bold(recipe.installCmd)}`,
    `${recipe.displayName} — setup needed`
  );

  const shouldInstall = await confirm({
    message: `Install ${colors.cyan(recipe.cliName)} now?`,
    initialValue: true,
  });

  if (isCancel(shouldInstall) || !shouldInstall) {
    cancel(`Install ${recipe.cliName} and re-run to continue.`);
    process.exit(0);
  }

  const s = spinner();
  s.start(`Installing ${recipe.cliName}...`);
  try {
    execSync(recipe.installCmd, { stdio: 'pipe' });
    s.stop(`${recipe.cliName} installed`);
  } catch (err) {
    s.stop(`Install failed: ${err.message}`);
    note(`Run this manually, then re-run deploy:\n  ${colors.bold(recipe.installCmd)}`, 'Manual install needed');
    process.exit(1);
  }

  // Patch PATH for installers that drop binaries outside the default PATH
  if (recipe.postInstallPath) {
    process.env.PATH = `${recipe.postInstallPath}${path.delimiter}${process.env.PATH}`;
  }

  if (!isCLIAvailable(recipe.cliName)) {
    note(
      `Installed but ${colors.cyan(recipe.cliName)} isn't on PATH yet.\n\nRestart your terminal, then run:\n  ${colors.bold('npx thunderid deploy')}`,
      'Restart terminal needed'
    );
    process.exit(0);
  }
}

async function deploy(_args) {
  // eslint-disable-next-line no-console
  console.clear();

  intro(colors.bold('⚡ ThunderID') + colors.dim(' — Deploy'));

  let version;
  const localState = readState();
  if (localState.lastUsedVersion) {
    version = localState.lastUsedVersion;
    note(`Deploying the version you tested locally: v${version}`, 'Version');
  } else {
    const s = spinner();
    s.start('Fetching latest Thunder release...');
    try {
      version = await getLatestThunderVersion();
      s.stop(`Thunder v${version}`);
    } catch (err) {
      s.stop('Could not fetch latest Thunder release.');
      process.stderr.write(`\nError: ${err.message}\n`);
      process.exit(1);
    }
  }

  const recipes = loadRecipes();

  // Check CLI availability for each recipe upfront
  const availability = Object.fromEntries(
    recipes.map((r) => [r.id, isCLIAvailable(r.cliName)])
  );

  const recipeId = await select({
    message: 'Deploy to which platform?',
    options: recipes.map((r) => ({
      value: r.id,
      label: r.displayName,
      hint: availability[r.id]
        ? r.description
        : `${r.description} — ${colors.yellow(`needs ${r.cliName}`)}`,
    })),
  });

  if (isCancel(recipeId)) {
    cancel('Deploy cancelled.');
    process.exit(0);
  }

  const recipe = recipes.find((r) => r.id === recipeId);

  // Install CLI if missing, then check auth
  await ensureCLI(recipe);

  try {
    await recipe.preflight();
  } catch (err) {
    process.stderr.write(`\n${colors.red('Preflight failed:')} ${err.message}\n`);
    process.exit(1);
  }

  const dbType = await select({
    message: 'Which database?',
    options: [
      { value: 'sqlite', label: 'SQLite', hint: 'Embedded, zero-config (recommended)' },
      { value: 'postgres', label: 'PostgreSQL / Supabase', hint: 'External managed database' },
    ],
  });

  if (isCancel(dbType)) {
    cancel('Deploy cancelled.');
    process.exit(0);
  }

  let dbUrl;
  if (dbType === 'postgres') {
    dbUrl = await text({
      message: 'DATABASE_URL:',
      placeholder: 'postgresql://user:pass@db.example.com/dbname',
      validate: (v) => (v ? undefined : 'DATABASE_URL is required'),
    });
    if (isCancel(dbUrl)) {
      cancel('Deploy cancelled.');
      process.exit(0);
    }
  }

  const defaultName = `thunder-${Math.random().toString(36).slice(2, 7)}`;
  const appNameInput = await text({
    message: 'App name:',
    placeholder: defaultName,
    defaultValue: defaultName,
  });

  if (isCancel(appNameInput)) {
    cancel('Deploy cancelled.');
    process.exit(0);
  }

  const appName = appNameInput || defaultName;

  const deployDir = path.join(process.cwd(), '.thunderdeploy');
  fs.mkdirSync(deployDir, { recursive: true });
  fs.writeFileSync(path.join(deployDir, 'deployment.yaml'), getDeploymentYamlContent(), 'utf8');
  fs.writeFileSync(path.join(deployDir, 'entrypoint.sh'), getEntrypointContent(), 'utf8');

  const dockerfilePath = path.join(process.cwd(), 'Dockerfile');
  if (fs.existsSync(dockerfilePath)) {
    note('Existing Dockerfile found — it will be overwritten.', 'Warning');
  }
  fs.writeFileSync(dockerfilePath, getDockerfileContent(version), 'utf8');

  try {
    await recipe.deploy({ appName, dbType, dbUrl, thunderVersion: version });
  } catch (err) {
    process.stderr.write(`\n${colors.red('Deploy failed:')} ${err.message}\n`);
    process.exit(1);
  }

  outro(colors.green(`ThunderID v${version} deployed as ${colors.bold(appName)}`));
}

module.exports = { deploy };
