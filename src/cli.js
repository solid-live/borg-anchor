#!/usr/bin/env node
/**
 * borg-anchor CLI
 * Borg backups with Bitcoin timestamping
 * https://solid-live.github.io/borg-anchor/
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = '.borg-anchor.json';
const VERSION = '0.0.3';

// ============================================
// Config Management
// ============================================

function loadConfig(dir = process.cwd()) {
  const configPath = resolve(dir, CONFIG_FILE);
  if (!existsSync(configPath)) return null;
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

function saveConfig(config, dir = process.cwd()) {
  const configPath = resolve(dir, CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function findConfig() {
  let dir = process.cwd();
  while (dir !== '/') {
    if (existsSync(resolve(dir, CONFIG_FILE))) {
      return { config: loadConfig(dir), dir };
    }
    dir = dirname(dir);
  }
  return { config: null, dir: null };
}

// ============================================
// Borg Helpers
// ============================================

function borgExec(args, options = {}) {
  const cmd = `borg ${args}`;
  try {
    return execSync(cmd, { encoding: 'utf8', ...options });
  } catch (err) {
    if (options.ignoreError) return err.stdout || '';
    throw err;
  }
}

function getArchiveFingerprint(repo, archive) {
  const output = borgExec(`info ${repo}::${archive}`);
  const match = output.match(/Archive fingerprint:\s*([a-f0-9]+)/);
  return match ? match[1] : null;
}

function listArchives(repo) {
  const output = borgExec(`list --format '{archive}{TAB}{time}{NL}' ${repo}`);
  return output.trim().split('\n').filter(Boolean).map(line => {
    const [archive, time] = line.split('\t');
    return { archive, time };
  });
}

// ============================================
// Blocktrails Integration
// ============================================

function findBlocktrailsCli() {
  const locations = [
    resolve(process.env.HOME, 'remote/github.com/blocktrails/blocktrails/src/cli.js'),
    resolve(process.env.HOME, '.local/bin/blocktrails'),
    '/usr/local/bin/blocktrails'
  ];
  for (const loc of locations) {
    if (existsSync(loc)) return loc;
  }
  return null;
}

function blocktrailsExec(args, cwd) {
  const cli = findBlocktrailsCli();
  if (!cli) {
    console.error('Error: blocktrails CLI not found');
    console.error('Install from: https://github.com/blocktrails/blocktrails');
    process.exit(1);
  }
  const cmd = `node ${cli} ${args}`;
  try {
    return execSync(cmd, { encoding: 'utf8', cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    return err.stdout || err.stderr || '';
  }
}

function anchorBackup(archive, fingerprint, cwd, dryRun = false) {
  const state = JSON.stringify({
    type: 'borg-backup',
    archive,
    fingerprint
  });
  const dryFlag = dryRun ? ' --dry' : '';
  return blocktrailsExec(`mark '${state}'${dryFlag}`, cwd);
}

function getTrailStatus(cwd) {
  return blocktrailsExec('show', cwd);
}

// ============================================
// Commands
// ============================================

function init(repoPath, options = {}) {
  const dir = resolve(process.cwd(), repoPath || '.');
  const repoName = options.repo || 'repo';
  const fullRepoPath = resolve(dir, repoName);
  const encryption = options.encryption || 'none';
  const network = options.network || 'tbtc4';

  console.log(`\n  Initializing borg-anchor in ${dir}\n`);

  // Create parent directory if needed
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Create borg repo
  if (!existsSync(fullRepoPath)) {
    console.log(`  Creating borg repo: ${fullRepoPath}`);
    borgExec(`init --encryption=${encryption} ${fullRepoPath}`);
    console.log('  ✓ Borg repository created');
  } else {
    console.log(`  ✓ Borg repo exists: ${fullRepoPath}`);
  }

  // Create config
  const config = {
    repo: fullRepoPath,
    network,
    created: new Date().toISOString()
  };
  saveConfig(config, dir);
  console.log(`  ✓ Config saved: ${CONFIG_FILE}`);

  // Initialize git if needed
  if (!existsSync(resolve(dir, '.git'))) {
    execSync('git init', { cwd: dir, stdio: 'pipe' });
    console.log('  ✓ Git initialized');
  }

  console.log(`
  Done! Next steps:

    cd ${dir}
    git config nostr.privkey <your-hex-key>
    borg-anchor backup <source> --name my-backup
`);
}

function backup(sourcePath, options = {}) {
  const { config, dir } = findConfig();
  if (!config) {
    console.error('Error: No config found. Run "borg-anchor init" first.');
    process.exit(1);
  }

  const source = resolve(process.cwd(), sourcePath);
  const name = options.name || `backup-${new Date().toISOString().slice(0, 10)}`;
  const repo = config.repo;

  console.log(`
  Creating backup: ${name}
  Source: ${source}
  Repo: ${repo}
`);

  // Create borg backup
  borgExec(`create --stats ${repo}::${name} ${source}`, { stdio: 'inherit' });

  // Get fingerprint
  const fingerprint = getArchiveFingerprint(repo, name);
  if (!fingerprint) {
    console.error('Error: Failed to get archive fingerprint');
    process.exit(1);
  }
  console.log(`\n  Fingerprint: ${fingerprint}`);

  // Anchor on Bitcoin
  if (!options.noAnchor) {
    console.log('\n  Anchoring on Bitcoin...');
    const anchorOutput = anchorBackup(name, fingerprint, dir, options.dry);
    console.log(anchorOutput);
  }

  console.log('  ✓ Backup complete!\n');
}

function list() {
  const { config, dir } = findConfig();
  if (!config) {
    console.error('Error: No config found. Run "borg-anchor init" first.');
    process.exit(1);
  }

  console.log('\n  Borg Archives');
  console.log('  ' + '─'.repeat(56));

  const archives = listArchives(config.repo);
  for (const { archive, time } of archives) {
    const fingerprint = getArchiveFingerprint(config.repo, archive);
    console.log(`\n  ${archive}`);
    console.log(`    Time: ${time}`);
    console.log(`    Fingerprint: ${fingerprint}`);
  }

  console.log('\n\n  Blocktrail Status');
  console.log('  ' + '─'.repeat(56));
  console.log(getTrailStatus(dir));
}

function verify(archiveName) {
  const { config, dir } = findConfig();
  if (!config) {
    console.error('Error: No config found. Run "borg-anchor init" first.');
    process.exit(1);
  }

  const fingerprint = getArchiveFingerprint(config.repo, archiveName);
  if (!fingerprint) {
    console.error(`Error: Archive not found: ${archiveName}`);
    process.exit(1);
  }

  console.log(`\n  Archive: ${archiveName}`);
  console.log(`  Fingerprint: ${fingerprint}`);

  // Check trail for matching state
  const trailPath = resolve(dir, '.blocktrail.json');
  if (!existsSync(trailPath)) {
    console.log('\n  ✗ No trail found. Backup not anchored.\n');
    return;
  }

  const trail = JSON.parse(readFileSync(trailPath, 'utf8'));
  let matchIndex = -1;

  for (let i = 0; i < (trail.states?.length || 0); i++) {
    try {
      const stateStr = trail.states[i];
      const state = typeof stateStr === 'string' ? JSON.parse(stateStr) : stateStr;
      if (state.fingerprint === fingerprint) {
        matchIndex = i;
        break;
      }
    } catch {
      continue;
    }
  }

  if (matchIndex >= 0) {
    console.log(`\n  ✓ Verified! Anchored on Bitcoin`);
    console.log(`    State index: ${matchIndex}`);
    console.log(`    Network: ${trail.network}\n`);
  } else {
    console.log('\n  ✗ Not found in trail. Backup may not be anchored.\n');
  }
}

function restore(archiveName, destPath) {
  const { config } = findConfig();
  if (!config) {
    console.error('Error: No config found. Run "borg-anchor init" first.');
    process.exit(1);
  }

  const dest = resolve(process.cwd(), destPath || '.');
  console.log(`\n  Restoring ${archiveName} to ${dest}\n`);

  execSync(`cd ${dest} && borg extract ${config.repo}::${archiveName}`, { stdio: 'inherit' });
  console.log('\n  ✓ Restore complete!\n');
}

function show() {
  const { config, dir } = findConfig();
  if (!config) {
    console.error('Error: No config found. Run "borg-anchor init" first.');
    process.exit(1);
  }

  console.log('\n  Config');
  console.log('  ' + '─'.repeat(56));
  console.log(`  Repo: ${config.repo}`);
  console.log(`  Network: ${config.network}`);
  console.log(`  Created: ${config.created}`);
  console.log('\n  Trail Status');
  console.log('  ' + '─'.repeat(56));
  console.log(getTrailStatus(dir));
}

// ============================================
// CLI Parser
// ============================================

function printHelp() {
  console.log(`
  borg-anchor v${VERSION}
  Borg backups with Bitcoin timestamping

  Usage:
    borg-anchor <command> [options]

  Commands:
    init [path]              Initialize borg repo and config
    backup <source>          Create backup and anchor on Bitcoin
    list                     List backups and trail status
    verify <archive>         Verify backup is anchored
    restore <archive> [dest] Restore backup to destination
    show                     Show config and trail status

  Init Options:
    --repo <name>            Repo directory name (default: repo)
    --encryption <type>      none, repokey, repokey-blake2 (default: none)
    --network <net>          btc, tbtc4 (default: tbtc4)

  Backup Options:
    --name <name>            Archive name (default: backup-YYYY-MM-DD)
    --no-anchor              Skip Bitcoin anchoring
    --dry                    Dry run (don't broadcast)

  Examples:
    borg-anchor init ~/backups
    borg-anchor backup ~/mydata --name daily
    borg-anchor list
    borg-anchor verify daily
    borg-anchor restore daily /tmp/restore

  More info: https://solid-live.github.io/borg-anchor/
`);
}

function parseArgs(args) {
  const result = { _: [], options: {} };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key === 'no-anchor') {
        result.options.noAnchor = true;
      } else if (key === 'dry') {
        result.options.dry = true;
      } else if (args[i + 1] && !args[i + 1].startsWith('-')) {
        result.options[key] = args[++i];
      } else {
        result.options[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        result.options[key] = args[++i];
      } else {
        result.options[key] = true;
      }
    } else {
      result._.push(arg);
    }
  }
  return result;
}

// ============================================
// Main
// ============================================

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
    printHelp();
    process.exit(0);
  }

  if (args[0] === '-v' || args[0] === '--version' || args[0] === 'version') {
    console.log(`borg-anchor v${VERSION}`);
    process.exit(0);
  }

  const { _, options } = parseArgs(args);
  const command = _[0];

  try {
    switch (command) {
      case 'init':
        init(_[1], options);
        break;
      case 'backup':
        if (!_[1]) {
          console.error('Usage: borg-anchor backup <source> [--name <name>]');
          process.exit(1);
        }
        backup(_[1], options);
        break;
      case 'list':
        list();
        break;
      case 'verify':
        if (!_[1]) {
          console.error('Usage: borg-anchor verify <archive>');
          process.exit(1);
        }
        verify(_[1]);
        break;
      case 'restore':
        if (!_[1]) {
          console.error('Usage: borg-anchor restore <archive> [dest]');
          process.exit(1);
        }
        restore(_[1], _[2]);
        break;
      case 'show':
        show();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error(`\n  Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
