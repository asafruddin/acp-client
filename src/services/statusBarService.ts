import * as vscode from "vscode";

type ConnectionType = "websocket" | "stdio";

export class StatusBarService implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private connectionType: ConnectionType | null = null;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBarItem.command = "acpComposer.statusBarClick";
    this.updateStatusBar(false);
  }

  /**
   * Updates the status bar based on connection state.
   */
  updateConnectionStatus(connected: boolean, connectionType?: ConnectionType): void {
    this.connectionType = connected ? connectionType ?? null : null;
    this.updateStatusBar(connected);
  }

  /**
   * Shows an error state in the status bar.
   */
  showError(message?: string): void {
    this.statusBarItem.text = "$(error) ACP Composer";
    this.statusBarItem.tooltip = message ?? "ACP Composer: Error occurred";
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground",
    );
    this.statusBarItem.show();
  }

  /**
   * Clears the error state and shows disconnected state.
   */
  clearError(): void {
    this.updateStatusBar(false);
  }

  private updateStatusBar(connected: boolean): void {
    if (connected) {
      const typeLabel = this.connectionType === "websocket" ? "Server" : "Qwen Code";
      this.statusBarItem.text = "$(check) ACP Composer";
      this.statusBarItem.tooltip = `ACP Composer: Connected to ${typeLabel}\nClick to open menu`;
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.color = undefined;
    } else {
      this.statusBarItem.text = "$(debug-disconnect) ACP Composer";
      this.statusBarItem.tooltip = "ACP Composer: Disconnected\nClick to connect";
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.color = undefined;
    }
    this.statusBarItem.show();
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
