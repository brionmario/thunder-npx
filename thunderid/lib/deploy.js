'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');
const { intro, outro, select, text, confirm, spinner, note, isCancel, cancel } = require('@clack/prompts');
const colors = require('picocolors');
const { getLatestThunderVersion } = require('./download');
const { loadRecipes } = require('../recipes/index');

function getDockerfileContent(version) {
  const dirName = `thunder-${version}-linux-x64`;
  return `FROM alpine:3.19
RUN apk add --no-cache sqlite openssl ca-certificates bash curl unzip

RUN mkdir -p /app \\
    && curl -fsSL -o /tmp/thunder.zip \\
       "https://github.com/asgardeo/thunder/releases/download/v${version}/${dirName}.zip" \\
    && unzip /tmp/thunder.zip -d /app \\
    && rm /tmp/thunder.zip

WORKDIR /app/${dirName}

RUN find . -name "deployment.yaml" -exec sed -i 's/127\\.0\\.0\\.1/0.0.0.0/g' {} \\; 2>/dev/null || true \\
    && find . -name "deployment.yaml" -exec sed -i 's/localhost/0.0.0.0/g' {} \\; 2>/dev/null || true

RUN addgroup -S thunder && adduser -S thunder -G thunder \\
    && THUNDER_SKIP_SECURITY=true bash setup.sh \\
    && chown -R thunder:thunder .

USER thunder
EXPOSE 8090
CMD ["bash", "start.sh"]
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

  const s = spinner();
  s.start('Fetching latest Thunder release...');
  let version;
  try {
    version = await getLatestThunderVersion();
    s.stop(`Thunder v${version}`);
  } catch (err) {
    s.stop('Could not fetch latest Thunder release.');
    process.stderr.write(`\nError: ${err.message}\n`);
    process.exit(1);
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
