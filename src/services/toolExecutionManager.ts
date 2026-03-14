import * as vscode from "vscode";
import {
  AcpToolCall,
  AcpToolResult,
  ExecutionPolicy,
  PendingToolCall,
} from "../types/protocol";

/**
 * ToolExecutionManager implements the HITL (Human-in-the-Loop) permission
 * flow for agent-requested tool calls.
 *
 * Depending on the configured ExecutionPolicy:
 *   - **strict:**  Every tool call shows a confirmation prompt.
 *   - **autonomous:** Read-only tools are auto-approved; write/destructive
 *     tools require explicit user approval via a non-intrusive toast.
 */
export class ToolExecutionManager implements vscode.Disposable {
  private pendingCalls = new Map<string, PendingToolCall>();

  private readonly _onToolApproved = new vscode.EventEmitter<PendingToolCall>();
  public readonly onToolApproved = this._onToolApproved.event;

  private readonly _onToolRejected = new vscode.EventEmitter<PendingToolCall>();
  public readonly onToolRejected = this._onToolRejected.event;

  private readonly _onToolCompleted =
    new vscode.EventEmitter<PendingToolCall>();
  public readonly onToolCompleted = this._onToolCompleted.event;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Evaluate a tool call against the current execution policy.
   * Returns a promise that resolves to the user's decision.
   */
  async evaluate(toolCall: AcpToolCall): Promise<"approved" | "rejected"> {
    const policy = this.getPolicy();

    const pending: PendingToolCall = {
      id: toolCall.id,
      name: toolCall.name,
      displayName: toolCall.displayName,
      parameters: toolCall.parameters,
      readOnly: toolCall.readOnly ?? false,
      status: "pending",
    };
    this.pendingCalls.set(pending.id, pending);

    // Auto-approve read-only tools in autonomous mode.
    if (policy === "autonomous" && pending.readOnly) {
      pending.status = "approved";
      this._onToolApproved.fire(pending);
      return "approved";
    }

    // Show confirmation toast.
    return this.promptUser(pending);
  }

  /** Mark a tool call as completed (with optional result / error). */
  complete(callId: string, result?: unknown, error?: string): void {
    const pending = this.pendingCalls.get(callId);
    if (!pending) {
      return;
    }
    pending.status = error ? "failed" : "completed";
    pending.result = result;
    pending.error = error;
    this._onToolCompleted.fire(pending);
  }

  /** Approve a pending call programmatically (e.g. from the webview). */
  approve(callId: string): void {
    const pending = this.pendingCalls.get(callId);
    if (!pending || pending.status !== "pending") {
      return;
    }
    pending.status = "approved";
    this._onToolApproved.fire(pending);
  }

  /** Reject a pending call programmatically. */
  reject(callId: string): void {
    const pending = this.pendingCalls.get(callId);
    if (!pending || pending.status !== "pending") {
      return;
    }
    pending.status = "rejected";
    this._onToolRejected.fire(pending);
  }

  getPendingCall(callId: string): PendingToolCall | undefined {
    return this.pendingCalls.get(callId);
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async promptUser(
    pending: PendingToolCall,
  ): Promise<"approved" | "rejected"> {
    const label = pending.displayName ?? pending.name;
    const paramSummary =
      Object.keys(pending.parameters).length > 0
        ? ` with ${JSON.stringify(pending.parameters).slice(0, 80)}`
        : "";

    const choice = await vscode.window.showInformationMessage(
      `Agent wants to run: **${label}**${paramSummary}`,
      { modal: false },
      "Allow",
      "Deny",
    );

    if (choice === "Allow") {
      pending.status = "approved";
      this._onToolApproved.fire(pending);
      return "approved";
    }

    pending.status = "rejected";
    this._onToolRejected.fire(pending);
    return "rejected";
  }

  private getPolicy(): ExecutionPolicy {
    return vscode.workspace
      .getConfiguration("acpComposer")
      .get<ExecutionPolicy>("executionPolicy", "autonomous");
  }

  // -----------------------------------------------------------------------
  // Disposable
  // -----------------------------------------------------------------------

  dispose(): void {
    this._onToolApproved.dispose();
    this._onToolRejected.dispose();
    this._onToolCompleted.dispose();
    this.pendingCalls.clear();
  }
}
