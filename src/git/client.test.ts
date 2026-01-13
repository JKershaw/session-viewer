import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseGitCommand, parseGitLogOutput } from './client.js';

describe('Git Client', () => {
  describe('parseGitCommand', () => {
    it('parses git commit with message', () => {
      const result = parseGitCommand('git commit -m "Fix authentication bug"');
      assert.strictEqual(result.type, 'commit');
      assert.strictEqual(result.message, 'Fix authentication bug');
    });

    it('parses git push with branch', () => {
      const result = parseGitCommand('git push origin main');
      assert.strictEqual(result.type, 'push');
      assert.strictEqual(result.branch, 'main');
    });

    it('parses git push with -u flag', () => {
      const result = parseGitCommand('git push -u origin feature/auth');
      assert.strictEqual(result.type, 'push');
      assert.strictEqual(result.branch, 'feature/auth');
    });

    it('parses git checkout with branch', () => {
      const result = parseGitCommand('git checkout -b new-feature');
      assert.strictEqual(result.type, 'checkout');
      assert.strictEqual(result.branch, 'new-feature');
    });

    it('parses git pull', () => {
      const result = parseGitCommand('git pull origin main');
      assert.strictEqual(result.type, 'pull');
      assert.strictEqual(result.branch, 'main');
    });

    it('parses git merge', () => {
      const result = parseGitCommand('git merge feature-branch');
      assert.strictEqual(result.type, 'merge');
      assert.strictEqual(result.branch, 'feature-branch');
    });

    it('extracts commit hash', () => {
      const result = parseGitCommand('git show abc1234');
      assert.strictEqual(result.commitHash, 'abc1234');
    });

    it('extracts full commit hash', () => {
      const result = parseGitCommand('git cherry-pick abc1234567890abcdef1234567890abcdef12345');
      assert.strictEqual(result.commitHash, 'abc1234567890abcdef1234567890abcdef12345');
    });

    it('identifies git add', () => {
      const result = parseGitCommand('git add .');
      assert.strictEqual(result.type, 'add');
    });

    it('identifies git reset', () => {
      const result = parseGitCommand('git reset --hard HEAD~1');
      assert.strictEqual(result.type, 'reset');
    });

    it('identifies git stash', () => {
      const result = parseGitCommand('git stash pop');
      assert.strictEqual(result.type, 'stash');
    });

    it('identifies git fetch', () => {
      const result = parseGitCommand('git fetch origin');
      assert.strictEqual(result.type, 'fetch');
    });

    it('handles unknown git commands', () => {
      const result = parseGitCommand('git bisect start');
      assert.strictEqual(result.type, 'other');
    });

    it('preserves original command', () => {
      const cmd = 'git commit -m "test" --no-verify';
      const result = parseGitCommand(cmd);
      assert.strictEqual(result.command, cmd);
    });
  });

  describe('parseGitLogOutput', () => {
    it('parses single commit', () => {
      const output = 'abc123def|abc123d|Fix bug|John Doe|2024-01-15T10:30:00Z|HEAD -> main';
      const commits = parseGitLogOutput(output);

      assert.strictEqual(commits.length, 1);
      assert.strictEqual(commits[0].hash, 'abc123def');
      assert.strictEqual(commits[0].shortHash, 'abc123d');
      assert.strictEqual(commits[0].message, 'Fix bug');
      assert.strictEqual(commits[0].author, 'John Doe');
      assert.strictEqual(commits[0].timestamp, '2024-01-15T10:30:00Z');
      assert.strictEqual(commits[0].branch, 'main');
    });

    it('parses multiple commits', () => {
      const output = `abc123|abc123|First commit|Author1|2024-01-15T10:00:00Z|main
def456|def456|Second commit|Author2|2024-01-15T11:00:00Z|`;
      const commits = parseGitLogOutput(output);

      assert.strictEqual(commits.length, 2);
      assert.strictEqual(commits[0].message, 'First commit');
      assert.strictEqual(commits[1].message, 'Second commit');
    });

    it('handles commits without branch ref', () => {
      const output = 'abc123|abc|Message|Author|2024-01-15T10:00:00Z|';
      const commits = parseGitLogOutput(output);

      assert.strictEqual(commits.length, 1);
      assert.strictEqual(commits[0].branch, null);
    });

    it('handles empty output', () => {
      const commits = parseGitLogOutput('');
      assert.deepStrictEqual(commits, []);
    });

    it('handles whitespace-only output', () => {
      const commits = parseGitLogOutput('   \n  \n  ');
      assert.deepStrictEqual(commits, []);
    });

    it('extracts branch from origin refs', () => {
      const output = 'abc123|abc|Msg|Auth|2024-01-15T10:00:00Z|origin/feature';
      const commits = parseGitLogOutput(output);

      assert.strictEqual(commits[0].branch, 'origin/feature');
    });
  });
});
