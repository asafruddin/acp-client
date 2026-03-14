import * as vscode from "vscode";
import { PendingDiff, AcpFileChange } from "../types/protocol";

/**
 * Manages agent-suggested file changes. Converts AcpFileChange messages into
 * VS Code diff views and provides apply / reject operations.
 *
 * Uses a virtual-document scheme (`acp-diff`) so we can show proposed content
 * side-by-side with the original file without touching disk.
 */
export class DiffProvider implements vscode.Disposable {
  private static readonly SCHEME = "acp-diff";

  private pendingDiffs = new Map<string, PendingDiff>();
  private contentProvider: vscode.Disposable;

  private readonly _onDiffApplied = new vscode.EventEmitter<PendingDiff>();
  public readonly onDiffApplied = this._onDiffApplied.event;

  private readonly _onDiffRejected = new vscode.EventEmitter<PendingDiff>();
  public readonly onDiffRejected = this._onDiffRejected.event;

  constructor() {
    // Register a text document content provider for the virtual scheme.
    this.contentProvider = vscode.workspace.registerTextDocumentContentProvider(
      DiffProvider.SCHEME,
      {
        provideTextDocumentContent: (uri: vscode.Uri): string => {
          const diff = this.pendingDiffs.get(uri.path);
          return diff?.proposedContent ?? "";
        },
      },
    );
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Register a file change from the agent and return the PendingDiff. */
  addFileChange(change: AcpFileChange): PendingDiff {
    const diff: PendingDiff = {
      id: change.id,
      filePath: change.filePath,
      originalContent: change.originalContent,
      proposedContent: change.proposedContent,
      description: change.description,
      status: "pending",
    };
    this.pendingDiffs.set(diff.id, diff);
    return diff;
  }

  /** Open a VS Code diff editor showing original vs. proposed content. */
  async showDiff(diffId: string): Promise<void> {
    const diff = this.pendingDiffs.get(diffId);
    if (!diff) {
      vscode.window.showErrorMessage(`Diff ${diffId} not found.`);
      return;
    }

    const originalUri = vscode.Uri.file(diff.filePath);
    const proposedUri = vscode.Uri.parse(`${DiffProvider.SCHEME}:${diff.id}`);

    const title = `${this.basename(diff.filePath)} (Agent Suggestion)`;
    await vscode.commands.executeCommand(
      "vscode.diff",
      originalUri,
      proposedUri,
      title,
    );
  }

  /** Apply the proposed content to the actual file on disk. */
  async applyDiff(diffId: string): Promise<boolean> {
    const diff = this.pendingDiffs.get(diffId);
    if (!diff || diff.status !== "pending") {
      return false;
    }

    try {
      const uri = vscode.Uri.file(diff.filePath);
      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(
        uri,
        encoder.encode(diff.proposedContent),
      );
      diff.status = "applied";
      this._onDiffApplied.fire(diff);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to apply diff: ${msg}`);
      return false;
    }
  }

  /** Reject the proposed change. */
  rejectDiff(diffId: string): boolean {
    const diff = this.pendingDiffs.get(diffId);
    if (!diff || diff.status !== "pending") {
      return false;
    }
    diff.status = "rejected";
    this._onDiffRejected.fire(diff);
    return true;
  }

  getDiff(diffId: string): PendingDiff | undefined {
    return this.pendingDiffs.get(diffId);
  }

  clearAll(): void {
    this.pendingDiffs.clear();
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private basename(filePath: string): string {
    return filePath.split(/[\\/]/).pop() ?? filePath;
  }

  dispose(): void {
    this.contentProvider.dispose();
    this._onDiffApplied.dispose();
    this._onDiffRejected.dispose();
    this.pendingDiffs.clear();
  }
}
