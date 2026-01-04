#!/usr/bin/env node
/**
 * borg-anchor CLI
 * Borg backups with Bitcoin timestamping
 * https://solid-live.github.io/borg-anchor/
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { createServer } from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = '.borg-anchor.json';
const GLOBAL_CONFIG_DIR = resolve(homedir(), '.borg-anchor');
const PROJECTS_FILE = resolve(GLOBAL_CONFIG_DIR, 'projects.json');
const VERSION = '0.0.7';

// ============================================
// Global Project Registry
// ============================================

function loadProjects() {
  if (!existsSync(PROJECTS_FILE)) return [];
  try {
    const data = JSON.parse(readFileSync(PROJECTS_FILE, 'utf8'));
    return data.projects || [];
  } catch {
    return [];
  }
}

function saveProjects(projects) {
  if (!existsSync(GLOBAL_CONFIG_DIR)) {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  }
  writeFileSync(PROJECTS_FILE, JSON.stringify({ projects }, null, 2) + '\n');
}

function registerProject(name, path, repo) {
  const projects = loadProjects();

  // Check if already registered
  const existing = projects.findIndex(p => p.path === path);
  if (existing >= 0) {
    // Update existing
    projects[existing] = { name, path, repo, updated: new Date().toISOString() };
  } else {
    // Add new
    projects.push({ name, path, repo, added: new Date().toISOString() });
  }

  saveProjects(projects);
}

function unregisterProject(path) {
  const projects = loadProjects().filter(p => p.path !== path);
  saveProjects(projects);
}

// ============================================
// Local Config Management
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

function getArchiveSource(repo, archive) {
  const output = borgExec(`info ${repo}::${archive}`);
  const match = output.match(/Command line:.*::\S+\s+(.+)/);
  return match ? match[1].trim() : null;
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

  // Register in global project list
  const projectName = options.name || basename(dir);
  registerProject(projectName, dir, fullRepoPath);
  console.log(`  ✓ Registered in ~/.borg-anchor/projects.json`);

  console.log(`
  Done! Next steps:

    cd ${dir}
    git config nostr.privkey <your-hex-key>
    borg-anchor backup <source> --name my-backup
`);
}

function backup(sourcePath, destPath, options = {}) {
  let config, dir;

  if (destPath) {
    // Destination specified - look for config there
    dir = resolve(process.cwd(), destPath);
    config = loadConfig(dir);
    if (!config) {
      console.error(`Error: No config found in ${dir}. Run "borg-anchor init ${destPath}" first.`);
      process.exit(1);
    }
  } else {
    // No destination - look in current directory
    const found = findConfig();
    config = found.config;
    dir = found.dir;
    if (!config) {
      console.error('Error: No config found. Run "borg-anchor init" first.');
      process.exit(1);
    }
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

function getConfigFromPath(path) {
  let config, dir;
  if (path) {
    dir = resolve(process.cwd(), path);
    config = loadConfig(dir);
    if (!config) {
      console.error(`Error: No config found in ${dir}. Run "borg-anchor init ${path}" first.`);
      process.exit(1);
    }
  } else {
    const found = findConfig();
    config = found.config;
    dir = found.dir;
    if (!config) {
      console.error('Error: No config found. Run "borg-anchor init" first.');
      process.exit(1);
    }
  }
  return { config, dir };
}

function list(path) {
  const { config, dir } = getConfigFromPath(path);

  console.log('\n  Borg Archives');
  console.log('  ' + '─'.repeat(56));

  const archives = listArchives(config.repo);
  for (const { archive, time } of archives) {
    const fingerprint = getArchiveFingerprint(config.repo, archive);
    const source = getArchiveSource(config.repo, archive);
    console.log(`\n  ${archive}`);
    console.log(`    Source: ${source}`);
    console.log(`    Time: ${time}`);
    console.log(`    Fingerprint: ${fingerprint}`);
  }

  console.log('\n\n  Blocktrail Status');
  console.log('  ' + '─'.repeat(56));
  console.log(getTrailStatus(dir));
}

function verify(archiveName, path) {
  const { config, dir } = getConfigFromPath(path);

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

function restore(archiveName, destPath, repoPath) {
  const { config } = getConfigFromPath(repoPath);

  const dest = resolve(process.cwd(), destPath || '.');

  // Create destination if it doesn't exist
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  console.log(`\n  Restoring ${archiveName} to ${dest}\n`);

  execSync(`cd ${dest} && borg extract ${config.repo}::${archiveName}`, { stdio: 'inherit' });
  console.log('\n  ✓ Restore complete!\n');
}

function show(path) {
  const { config, dir } = getConfigFromPath(path);

  console.log('\n  Config');
  console.log('  ' + '─'.repeat(56));
  console.log(`  Repo: ${config.repo}`);
  console.log(`  Network: ${config.network}`);
  console.log(`  Created: ${config.created}`);
  console.log('\n  Trail Status');
  console.log('  ' + '─'.repeat(56));
  console.log(getTrailStatus(dir));
}

function loadTrail(dir) {
  const trailPath = resolve(dir, '.blocktrail.json');
  if (!existsSync(trailPath)) return null;
  try {
    return JSON.parse(readFileSync(trailPath, 'utf8'));
  } catch {
    return null;
  }
}

function findAnchorState(trail, fingerprint) {
  if (!trail?.states) return -1;
  for (let i = 0; i < trail.states.length; i++) {
    try {
      const state = JSON.parse(trail.states[i]);
      if (state.fingerprint === fingerprint) return i;
    } catch {
      continue;
    }
  }
  return -1;
}

function info() {
  const projects = loadProjects();

  if (projects.length === 0) {
    console.log('\n  No projects registered.');
    console.log('  Run "borg-anchor init <path>" to create one.\n');
    return;
  }

  console.log('\n  ╭─────────────────────────────────────────────────────────────╮');
  console.log('  │  borg-anchor                                                │');
  console.log('  ╰─────────────────────────────────────────────────────────────╯\n');

  let totalArchives = 0;
  let totalAnchored = 0;

  for (const project of projects) {
    const config = loadConfig(project.path);
    if (!config) {
      console.log(`  ${project.name.toUpperCase()} (${project.path})`);
      console.log('  ⚠ Config not found\n');
      continue;
    }

    const trail = loadTrail(project.path);
    let archives = [];

    try {
      archives = listArchives(config.repo);
    } catch (err) {
      console.log(`  ${project.name.toUpperCase()} (${project.path})`);
      console.log(`  ⚠ Cannot access repo: ${config.repo}\n`);
      continue;
    }

    console.log(`  ${project.name.toUpperCase()} (${project.path})`);
    console.log('  ' + '─'.repeat(60));

    if (archives.length === 0) {
      console.log('  No archives yet.\n');
      continue;
    }

    // Display header
    console.log('  Archive                    Fingerprint      Source              Anchored');
    console.log('  ' + '─'.repeat(60));

    for (const { archive, time } of archives) {
      let fingerprint, source, stateIndex;

      try {
        fingerprint = getArchiveFingerprint(config.repo, archive);
        source = getArchiveSource(config.repo, archive) || '';
      } catch {
        fingerprint = '?';
        source = '?';
      }

      stateIndex = findAnchorState(trail, fingerprint);
      const anchored = stateIndex >= 0 ? `✓ #${stateIndex}` : '  -';

      // Truncate for display
      const archiveDisplay = archive.slice(0, 24).padEnd(24);
      const fpDisplay = fingerprint ? fingerprint.slice(0, 12) + '...' : '?';
      const sourceDisplay = source.slice(-18).padEnd(18);

      console.log(`  ${archiveDisplay} ${fpDisplay}   ${sourceDisplay} ${anchored}`);

      totalArchives++;
      if (stateIndex >= 0) totalAnchored++;
    }

    console.log('');
  }

  console.log('  ' + '─'.repeat(60));
  console.log(`  ${projects.length} project(s) · ${totalArchives} archive(s) · ${totalAnchored} anchored\n`);
}

function gatherDashboardData() {
  const projects = loadProjects();
  const data = { projects: [], totals: { archives: 0, anchored: 0 } };

  for (const project of projects) {
    const projectData = {
      name: project.name,
      path: project.path,
      repo: project.repo,
      archives: [],
      error: null
    };

    const config = loadConfig(project.path);
    if (!config) {
      projectData.error = 'Config not found';
      data.projects.push(projectData);
      continue;
    }

    const trail = loadTrail(project.path);

    try {
      const archives = listArchives(config.repo);
      for (const { archive, time } of archives) {
        let fingerprint, source, stateIndex;
        try {
          fingerprint = getArchiveFingerprint(config.repo, archive);
          source = getArchiveSource(config.repo, archive) || '';
        } catch {
          fingerprint = null;
          source = '';
        }
        stateIndex = findAnchorState(trail, fingerprint);

        projectData.archives.push({
          name: archive,
          time,
          fingerprint,
          source,
          anchored: stateIndex >= 0,
          stateIndex
        });

        data.totals.archives++;
        if (stateIndex >= 0) data.totals.anchored++;
      }
    } catch (err) {
      projectData.error = `Cannot access repo: ${config.repo}`;
    }

    data.projects.push(projectData);
  }

  return data;
}

function getDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>borg-anchor dashboard</title>
  <style>
    :root {
      --bg: #0d1117;
      --card: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --muted: #8b949e;
      --accent: #58a6ff;
      --success: #3fb950;
      --warning: #d29922;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }
    h1 { font-size: 1.5rem; font-weight: 600; }
    .stats {
      display: flex;
      gap: 2rem;
      color: var(--muted);
    }
    .stats span { color: var(--text); font-weight: 600; }
    .project {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 1.5rem;
      overflow: hidden;
    }
    .project-header {
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .project-name { font-weight: 600; font-size: 1.1rem; }
    .project-path { color: var(--muted); font-size: 0.85rem; }
    .project-error {
      padding: 1rem 1.5rem;
      color: var(--warning);
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 0.75rem 1.5rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      color: var(--muted);
      font-weight: 500;
      font-size: 0.85rem;
      text-transform: uppercase;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover { background: rgba(255,255,255,0.02); }
    .fingerprint {
      font-family: monospace;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .anchored {
      color: var(--success);
      font-weight: 600;
    }
    .not-anchored {
      color: var(--muted);
    }
    .refresh-btn {
      background: var(--accent);
      color: #fff;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .refresh-btn:hover { opacity: 0.9; }
    .empty {
      padding: 2rem;
      text-align: center;
      color: var(--muted);
    }
    .time { color: var(--muted); font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>borg-anchor</h1>
      </div>
      <div class="stats">
        <div><span id="project-count">-</span> projects</div>
        <div><span id="archive-count">-</span> archives</div>
        <div><span id="anchored-count">-</span> anchored</div>
        <button class="refresh-btn" onclick="refresh()">Refresh</button>
      </div>
    </header>
    <main id="projects"></main>
  </div>
  <script>
    async function refresh() {
      const res = await fetch('/api/data');
      const data = await res.json();

      document.getElementById('project-count').textContent = data.projects.length;
      document.getElementById('archive-count').textContent = data.totals.archives;
      document.getElementById('anchored-count').textContent = data.totals.anchored;

      const main = document.getElementById('projects');

      if (data.projects.length === 0) {
        main.innerHTML = '<div class="empty">No projects registered. Run <code>borg-anchor init</code> to create one.</div>';
        return;
      }

      main.innerHTML = data.projects.map(p => {
        if (p.error) {
          return \`<div class="project">
            <div class="project-header">
              <div>
                <div class="project-name">\${p.name}</div>
                <div class="project-path">\${p.path}</div>
              </div>
            </div>
            <div class="project-error">⚠ \${p.error}</div>
          </div>\`;
        }

        if (p.archives.length === 0) {
          return \`<div class="project">
            <div class="project-header">
              <div>
                <div class="project-name">\${p.name}</div>
                <div class="project-path">\${p.path}</div>
              </div>
            </div>
            <div class="empty">No archives yet</div>
          </div>\`;
        }

        return \`<div class="project">
          <div class="project-header">
            <div>
              <div class="project-name">\${p.name}</div>
              <div class="project-path">\${p.path}</div>
            </div>
            <div class="project-path">\${p.archives.length} archive(s)</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Archive</th>
                <th>Time</th>
                <th>Fingerprint</th>
                <th>Source</th>
                <th>Anchored</th>
              </tr>
            </thead>
            <tbody>
              \${p.archives.map(a => \`<tr>
                <td>\${a.name}</td>
                <td class="time">\${a.time}</td>
                <td class="fingerprint">\${a.fingerprint ? a.fingerprint.slice(0, 16) + '...' : '-'}</td>
                <td class="fingerprint">\${a.source.split('/').slice(-2).join('/')}</td>
                <td class="\${a.anchored ? 'anchored' : 'not-anchored'}">\${a.anchored ? '✓ #' + a.stateIndex : '-'}</td>
              </tr>\`).join('')}
            </tbody>
          </table>
        </div>\`;
      }).join('');
    }

    refresh();
  </script>
</body>
</html>`;
}

function dashboard(options = {}) {
  const port = options.port || 3077;

  const server = createServer((req, res) => {
    if (req.url === '/api/data') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(gatherDashboardData()));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getDashboardHtml());
    }
  });

  server.listen(port, () => {
    console.log(`\n  borg-anchor dashboard running at http://localhost:${port}\n`);
    console.log('  Press Ctrl+C to stop\n');

    // Try to open in browser
    try {
      const openCmd = process.platform === 'darwin' ? 'open' :
                      process.platform === 'win32' ? 'start' : 'xdg-open';
      execSync(`${openCmd} http://localhost:${port}`, { stdio: 'ignore' });
    } catch {
      // Browser open failed, that's ok
    }
  });
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
    info                                 Dashboard of all projects (CLI)
    dashboard                            Web dashboard (localhost:3077)
    init [path]                          Set up a backup folder
    backup <source> [dest]               Back up a folder
    list [path]                          List backups
    verify <archive> [path]              Verify backup is anchored
    restore <archive> [dest] [path]      Restore a backup
    show [path]                          Show project config

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
      case 'info':
        info();
        break;
      case 'dashboard':
        dashboard(options);
        break;
      case 'init':
        init(_[1], options);
        break;
      case 'backup':
        if (!_[1]) {
          console.error('Usage: borg-anchor backup <source> [destination] [--name <name>]');
          process.exit(1);
        }
        backup(_[1], _[2], options);
        break;
      case 'list':
        list(_[1]);
        break;
      case 'verify':
        if (!_[1]) {
          console.error('Usage: borg-anchor verify <archive> [backup-folder]');
          process.exit(1);
        }
        verify(_[1], _[2]);
        break;
      case 'restore':
        if (!_[1]) {
          console.error('Usage: borg-anchor restore <archive> [dest] [backup-folder]');
          process.exit(1);
        }
        restore(_[1], _[2], _[3]);
        break;
      case 'show':
        show(_[1]);
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
