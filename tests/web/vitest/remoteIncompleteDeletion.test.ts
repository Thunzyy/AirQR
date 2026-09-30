import { describe, expect, it } from 'vitest';

import { shouldDeleteRemoteIncompleteSession } from '@web/utils/remoteIncompleteDeletion';

describe('shouldDeleteRemoteIncompleteSession', () => {
  it('returns false when verification cannot confirm a remote session', () => {
    expect(shouldDeleteRemoteIncompleteSession(null)).toBe(false);
  });

  it('returns false for completed sessions', () => {
    expect(
      shouldDeleteRemoteIncompleteSession({
        sessionId: 'session-1',
        completed: true,
      })
    ).toBe(false);
    expect(
      shouldDeleteRemoteIncompleteSession({
        sessionId: 'session-2',
        status: 'complete',
      })
    ).toBe(false);
  });

  it('returns true only for verified incomplete sessions', () => {
    expect(
      shouldDeleteRemoteIncompleteSession({
        sessionId: 'session-3',
        completed: false,
        status: 'incomplete',
      })
    ).toBe(true);
  });
});
