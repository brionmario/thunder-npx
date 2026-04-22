#!/usr/bin/env node
/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { intro, outro, text, spinner, note, cancel, isCancel } = require('@clack/prompts');
const colors = require('picocolors');

const { readState, writeState, markSetupComplete, STATE_DIR } = require('../lib/state');
const { downloadAndExtract, getLatestThunderVersion } = require('../lib/download');
const { runSetup, runStart } = require('../lib/setup');

function parseCliArgs(argv) {
  let forceSetup = false;
  const forwardedArgs = [];

  for (const arg of argv) {
    if (arg === '--setup') {
      forceSetup = true;
      continue;
    }
    forwardedArgs.push(arg);
  }

  return { forceSetup, forwardedArgs };
}

async function main() {
  // eslint-disable-next-line no-console
  console.clear();

  const { forceSetup, forwardedArgs } = parseCliArgs(process.argv.slice(2));

  const s = spinner();
  s.start('Fetching latest Thunder release...');
  let VERSION;
  try {
    VERSION = await getLatestThunderVersion();
    s.stop(`Latest Thunder release: v${VERSION}`);
  } catch (err) {
    s.stop('Could not fetch latest Thunder release.');
    process.stderr.write(`\nError: ${err.message}\n`);
    process.exit(1);
  }

  const state = readState();
  const versionState = state.installs[VERSION];
  const alreadyInstalled = Boolean(versionState?.installPath && fs.existsSync(versionState.installPath));

  intro(
    `${
      colors.blueBright(
        `
  ████████╗██╗  ██╗██╗   ██╗███╗   ██╗██████╗ ███████╗██████╗ ██╗██████╗
  ╚══██╔══╝██║  ██║██║   ██║████╗  ██║██╔══██╗██╔════╝██╔══██╗██║██╔══██╗
    ██║   ███████║██║   ██║██╔██╗ ██║██║  ██║█████╗  ██████╔╝██║██║  ██║`,
      ) +
      colors.cyanBright(
        `
    ██║   ██╔══██║██║   ██║██║╚██╗██║██║  ██║██╔══╝  ██╔══██╗██║██║  ██║
    ██║   ██║  ██║╚██████╔╝██║ ╚████║██████╔╝███████╗██║  ██║██║██████╔╝
    ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝╚═════╝
`,
      )
    }\n` +
      `          ${colors.yellow('⚡')} ${colors.bold(colors.white(`ThunderID v${VERSION}`))}${colors.dim(
        colors.gray(' · The Go-based Lightweight Identity Server'),
      )}\n`,
  );

  let installPath;

  // Already installed and previously set up — skip setup, start directly
  if (alreadyInstalled && versionState.setupComplete && !forceSetup) {
    installPath = versionState.installPath;
    note(`ThunderID v${VERSION} is ready\n${installPath}`, 'Starting ThunderID');
    try {
      runStart(installPath, forwardedArgs);
    } catch (err) {
      process.stderr.write(`\nFailed to start ThunderID: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  if (alreadyInstalled) {
    installPath = versionState.installPath;
    if (forceSetup) {
      note(`Re-running setup for ThunderID v${VERSION}\n${installPath}`, 'Setup requested');
    } else {
      note(`Using ThunderID v${VERSION}\n${installPath}`, 'Already installed');
    }
  } else {
    const defaultPath = path.join(STATE_DIR, VERSION);

    const rawInstallPath = await text({
      message: 'Install directory',
      placeholder: defaultPath,
      defaultValue: defaultPath,
    });

    if (isCancel(rawInstallPath)) {
      cancel('Installation cancelled.');
      process.exit(0);
    }

    installPath = rawInstallPath || defaultPath;

    const s = spinner();
    s.start(`Downloading Thunder v${VERSION}...`);

    try {
      await downloadAndExtract(VERSION, installPath, (msg) => s.message(msg));
    } catch (err) {
      s.stop('Download failed.');
      process.stderr.write(`\nError: ${err.message}\n`);
      process.exit(1);
    }

    s.stop(`ThunderID v${VERSION} installed to ${installPath}`);
    writeState(VERSION, installPath);

    outro('Running ThunderID setup for the first time...');
  }

  try {
    runSetup(installPath, forwardedArgs);
    markSetupComplete(VERSION);
  } catch (err) {
    process.stderr.write(`\nSetup failed: ${err.message}\n`);
    process.exit(1);
  }

  note(`Setup complete for ThunderID v${VERSION}\n${installPath}`, 'Starting ThunderID');

  try {
    runStart(installPath, forwardedArgs);
  } catch (err) {
    process.stderr.write(`\nSetup succeeded but failed to start ThunderID: ${err.message}\n`);
    process.exit(1);
  }
}

main();
