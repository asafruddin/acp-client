import * as vscode from "vscode";
import { AcpClient } from "./services/acpClient";
import { ToolExecutionManager } from "./services/toolExecutionManager";
import { AcpRegistryService } from "./services/acpRegistryService";
import { ComposerViewProvider } from "./providers/composerViewProvider";
import { ContextProvider } from "./providers/contextProvider";
import { DiffProvider } from "./providers/diffProvider";
import {
  AcpStreamMessage,
  AcpToolCall,
  AcpFileChange,
  ChatMessage,
  PendingToolCall,
  WebviewToExtensionMessage,
  AcpRegistryAgent,
} from "./types/protocol";

let acpClient: AcpClient;
let composerProvider: ComposerViewProvider;
let contextProvider: ContextProvider;
let diffProvider: DiffProvider;
let toolManager: ToolExecutionManager;
let registryService: AcpRegistryService;

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  // Instantiate services
  acpClient = new AcpClient();
  contextProvider = new ContextProvider();
  diffProvider = new DiffProvider();
  toolManager = new ToolExecutionManager();
  registryService = new AcpRegistryService();
  composerProvider = new ComposerViewProvider(context.extensionUri);

  // Register the sidebar webview
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ComposerViewProvider.viewType,
      composerProvider,
    ),
  );

  // ------------------------------------------------------------------
  // Wire: ACP Client → Composer Webview
  // ------------------------------------------------------------------
  acpClient.onMessage((msg: AcpStreamMessage) => {
    handleAcpMessage(msg);
    composerProvider.streamChunk(msg);
  });

  acpClient.onConnectionChange((connected: boolean) => {
    composerProvider.updateConnectionStatus(connected);
    if (connected) {
      const connectionType = acpClient.connectionType === "websocket" 
        ? "server" 
        : "Qwen Code CLI";
      vscode.window.showInformationMessage(
        `ACP Composer: Connected to ${connectionType}.`,
      );
    }
  });

  acpClient.onError((err: string) => {
    composerProvider.sendError(err);
  });

  // ------------------------------------------------------------------
  // Wire: Webview → Extension Host
  // ------------------------------------------------------------------
  composerProvider.onDidReceiveMessage(
    async (msg: WebviewToExtensionMessage) => {
      switch (msg.command) {
        case "sendMessage": {
          // Resolve file contents for any attached context
          const resolvedFiles = await Promise.all(
            msg.contextFiles.map(async (cf) => {
              const resolved = await contextProvider.resolveByPath(cf.filePath);
              return resolved ?? cf;
            }),
          );
          await acpClient.sendPrompt(msg.text, resolvedFiles);
          break;
        }

        case "approveToolCall":
          toolManager.approve(msg.callId);
          break;

        case "rejectToolCall":
          toolManager.reject(msg.callId);
          break;

        case "applyFileChange":
          await diffProvider.applyDiff(msg.changeId);
          break;

        case "rejectFileChange":
          diffProvider.rejectDiff(msg.changeId);
          break;

        case "newThread":
          diffProvider.clearAll();
          composerProvider.clearThread();
          break;

        case "requestFileSearch": {
          const results = contextProvider.search(msg.query);
          composerProvider.sendFileSearchResults(results);
          break;
        }

        case "ready":
          composerProvider.updateConnectionStatus(acpClient.connected);
          break;

        case "connectQwenCode":
          await vscode.commands.executeCommand("acpComposer.connectQwenCode");
          break;

        case "browseRegistry":
          await vscode.commands.executeCommand("acpComposer.browseRegistry");
          break;
      }
    },
  );

  // ------------------------------------------------------------------
  // Wire: Tool manager events → ACP client
  // ------------------------------------------------------------------
  toolManager.onToolApproved((pending: PendingToolCall) => {
    acpClient.sendToolResult({
      type: "tool_result",
      callId: pending.id,
      result: { approved: true },
    });
  });

  toolManager.onToolRejected((pending: PendingToolCall) => {
    acpClient.sendToolResult({
      type: "tool_result",
      callId: pending.id,
      error: "User denied tool execution.",
    });
  });

  // ------------------------------------------------------------------
  // Register commands
  // ------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("acpComposer.focus", () => {
      vscode.commands.executeCommand("acpComposer.chatView.focus");
    }),

    vscode.commands.registerCommand("acpComposer.newThread", () => {
      diffProvider.clearAll();
      composerProvider.clearThread();
    }),

    vscode.commands.registerCommand("acpComposer.connectServer", async () => {
      const url = vscode.workspace
        .getConfiguration("acpComposer")
        .get<string>("serverUrl", "ws://localhost:3000");
      try {
        await acpClient.connect(url);
      } catch {
        vscode.window.showErrorMessage(
          `ACP Composer: Failed to connect to ${url}`,
        );
      }
    }),

    vscode.commands.registerCommand("acpComposer.disconnectServer", () => {
      acpClient.disconnect();
      vscode.window.showInformationMessage("ACP Composer: Disconnected.");
    }),

    vscode.commands.registerCommand("acpComposer.connectQwenCode", async () => {
      const qwenPath = vscode.workspace
        .getConfiguration("acpComposer")
        .get<string>("qwenCodePath", "qwen");
      const qwenArgs = vscode.workspace
        .getConfiguration("acpComposer")
        .get<string[]>("qwenCodeArgs", []);

      try {
        await acpClient.connectStdio(qwenPath, ["--acp", ...qwenArgs]);
      } catch {
        vscode.window.showErrorMessage(
          `ACP Composer: Failed to start Qwen Code CLI from "${qwenPath}". Make sure 'qwen' is installed and in your PATH.`,
        );
      }
    }),

    vscode.commands.registerCommand("acpComposer.browseRegistry", async () => {
      try {
        const agents = await registryService.fetchAgents();
        const agentItems = agents.map((agent) => ({
          label: agent.name,
          description: `${agent.version} - ${agent.description}`,
          agent,
        }));

        const selected = await vscode.window.showQuickPick(agentItems, {
          placeHolder: "Select an ACP agent to connect to",
          matchOnDescription: true,
        });

        if (selected) {
          await connectToAgent(selected.agent);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(
          `ACP Composer: Failed to fetch registry - ${message}`,
        );
      }
    }),

    vscode.commands.registerCommand("acpComposer.applyDiff", async () => {
      // Could be triggered from a CodeLens or context menu in the future.
      vscode.window.showInformationMessage(
        "Use the Apply button in the Composer chat.",
      );
    }),

    vscode.commands.registerCommand("acpComposer.rejectDiff", () => {
      vscode.window.showInformationMessage(
        "Use the Reject button in the Composer chat.",
      );
    }),
  );

  // ------------------------------------------------------------------
  // Initialize context provider (workspace file index)
  // ------------------------------------------------------------------
  contextProvider.initialize();

  // Push disposables
  context.subscriptions.push(
    acpClient,
    contextProvider,
    diffProvider,
    toolManager,
    registryService,
  );
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

