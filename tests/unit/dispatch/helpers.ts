import type { DispatchQueueItem, ClaimedPrompt } from '../../../src/types/index.js';

// Matches LinearViewer API format
// See: https://github.com/JKershaw/LinearViewer/blob/main/docs/dispatch-integration.md
export const createTestQueueItem = (overrides: Partial<DispatchQueueItem> = {}): DispatchQueueItem => ({
  id: 'test-item-1',
  prompt: 'Test prompt text',
  promptName: 'Test Task',
  issueId: 'issue-1',
  issueIdentifier: 'ENG-123',
  issueTitle: 'Test Issue',
  issueUrl: 'https://linear.app/team/issue/ENG-123',
  workspace: { urlKey: 'test-workspace' },
  dispatchedAt: '2024-01-01T00:00:00Z',
  dispatchedBy: 'test-user',
  expiresAt: '2024-01-02T00:00:00Z',
  ...overrides
});

export const createTestClaimedPrompt = (overrides: Partial<ClaimedPrompt> = {}): ClaimedPrompt => ({
  id: 'claimed-1',
  prompt: 'Test prompt',
  promptName: 'Test Task',
  issueId: 'issue-1',
  issueIdentifier: 'ENG-123',
  issueTitle: 'Test Issue',
  issueUrl: 'https://linear.app/team/issue/ENG-123',
  workspaceUrlKey: 'test-workspace',
  claimedAt: '2024-01-01T10:00:00Z',
  ...overrides
});
