import * as vscode from "vscode";
import { ChildProcess } from "child_process";
import {
  AcpStreamMessage,
  ContextFile,
} from "../types/protocol";

type MessageHandler = (message: AcpStreamMessage) => void;

/**
 * QwenCodeCliService manages a stdio-based connection to Qwen Code CLI
 * running in ACP mode (`qwen --acp`). It spawns the CLI process and
 * communicates via stdin/stdout using JSON-RPC framing.
 */
export class QwenCodeCliService implements vscode.Disposable {
  private process: ChildProcess | null = null;
  private readonly _onMessage = new vscode.EventEmitter<AcpStreamMessage>();
  public readonly onMessage: vscode.Event<AcpStreamMessage> = this._onMessage.event;

  private readonly _onConnectionChange = new vscode.EventEmitter<boolean>();
  public readonly onConnectionChange: vscode.Event<boolean> = this._onConnectionChange.event;

  private readonly _onError = new vscode.EventEmitter<string>();
  public readonly onError: vscode.Event<string> = this._onError.event;

  private _connected = false;
  private _buffer = "";

  get connected(): boolean {
    return this._connected;
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  async connect(qwenPath: string, args: string[] = []): Promise<void> {
    if (this.process) {
      this.disconnect();
    }

    const { spawn } = await import("child_process");

    const cliArgs = ["--acp", ...args];

    try {
      this.process = spawn(qwenPath, cliArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      this.process.stdout?.on("data", (data: Buffer) => {
        this.handleStdout(data.toString());
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        // Log stderr but don't treat it as a connection error
        console.log("[Qwen Code CLI stderr]:", data.toString());
      });

      this.process.on("close", (code: number | null) => {
        this._connected = false;
        this._onConnectionChange.fire(false);
        this._onError.fire(`Qwen Code CLI exited with code ${code}`);
      });

      this.process.on("error", (err: Error) => {
        this._connected = false;
        this._onConnectionChange.fire(false);
        this._onError.fire(`Failed to start Qwen Code CLI: ${err.message}`);
      });

      // Mark as connected once the process starts successfully
      this._connected = true;
      this._onConnectionChange.fire(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._onError.fire(`Failed to connect: ${msg}`);
      throw err;
    }
  }

  disconnect(): void {
    if (this.process) {
      this.process.removeAllListeners();
      this.process.kill("SIGTERM");
      this.process = null;
    }
    this._connected = false;
    this._onConnectionChange.fire(false);
    this._buffer = "";
  }

  // -----------------------------------------------------------------------
  // Sending messages
  // -----------------------------------------------------------------------

  async sendPrompt(
    text: string,
    contextFiles: ContextFile[] = [],
  ): Promise<void> {
    const params: Record<string, unknown> = { text };
    if (contextFiles.length > 0) {
      params.context = contextFiles.map((f) => ({
        filePath: f.filePath,
        content: f.content ?? "",
        languageId: f.languageId,
      }));
    }
    this.sendNotification("acp/prompt", params);
  }

  sendToolResult(result: Record<string, unknown>): void {
    this.sendNotification("acp/toolResult", result);
  }

  sendRequest(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      // For stdio, we'll use a simple request/response pattern
      // In practice, ACP over stdio is mostly notification-based
      this.sendNotification(method, params);
      resolve({});
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(message: Record<string, unknown>): void {
    if (!this.process || !this.process.stdin || !this._connected) {
      this._onError.fire("Not connected to Qwen Code CLI.");
      return;
    }
    const json = JSON.stringify(message);
    this.process.stdin.write(json + "\n");
  }

  // -----------------------------------------------------------------------
  // Receiving messages
  // -----------------------------------------------------------------------

  private handleStdout(data: string): void {
    this._buffer += data;

    // Process complete lines/messages
    const lines = this._buffer.split("\n");
    this._buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // Skip non-JSON output (e.g., CLI banners)
        continue;
      }

      const msg = parsed as Record<string, unknown>;
      this.handleMessage(msg);
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    // Check if it's an ACP stream message
    if (this.isAcpStreamMessage(msg)) {
      this._onMessage.fire(msg as unknown as AcpStreamMessage);
      return;
    }

    // Check if it's a notification with params containing the message
    if ("method" in msg && "params" in msg) {
      const params = msg.params as Record<string, unknown>;
      if (this.isAcpStreamMessage(params)) {
        this._onMessage.fire(params as unknown as AcpStreamMessage);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isAcpStreamMessage(obj: any): boolean {
    if (!obj || typeof obj !== "object") {
      return false;
    }
    const validTypes = [
      "thought",
      "call_tool",
      "tool_result",
      "file_change",
      "text",
      "status",
    ];
    return "type" in obj && validTypes.includes(obj.type);
  }

  // -----------------------------------------------------------------------
  // Disposable
  // -----------------------------------------------------------------------

  dispose(): void {
    this.disconnect();
    this._onMessage.dispose();
    this._onConnectionChange.dispose();
    this._onError.dispose();
  }
}