async function connectToAgent(agent: AcpRegistryAgent): Promise<void> {
  try {
    const dist = agent.distribution;

    if (dist.type === "npm" && dist.identifier) {
      const confirmed = await vscode.window.showWarningMessage(
        `Connect to "${agent.name}"? This will run: npx ${dist.identifier}${dist.args ? " " + dist.args.join(" ") : ""}`,
        { modal: true },
        "Connect",
      );

      if (!confirmed) {
        return;
      }

      const command = "npx";
      const args = [dist.identifier, "--acp"];
      if (dist.args) {
        args.push(...dist.args);
      }

      await acpClient.connectStdio(command, args);
      vscode.window.showInformationMessage(
        `ACP Composer: Connected to ${agent.name}.`,
      );
    } else if (dist.type === "cli" && dist.command) {
      const confirmed = await vscode.window.showWarningMessage(
        `Connect to "${agent.name}"? This will run: ${dist.command}${dist.args ? " " + dist.args.join(" ") : ""}`,
        { modal: true },
        "Connect",
      );

      if (!confirmed) {
        return;
      }

      const command = dist.command;
      const args = dist.args || [];

      await acpClient.connectStdio(command, args);
      vscode.window.showInformationMessage(
        `ACP Composer: Connected to ${agent.name}.`,
      );
    } else {
      vscode.window.showWarningMessage(
        `ACP Composer: Unsupported distribution type "${dist.type}" for ${agent.name}.`,
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(
      `ACP Composer: Failed to connect to ${agent.name} - ${message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Handle specific ACP stream messages on the extension-host side
// ---------------------------------------------------------------------------

function handleAcpMessage(msg: AcpStreamMessage): void {
  switch (msg.type) {
    case "call_tool":
      handleToolCall(msg as AcpToolCall);
      break;
    case "file_change":
      handleFileChange(msg as AcpFileChange);
      break;
    // text, thought, status are forwarded directly to the webview (done above).
  }
}

async function handleToolCall(toolCall: AcpToolCall): Promise<void> {
  await toolManager.evaluate(toolCall);
}

function handleFileChange(change: AcpFileChange): void {
  diffProvider.addFileChange(change);
}

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

export function deactivate(): void {
  // All disposables are cleaned up via context.subscriptions.
}
