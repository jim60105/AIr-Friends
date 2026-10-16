// tests/helpers/recording-workspace-manager.ts
//
// A WorkspaceManager that records temporary-use acquire/release calls, so tests
// can assert EXACTLY-ONCE ownership per producing entrypoint instead of only the
// final refcount (a duplicate release is deliberately ignored by the manager, so
// a zero count alone cannot prove the release happened once).

import { WorkspaceManager } from "@core/workspace-manager.ts";
import type {
  WorkspaceTmpCleanupOptions,
  WorkspaceTmpCleanupOutcome,
} from "@core/workspace-manager.ts";

export class RecordingWorkspaceManager extends WorkspaceManager {
  /** Every `acquireTmpUse` call, in order, including unmatched duplicates. */
  readonly acquired: string[] = [];
  /** Every `releaseTmpUse` call, in order, including unmatched duplicates. */
  readonly released: string[] = [];

  override acquireTmpUse(tmpPath: string): void {
    this.acquired.push(tmpPath);
    super.acquireTmpUse(tmpPath);
  }

  override releaseTmpUse(
    tmpPath: string,
    options?: WorkspaceTmpCleanupOptions,
  ): WorkspaceTmpCleanupOutcome | null {
    this.released.push(tmpPath);
    return super.releaseTmpUse(tmpPath, options);
  }
}
