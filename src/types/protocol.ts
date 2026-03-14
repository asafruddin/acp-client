// ---------------------------------------------------------------------------
// ACP Protocol Types
// Defines the wire‑format types for Agent Client Protocol messages exchanged
// over JSON‑RPC / WebSocket between the extension and an ACP server.
// ---------------------------------------------------------------------------

/** Execution policy configured by the user. */
export type ExecutionPolicy = 'strict' | 'autonomous';

/** Agent interaction mode. */
export type ChatMode = 'default' | 'yolo' | 'plan' | 'auto';

/** A selectable agent model. */
export interface AgentModel {
  id: string;
  label: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// JSON‑RPC envelope
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcResponse
  | JsonRpcNotification;

// ---------------------------------------------------------------------------
// ACP‑specific message types
// ---------------------------------------------------------------------------

/** A thought / reasoning step emitted by the agent. */
export interface AcpThought {
  type: 'thought';
  content: string;
  timestamp: number;
}

/** A tool call requested by the agent. */
export interface AcpToolCall {
  type: 'call_tool';
  id: string;
  name: string;
  displayName?: string;
  parameters: Record<string, unknown>;
  /** Whether this tool is considered "read‑only" (safe to auto‑approve). */
  readOnly?: boolean;
}

/** Result of a tool execution sent back to the server. */
export interface AcpToolResult {
  type: 'tool_result';
  callId: string;
  result?: unknown;
  error?: string;
}

/** A file change suggested by the agent. */
export interface AcpFileChange {
  type: 'file_change';
  id: string;
  filePath: string;
  originalContent: string;
  proposedContent: string;
  description?: string;
}

/** A text / markdown response chunk from the agent. */
export interface AcpTextChunk {
  type: 'text';
  content: string;
  /** true when this is the final chunk of the current response. */
  done?: boolean;
}

/** Agent status / progress update. */
export interface AcpStatusUpdate {
  type: 'status';
  message: string;
  progress?: number; // 0‑100
}

/** Union of all streamed message types the UI needs to handle. */
export type AcpStreamMessage =
  | AcpThought
  | AcpToolCall
  | AcpToolResult
  | AcpFileChange
  | AcpTextChunk
  | AcpStatusUpdate;

// ---------------------------------------------------------------------------
// Chat / Thread model (UI side)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Attached context files (@ mentions). */
  contextFiles?: ContextFile[];
  /** Stream messages associated with this assistant response. */
  streamMessages?: AcpStreamMessage[];
}

export interface ChatThread {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Context (@ mentions / file tagging)
// ---------------------------------------------------------------------------

export interface ContextFile {
  /** Absolute path in the workspace. */
  filePath: string;
  /** Friendly label shown in the UI pill (e.g. "main.ts"). */
  label: string;
  /** Attachment type. */
  type?: 'file' | 'directory' | 'image';
  /** File contents (loaded lazily). */
  content?: string;
  /** Language identifier (e.g. "typescript"). */
  languageId?: string;
  /** MIME type for images (e.g. "image/png"). */
  mimeType?: string;
}

export interface WorkspaceFileEntry {
  /** Path relative to workspace root. */
  relativePath: string;
  /** Absolute path. */
  absolutePath: string;
  /** Language identifier. */
  languageId?: string;
}

// ---------------------------------------------------------------------------
// Webview ↔ Extension messaging
// ---------------------------------------------------------------------------

/** Messages sent FROM the webview TO the extension host. */
export type WebviewToExtensionMessage =
  | {
      command: 'sendMessage';
      text: string;
      contextFiles: ContextFile[];
      model?: string;
      mode?: string;
    }
  | { command: 'approveToolCall'; callId: string }
  | { command: 'rejectToolCall'; callId: string }
  | { command: 'applyFileChange'; changeId: string }
  | { command: 'rejectFileChange'; changeId: string }
  | { command: 'newThread' }
  | { command: 'requestFileSearch'; query: string }
  | { command: 'ready' }
  | { command: 'connectQwenCode' }
  | { command: 'browseRegistry' }
  | { command: 'setModel'; modelId: string }
  | { command: 'setMode'; mode: ChatMode }
  | { command: 'requestAttachFile' }
  | { command: 'requestAttachDirectory' }
  | {
      command: 'attachImageBase64';
      data: string;
      mimeType: string;
      label: string;
    };

/** Messages sent FROM the extension host TO the webview. */
export type ExtensionToWebviewMessage =
  | { type: 'addMessage'; message: ChatMessage }
  | { type: 'streamChunk'; chunk: AcpStreamMessage }
  | { type: 'updateConnectionStatus'; connected: boolean; agentName?: string }
  | { type: 'fileSearchResults'; files: WorkspaceFileEntry[] }
  | { type: 'threadCleared' }
  | { type: 'error'; message: string }
  | { type: 'addContextFile'; file: ContextFile }
  | { type: 'modelChanged'; modelId: string }
  | { type: 'modeChanged'; mode: ChatMode };

// ---------------------------------------------------------------------------
// Diff / Apply model
// ---------------------------------------------------------------------------

export interface PendingDiff {
  id: string;
  filePath: string;
  originalContent: string;
  proposedContent: string;
  description?: string;
  status: 'pending' | 'applied' | 'rejected';
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export interface PendingToolCall {
  id: string;
  name: string;
  displayName?: string;
  parameters: Record<string, unknown>;
  readOnly: boolean;
  status:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'running'
    | 'completed'
    | 'failed';
  result?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// ACP Registry Types
// ---------------------------------------------------------------------------

export interface AcpRegistryAgent {
  id: string;
  name: string;
  description: string;
  version: string;
  homepage?: string;
  repository?: string;
  icon?: string;
  distribution?: {
    npx?: {
      package: string;
      args?: string[];
      env?: Record<string, string>;
    };
    uvx?: {
      package: string;
      args?: string[];
    };
    binary?: {
      [platform: string]: {
        archive: string;
        cmd: string;
        args?: string[];
      };
    };
  };
}

export interface AcpRegistryData {
  agents: AcpRegistryAgent[];
  extensions?: any[];
  version?: string;
  lastUpdated?: string;
}
