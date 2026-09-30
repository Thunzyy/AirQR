import type { ServerSessionResponse } from '../services/scanSyncService';

export function shouldDeleteRemoteIncompleteSession(
  session: ServerSessionResponse | null
): boolean {
  if (!session) {
    return false;
  }

  return !(session.completed || session.status === 'complete');
}
