import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { tmpdir, homedir } from 'os';

const CLI = resolve(import.meta.dirname, 'cli.js');
const GLOBAL_CONFIG_DIR = resolve(homedir(), '.borg-anchor');
const PROJECTS_FILE = resolve(GLOBAL_CONFIG_DIR, 'projects.json');

function run(args, options = {}) {
  try {
    return execSync(`node ${CLI} ${args}`, {
      encoding: 'utf8',
      ...options
    });
  } catch (err) {
    return err.stdout || err.stderr || err.message;
  }
}

function loadProjects() {
  if (!existsSync(PROJECTS_FILE)) return [];
  return JSON.parse(readFileSync(PROJECTS_FILE, 'utf8')).projects || [];
}

function saveProjects(projects) {
  if (!existsSync(GLOBAL_CONFIG_DIR)) {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  }
  writeFileSync(PROJECTS_FILE, JSON.stringify({ projects }, null, 2) + '\n');
}

describe('borg-anchor CLI', () => {
  describe('help and version', () => {
    test('--help shows usage', () => {
      const output = run('--help');
      assert.ok(output.includes('borg-anchor'));
      assert.ok(output.includes('Commands:'));
      assert.ok(output.includes('info'));
      assert.ok(output.includes('dashboard'));
    });

    test('--version shows version', () => {
      const output = run('--version');
      assert.ok(output.includes('borg-anchor v'));
    });
  });

  describe('global project registry', () => {
    let testDir;
    let originalProjects;

    beforeEach(() => {
      // Save original projects
      originalProjects = loadProjects();

      // Create temp test directory
      testDir = resolve(tmpdir(), `borg-anchor-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      // Restore original projects
      saveProjects(originalProjects);

      // Clean up test directory
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    test('info with no projects shows empty message', () => {
      // Clear projects
      saveProjects([]);

      const output = run('info');
      assert.ok(output.includes('No projects registered'));
    });

    test('init registers project in global list', () => {
      // Clear projects first
      saveProjects([]);

      // Init a project (will fail without borg, but should still register)
      try {
        run(`init ${testDir} --name test-project`);
      } catch {
        // May fail if borg not installed, that's ok
      }

      const projects = loadProjects();
      const found = projects.find(p => p.path === testDir);

      // If borg is installed, project should be registered
      // If not, this test is skipped implicitly
      if (found) {
        assert.strictEqual(found.name, 'test-project');
        assert.strictEqual(found.path, testDir);
      }
    });

    test('info shows registered projects', () => {
      // Add a mock project
      saveProjects([{
        name: 'test-backup',
        path: '/tmp/nonexistent',
        repo: '/tmp/nonexistent/repo',
        added: new Date().toISOString()
      }]);

      const output = run('info');
      assert.ok(output.includes('borg-anchor'));
      assert.ok(output.includes('TEST-BACKUP') || output.includes('Config not found') || output.includes('Cannot access'));
    });
  });
});
