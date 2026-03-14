import * as vscode from 'vscode';
import {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcError,
  AcpStreamMessage,
  AcpToolResult,
  ContextFile,
} from '../types/protocol';

type ConnectionType = 'websocket' | 'stdio';

/**
 * AcpClient manages the connection to an ACP server via WebSocket or stdio,
 * handles JSON-RPC framing, and exposes an event-driven API for
 * the rest of the extension to consume streamed agent messages.
 */
export class AcpClient implements vscode.Disposable {
  private ws: import('ws').WebSocket | null = null;
  private _proc: import('child_process').ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    string | number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private _sessionId: string | null = null;
  private _initialized = false;

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
  private _connectionType: ConnectionType = 'websocket';

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

    this._connectionType = 'websocket';

    try {
      const WebSocket = (await import('ws')).default;
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        this._connected = true;
        this._onConnectionChange.fire(true);
      });

      this.ws.on('message', (data: Buffer | string) => {
        this.handleRawMessage(data.toString());
      });

      this.ws.on('close', () => {
        this._connected = false;
        this._onConnectionChange.fire(false);
      });

      this.ws.on('error', (err: Error) => {
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
      this._proc.kill('SIGTERM');
      this._proc = null;
    }
    this._connected = false;
    this._initialized = false;
    this._sessionId = null;
    this._onConnectionChange.fire(false);
  }

  async connectStdio(
    command: string,
    args: string[] = [],
    env?: Record<string, string>,
  ): Promise<void> {
    if (this.ws) {
      this.disconnect();
    }

    this._connectionType = 'stdio';

    const { spawn } = await import('child_process');

    try {
      const proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      });

      let buffer = '';

      proc.stdout.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            JSON.parse(line); // Validate JSON
            this.handleRawMessage(line);
          } catch {
            // Skip non-JSON output
          }
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        console.log('[ACP stdio stderr]:', data.toString());
      });

      proc.on('close', (code: number | null) => {
        this._connected = false;
        this._onConnectionChange.fire(false);
        this._onError.fire(`Process exited with code ${code}`);
      });

      proc.on('error', (err: Error) => {
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
    if (this._initialized) {
      // Use proper ACP protocol format
      const prompt: Record<string, unknown>[] = [{ type: 'text', text }];
      if (contextFiles.length > 0) {
        for (const f of contextFiles) {
          prompt.push({
            type: 'resource',
            resource: {
              uri: `file://${f.filePath}`,
              text: f.content ?? '',
              mimeType: f.languageId ? `text/${f.languageId}` : 'text/plain',
            },
          });
        }
      }

      const promptParams: Record<string, unknown> = { prompt };
      if (this._sessionId) {
        promptParams.sessionId = this._sessionId;
      }

      // session/prompt is a request in ACP (response comes via session/update notifications)
      this.sendRequest('session/prompt', promptParams).catch(() => {
        // Streaming responses arrive via session/update notifications
      });
    } else {
      // Legacy format for non-ACP agents
      const params: Record<string, unknown> = { text };
      if (contextFiles.length > 0) {
        params.context = contextFiles.map((f) => ({
          filePath: f.filePath,
          content: f.content ?? '',
          languageId: f.languageId,
        }));
      }
      this.sendNotification('acp/prompt', params);
    }
  }

  sendToolResult(result: AcpToolResult): void {
    this.sendNotification('acp/toolResult', result);
  }

  sendRequest(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, params } as JsonRpcNotification);
  }

  private send(message: JsonRpcMessage): void {
    if (!this._connected) {
      this._onError.fire('Not connected to ACP server.');
      return;
    }

    const json = JSON.stringify(message);

    if (this._connectionType === 'websocket' && this.ws) {
      this.ws.send(json);
    } else if (this._connectionType === 'stdio' && this._proc?.stdin) {
      this._proc.stdin.write(json + '\n');
    } else {
      this._onError.fire('No valid connection available.');
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
      this._onError.fire('Malformed JSON from server.');
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

    // Direct ACP stream message (legacy/custom format)
    if (this.isAcpStreamMessage(msg)) {
      this._onMessage.fire(msg as unknown as AcpStreamMessage);
      return;
    }

    // JSON-RPC request from agent (bidirectional ACP protocol)
    if (
      'id' in msg &&
      'method' in msg &&
      !('result' in msg) &&
      !('error' in msg)
    ) {
      void this.handleAgentRequest(msg);
      return;
    }

    // JSON-RPC notification
    if ('method' in msg && 'params' in msg) {
      const method = msg.method as string;
      const params = msg.params as Record<string, unknown>;

      // ACP session/update notification (standard protocol)
      if (
        (method === 'session/update' || method === 'sessionUpdate') &&
        params?.update
      ) {
        const update = params.update as Record<string, unknown>;
        const streamMsg = this.mapAcpSessionUpdate(update);
        if (streamMsg) {
          this._onMessage.fire(streamMsg);
          return;
        }
      }

      // Legacy format: params is directly a stream message
      if (this.isAcpStreamMessage(params)) {
        this._onMessage.fire(params as unknown as AcpStreamMessage);
        return;
      }
    }

    // Log unhandled messages for debugging
    console.log(
      '[ACP] Unhandled message:',
      JSON.stringify(msg).substring(0, 500),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isJsonRpcResponse(obj: any): boolean {
    return (
      obj &&
      obj.jsonrpc === '2.0' &&
      'id' in obj &&
      ('result' in obj || 'error' in obj)
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isAcpStreamMessage(obj: any): boolean {
    if (!obj || typeof obj !== 'object') {
      return false;
    }
    const validTypes = [
      'thought',
      'call_tool',
      'tool_result',
      'file_change',
      'text',
      'status',
    ];
    return validTypes.includes(obj.type);
  }

  // -----------------------------------------------------------------------
  // ACP Protocol helpers
  // -----------------------------------------------------------------------

  /**
   * Performs ACP protocol initialization handshake.
   * Sends initialize → initialized → session/create.
   */
  async initializeAcp(): Promise<void> {
    try {
      await Promise.race([
        this.sendRequest('initialize', {
          protocolVersion: '2025-07-09',
          clientInfo: { name: 'ACP Composer', version: '0.1.0' },
          capabilities: {},
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000),
        ),
      ]);

      this.sendNotification('initialized', {});
      this._initialized = true;

      // Create session
      try {
        const sessionResult = (await Promise.race([
          this.sendRequest('session/create', {}),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 5000),
          ),
        ])) as Record<string, unknown> | undefined;

        this._sessionId = (sessionResult?.sessionId as string) ?? null;
      } catch {
        this._sessionId = null;
      }
    } catch {
      // Agent may not support ACP initialization — fall back to legacy mode
      this._initialized = false;
      this._sessionId = null;
    }
  }

  /**
   * Maps an ACP SessionUpdate to an internal AcpStreamMessage.
   */
  private mapAcpSessionUpdate(
    update: Record<string, unknown>,
  ): AcpStreamMessage | null {
    if (!update || typeof update !== 'object') {
      return null;
    }

    const updateType = update.sessionUpdate as string;

    switch (updateType) {
      case 'agent_message_chunk': {
        const text = this.extractTextFromContent(
          update.content as Record<string, unknown>,
        );
        if (text !== null) {
          return { type: 'text', content: text } as AcpStreamMessage;
        }
        return null;
      }

      case 'user_message_chunk':
        // Ignore echoed user messages
        return null;

      case 'agent_thought_chunk': {
        const text = this.extractTextFromContent(
          update.content as Record<string, unknown>,
        );
        if (text !== null) {
          return {
            type: 'thought',
            content: text,
            timestamp: Date.now(),
          } as AcpStreamMessage;
        }
        return null;
      }

      case 'tool_call': {
        return {
          type: 'call_tool',
          id: (update.callId as string) || `tool-${Date.now()}`,
          name: (update.name as string) || 'unknown',
          displayName: update.displayName as string | undefined,
          parameters: (update.arguments as Record<string, unknown>) || {},
          readOnly: (update.readOnly as boolean) ?? false,
        } as AcpStreamMessage;
      }

      case 'tool_call_result':
      case 'tool_call_update': {
        if (update.content && Array.isArray(update.content)) {
          const textParts = (update.content as Record<string, unknown>[])
            .map((c) => this.extractTextFromContent(c))
            .filter(Boolean);
          if (textParts.length > 0) {
            return {
              type: 'text',
              content: textParts.join('\n'),
            } as AcpStreamMessage;
          }
        }
        return {
          type: 'status',
          message: `Tool ${update.name || ''}: ${update.status || 'running'}`,
        } as AcpStreamMessage;
      }

      case 'plan_update': {
        return {
          type: 'status',
          message: 'Updating plan...',
        } as AcpStreamMessage;
      }

      case 'turn_finish':
      case 'finish': {
        return { type: 'text', content: '', done: true } as AcpStreamMessage;
      }

      default: {
        // Fallback: try to extract text from unknown update types
        if (update.content) {
          const text = this.extractTextFromContent(
            update.content as Record<string, unknown>,
          );
          if (text !== null) {
            return { type: 'text', content: text } as AcpStreamMessage;
          }
        }
        console.log(`[ACP] Unknown session update type: ${updateType}`);
        return null;
      }
    }
  }

  /**
   * Extracts text from an ACP ContentBlock.
   */
  private extractTextFromContent(
    content: Record<string, unknown> | undefined | null,
  ): string | null {
    if (!content || typeof content !== 'object') {
      return null;
    }
    if (content.type === 'text' && typeof content.text === 'string') {
      return content.text;
    }
    if (typeof content.text === 'string') {
      return content.text;
    }
    return null;
  }

  /**
   * Handles JSON-RPC requests from the agent (bidirectional ACP protocol).
   */
  private async handleAgentRequest(
    msg: Record<string, unknown>,
  ): Promise<void> {
    const id = msg.id as string | number;
    const method = msg.method as string;
    const params = msg.params as Record<string, unknown> | undefined;

    try {
      let result: unknown;

      switch (method) {
        case 'fs/readTextFile': {
          const filePath = (params?.path as string) || (params?.uri as string);
          if (filePath) {
            const cleanPath = filePath.replace(/^file:\/\//, '');
            const uri = vscode.Uri.file(cleanPath);
            const data = await vscode.workspace.fs.readFile(uri);
            result = { content: Buffer.from(data).toString('utf-8') };
          } else {
            throw new Error('Missing path parameter');
          }
          break;
        }

        case 'requestPermission': {
          const toolInfo = params?.tool as Record<string, unknown> | undefined;
          const toolName = (toolInfo?.name as string) || 'unknown tool';
          const reason = (params?.reason as string) || '';
          const choice = await vscode.window.showWarningMessage(
            `Agent requests permission: ${toolName}${reason ? ' — ' + reason : ''}`,
            { modal: false },
            'Allow',
            'Deny',
          );
          result = { granted: choice === 'Allow' };
          break;
        }

        default:
          this.sendResponse(id, undefined, {
            code: -32601,
            message: `Method not found: ${method}`,
          });
          return;
      }

      this.sendResponse(id, result);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.sendResponse(id, undefined, {
        code: -32603,
        message: errMsg,
      });
    }
  }

  /**
   * Sends a JSON-RPC response back to the agent.
   */
  private sendResponse(
    id: string | number,
    result?: unknown,
    error?: { code: number; message: string },
  ): void {
    const response: Record<string, unknown> = { jsonrpc: '2.0', id };
    if (error) {
      response.error = error;
    } else {
      response.result = result ?? {};
    }

    const json = JSON.stringify(response);
    if (this._connectionType === 'websocket' && this.ws) {
      this.ws.send(json);
    } else if (this._connectionType === 'stdio' && this._proc?.stdin) {
      this._proc.stdin.write(json + '\n');
    }
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
