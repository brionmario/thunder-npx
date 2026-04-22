'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = path.join(os.homedir(), '.thunderid');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

function normalizeState(rawState) {
  if (!rawState) {
    return { installs: {}, lastUsedVersion: null };
  }

  // New format
  if (rawState.installs && typeof rawState.installs === 'object') {
    return {
      installs: rawState.installs,
      lastUsedVersion: rawState.lastUsedVersion || null,
    };
  }

  // Backward-compatible migration from legacy single-version format
  if (rawState.version && rawState.installPath) {
    return {
      installs: {
        [rawState.version]: {
          installPath: rawState.installPath,
          setupComplete: Boolean(rawState.setupComplete),
          installedAt: rawState.installedAt || new Date().toISOString(),
        },
      },
      lastUsedVersion: rawState.version,
    };
  }

  return { installs: {}, lastUsedVersion: null };
}

function readState() {
  try {
    const rawState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return normalizeState(rawState);
  } catch {
    return normalizeState(null);
  }
}

function writeState(version, installPath, setupComplete = false) {
  const currentState = readState();
  const nextState = {
    installs: {
      ...currentState.installs,
      [version]: {
        installPath,
        setupComplete,
        installedAt: currentState.installs[version]?.installedAt || new Date().toISOString(),
      },
    },
    lastUsedVersion: version,
  };

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(nextState, null, 2)
  );
}

function markSetupComplete(version) {
  const currentState = readState();
  const versionEntry = currentState.installs[version];

  if (!versionEntry) {
    return;
  }

  const nextState = {
    installs: {
      ...currentState.installs,
      [version]: {
        ...versionEntry,
        setupComplete: true,
      },
    },
    lastUsedVersion: version,
  };

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(nextState, null, 2)
  );
}

module.exports = { readState, writeState, markSetupComplete, STATE_DIR };
