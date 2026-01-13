import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  timestamp: string;
  branch: string | null;
}

export interface GitOperation {
  type: 'commit' | 'push' | 'pull' | 'checkout' | 'merge' | 'rebase' | 'fetch' | 'add' | 'reset' | 'stash' | 'other';
  command: string;
  commitHash?: string;
  branch?: string;
  message?: string;
}

/**
 * Parses a git command string to extract operation details
 */
export const parseGitCommand = (command: string): GitOperation => {
  const normalizedCmd = command.trim();

  // Extract operation type
  const operationMatch = normalizedCmd.match(/\bgit\s+([a-z-]+)/i);
  const operationType = operationMatch ? operationMatch[1].toLowerCase() : 'other';

  const result: GitOperation = {
    type: mapOperationType(operationType),
    command: normalizedCmd
  };

  // Extract commit hash if present (7-40 hex characters)
  const hashMatch = normalizedCmd.match(/(?:^|\s)([a-f0-9]{7,40})(?:\s|$)/i);
  if (hashMatch) {
    result.commitHash = hashMatch[1];
  }

  // Extract branch name for checkout/push/pull
  if (['checkout', 'push', 'pull', 'merge', 'rebase'].includes(result.type)) {
    const branchMatch = normalizedCmd.match(/(?:checkout|push|pull|merge|rebase)\s+(?:-[a-z]+\s+)*(?:origin\s+)?([a-zA-Z0-9_/-]+)/i);
    if (branchMatch && !branchMatch[1].startsWith('-')) {
      result.branch = branchMatch[1];
    }
  }

  // Extract commit message
  if (result.type === 'commit') {
    const messageMatch = normalizedCmd.match(/-m\s+["']([^"']+)["']/);
    if (messageMatch) {
      result.message = messageMatch[1];
    }
  }

  return result;
};

const mapOperationType = (op: string): GitOperation['type'] => {
  const typeMap: Record<string, GitOperation['type']> = {
    commit: 'commit',
    push: 'push',
    pull: 'pull',
    checkout: 'checkout',
    merge: 'merge',
    rebase: 'rebase',
    fetch: 'fetch',
    add: 'add',
    reset: 'reset',
    stash: 'stash'
  };
  return typeMap[op] ?? 'other';
};

/**
 * Gets git log from a repository directory
 */
export const getGitLog = async (
  repoPath: string,
  options: { limit?: number; branch?: string; since?: string } = {}
): Promise<GitCommit[]> => {
  const { limit = 50, branch, since } = options;

  const args = [
    'log',
    `--max-count=${limit}`,
    '--format=%H|%h|%s|%an|%aI|%D',
    '--all'
  ];

  if (branch) {
    args.push(branch);
  }

  if (since) {
    args.push(`--since="${since}"`);
  }

  try {
    const { stdout } = await execAsync(`git ${args.join(' ')}`, {
      cwd: repoPath,
      maxBuffer: 1024 * 1024 // 1MB buffer
    });

    return parseGitLogOutput(stdout);
  } catch (error) {
    // Repository might not exist or not be a git repo
    return [];
  }
};

/**
 * Parses git log output into structured commits
 */
export const parseGitLogOutput = (output: string): GitCommit[] => {
  if (!output.trim()) return [];

  return output
    .trim()
    .split('\n')
    .map((line) => {
      const [hash, shortHash, message, author, timestamp, refs] = line.split('|');

      // Extract branch from refs (e.g., "HEAD -> main, origin/main")
      let branch: string | null = null;
      if (refs) {
        const branchMatch = refs.match(/(?:HEAD\s*->\s*)?([a-zA-Z0-9_/-]+)/);
        if (branchMatch) {
          branch = branchMatch[1];
        }
      }

      return {
        hash,
        shortHash,
        message,
        author,
        timestamp,
        branch
      };
    })
    .filter((c) => c.hash); // Filter out any empty entries
};

/**
 * Gets the current branch of a repository
 */
export const getCurrentBranch = async (repoPath: string): Promise<string | null> => {
  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

/**
 * Finds commits matching a pattern (hash prefix, message, or author)
 */
export const findCommits = async (
  repoPath: string,
  pattern: string
): Promise<GitCommit[]> => {
  // Try to find by hash first
  if (/^[a-f0-9]{4,40}$/i.test(pattern)) {
    try {
      const { stdout } = await execAsync(
        `git log -1 --format=%H|%h|%s|%an|%aI|%D ${pattern}`,
        { cwd: repoPath }
      );
      const commits = parseGitLogOutput(stdout);
      if (commits.length > 0) return commits;
    } catch {
      // Not a valid hash
    }
  }

  // Search by message
  try {
    const { stdout } = await execAsync(
      `git log --max-count=10 --format=%H|%h|%s|%an|%aI|%D --grep="${pattern.replace(/"/g, '\\"')}"`,
      { cwd: repoPath }
    );
    return parseGitLogOutput(stdout);
  } catch {
    return [];
  }
};

/**
 * Correlates session git operations with actual repository commits
 */
export const correlateGitOperations = async (
  repoPath: string,
  operations: GitOperation[],
  sessionTimeRange: { start: string; end: string }
): Promise<Map<GitOperation, GitCommit | null>> => {
  const correlations = new Map<GitOperation, GitCommit | null>();

  // Get commits from the session time range
  const commits = await getGitLog(repoPath, {
    since: sessionTimeRange.start,
    limit: 100
  });

  for (const op of operations) {
    let matchedCommit: GitCommit | null = null;

    if (op.type === 'commit') {
      // Try to match by commit message
      if (op.message) {
        matchedCommit = commits.find((c) =>
          c.message.toLowerCase().includes(op.message!.toLowerCase())
        ) ?? null;
      }
    } else if (op.commitHash) {
      // Try to match by hash
      matchedCommit = commits.find((c) =>
        c.hash.startsWith(op.commitHash!) || c.shortHash === op.commitHash
      ) ?? null;
    }

    correlations.set(op, matchedCommit);
  }

  return correlations;
};

/**
 * Extracts repository path from a session folder
 */
export const getRepoPath = (sessionFolder: string): string => {
  // The session folder should be the repo path
  return sessionFolder;
};
