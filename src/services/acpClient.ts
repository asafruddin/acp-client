import * as vscode from "vscode";
import {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcError,
  AcpStreamMessage,
  AcpToolResult,
  ContextFile,
} from "../types/protocol";

type ConnectionType = "websocket" | "stdio";

/**
 * AcpClient manages the connection to an ACP server via WebSocket or stdio,
 * handles JSON-RPC framing, and exposes an event-driven API for
 * the rest of the extension to consume streamed agent messages.
 */
export class AcpClient implements vscode.Disposable {
  private ws: import("ws").WebSocket | null = null;
  private _proc: import("child_process").ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    string | number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  private readonly _onMessage = new vscode.EventEmitter<AcpStreamMessage>();
  public readonly onMessage: vscode.Event<AcpStreamMessage> =
    this._onMessage.event;

  private readonly _onConnectionChange = new vscode.EventEmitter<boolean>();
  public readonly onConnectionChange: vscode.Event<boolean> =
    this._onConnectionChange.event;

  private readonly _onError = new vscode.EventEmitter<string>();
  public readonly onError: vscode.Event<string> = this._onError.event;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  private _connectionType: ConnectionType = "websocket";

  get connected(): boolean {
    return this._connected;
  }

  get connectionType(): ConnectionType {
    return this._connectionType;
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  async connect(url: string): Promise<void> {
    if (this.ws) {
      this.disconnect();
    }

    this._connectionType = "websocket";

    try {
      const WebSocket = (await import("ws")).default;
      this.ws = new WebSocket(url);

      this.ws.on("open", () => {
        this._connected = true;
        this._onConnectionChange.fire(true);
      });

      this.ws.on("message", (data: Buffer | string) => {
        this.handleRawMessage(data.toString());
      });

      this.ws.on("close", () => {
        this._connected = false;
        this._onConnectionChange.fire(false);
      });

      this.ws.on("error", (err: Error) => {
        this._onError.fire(err.message);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._onError.fire(`Failed to connect: ${msg}`);
      throw err;
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    if (this._proc) {
      this._proc.removeAllListeners();
      this._proc.kill("SIGTERM");
      this._proc = null;
    }
    this._connected = false;
    this._onConnectionChange.fire(false);
  }

  async connectStdio(command: string, args: string[] = []): Promise<void> {
    if (this.ws) {
      this.disconnect();
    }

    this._connectionType = "stdio";

    const { spawn } = await import("child_process");

    try {
      const proc = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      let buffer = "";

      proc.stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            this.handleRawMessage(line);
          } catch {
            // Skip non-JSON output
          }
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        console.log("[ACP stdio stderr]:", data.toString());
      });

      proc.on("close", (code: number | null) => {
        this._connected = false;
        this._onConnectionChange.fire(false);
        this._onError.fire(`Process exited with code ${code}`);
      });

      proc.on("error", (err: Error) => {
        this._connected = false;
        this._onConnectionChange.fire(false);
        this._onError.fire(`Failed to start process: ${err.message}`);
      });

      // Store process reference for sending messages
      (this as unknown as { _proc: typeof proc })._proc = proc;

      this._connected = true;
      this._onConnectionChange.fire(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._onError.fire(`Failed to connect: ${msg}`);
      throw err;
    }
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

  sendToolResult(result: AcpToolResult): void {
    this.sendNotification("acp/toolResult", result);
  }

  sendRequest(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    this.send({ jsonrpc: "2.0", method, params } as JsonRpcNotification);
  }

  private send(message: JsonRpcMessage): void {
    if (!this._connected) {
      this._onError.fire("Not connected to ACP server.");
      return;
    }

    const json = JSON.stringify(message);

    if (this._connectionType === "websocket" && this.ws) {
      this.ws.send(json);
    } else if (this._connectionType === "stdio" && this._proc?.stdin) {
      this._proc.stdin.write(json + "\n");
    } else {
      this._onError.fire("No valid connection available.");
    }
  }

  // -----------------------------------------------------------------------
  // Receiving messages
  // -----------------------------------------------------------------------

  private handleRawMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this._onError.fire("Malformed JSON from server.");
      return;
    }

    const msg = parsed as Record<string, unknown>;

    // JSON-RPC response to a pending request
    if (this.isJsonRpcResponse(msg)) {
      const id = msg.id as string | number;
      const pending = this.pendingRequests.get(id);
      if (pending) {
        this.pendingRequests.delete(id);
        if (msg.error) {
          const err = msg.error as JsonRpcError;
          pending.reject(new Error(err.message));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // ACP stream message (notification)
    if (this.isAcpStreamMessage(msg)) {
      this._onMessage.fire(msg as unknown as AcpStreamMessage);
      return;
    }

    // Notification with params containing the stream message
    if ("method" in msg && "params" in msg) {
      const params = msg.params;
      if (this.isAcpStreamMessage(params)) {
        this._onMessage.fire(params as AcpStreamMessage);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isJsonRpcResponse(obj: any): boolean {
    return (
      obj &&
      obj.jsonrpc === "2.0" &&
      "id" in obj &&
      ("result" in obj || "error" in obj)
    );
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
    return validTypes.includes(obj.type);
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
