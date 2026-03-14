import * as vscode from 'vscode';
import * as path from 'path';
import { AcpClient } from './services/acpClient';
import { ToolExecutionManager } from './services/toolExecutionManager';
import { AcpRegistryService } from './services/acpRegistryService';
import { ComposerViewProvider } from './providers/composerViewProvider';
import { ContextProvider } from './providers/contextProvider';
import { DiffProvider } from './providers/diffProvider';
import { StatusBarService } from './services/statusBarService';
import {
  AcpStreamMessage,
  AcpToolCall,
  AcpFileChange,
  ChatMessage,
  PendingToolCall,
  WebviewToExtensionMessage,
  AcpRegistryAgent,
} from './types/protocol';

let acpClient: AcpClient;
let composerProvider: ComposerViewProvider;
let contextProvider: ContextProvider;
let diffProvider: DiffProvider;
let toolManager: ToolExecutionManager;
let registryService: AcpRegistryService;
let statusBarService: StatusBarService;

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
  statusBarService = new StatusBarService();

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
    statusBarService.updateConnectionStatus(
      connected,
      acpClient.connectionType,
    );
    if (connected) {
      // Perform ACP protocol initialization (non-blocking, optional)
      acpClient.initializeAcp().catch((err) => {
        console.log('[ACP] Initialization skipped:', err);
      });

      const connectionType =
        acpClient.connectionType === 'websocket' ? 'server' : 'agent';
      vscode.window.showInformationMessage(
        `ACP Composer: Connected to ${connectionType}.`,
      );
    }
  });

  acpClient.onError((err: string) => {
    composerProvider.sendError(err);
    statusBarService.showError(err);
  });

  // ------------------------------------------------------------------
  // Wire: Webview → Extension Host
  // ------------------------------------------------------------------
  composerProvider.onDidReceiveMessage(
    async (msg: WebviewToExtensionMessage) => {
      switch (msg.command) {
        case 'sendMessage': {
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

        case 'approveToolCall':
          toolManager.approve(msg.callId);
          break;

        case 'rejectToolCall':
          toolManager.reject(msg.callId);
          break;

        case 'applyFileChange':
          await diffProvider.applyDiff(msg.changeId);
          break;

        case 'rejectFileChange':
          diffProvider.rejectDiff(msg.changeId);
          break;

        case 'newThread':
          diffProvider.clearAll();
          composerProvider.clearThread();
          break;

        case 'requestFileSearch': {
          const results = contextProvider.search(msg.query);
          composerProvider.sendFileSearchResults(results);
          break;
        }

        case 'ready':
          composerProvider.updateConnectionStatus(acpClient.connected);
          break;

        case 'connectQwenCode':
          await vscode.commands.executeCommand('acpComposer.connectQwenCode');
          break;

        case 'browseRegistry':
          await vscode.commands.executeCommand('acpComposer.browseRegistry');
          break;
      }
    },
  );

  // ------------------------------------------------------------------
  // Wire: Tool manager events → ACP client
  // ------------------------------------------------------------------
  toolManager.onToolApproved((pending: PendingToolCall) => {
    acpClient.sendToolResult({
      type: 'tool_result',
      callId: pending.id,
      result: { approved: true },
    });
  });

  toolManager.onToolRejected((pending: PendingToolCall) => {
    acpClient.sendToolResult({
      type: 'tool_result',
      callId: pending.id,
      error: 'User denied tool execution.',
    });
  });

  // ------------------------------------------------------------------
  // Register commands
  // ------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('acpComposer.focus', () => {
      vscode.commands.executeCommand('acpComposer.chatView.focus');
    }),

    vscode.commands.registerCommand('acpComposer.newThread', () => {
      diffProvider.clearAll();
      composerProvider.clearThread();
    }),

    vscode.commands.registerCommand('acpComposer.connectServer', async () => {
      const url = vscode.workspace
        .getConfiguration('acpComposer')
        .get<string>('serverUrl', 'ws://localhost:3000');
      try {
        await acpClient.connect(url);
      } catch {
        vscode.window.showErrorMessage(
          `ACP Composer: Failed to connect to ${url}`,
        );
      }
    }),

    vscode.commands.registerCommand('acpComposer.disconnectServer', () => {
      acpClient.disconnect();
      statusBarService.clearError();
      vscode.window.showInformationMessage('ACP Composer: Disconnected.');
    }),

    vscode.commands.registerCommand('acpComposer.connectQwenCode', async () => {
      const qwenPath = vscode.workspace
        .getConfiguration('acpComposer')
        .get<string>('qwenCodePath', 'qwen');
      const qwenArgs = vscode.workspace
        .getConfiguration('acpComposer')
        .get<string[]>('qwenCodeArgs', []);

      try {
        await acpClient.connectStdio(qwenPath, ['--acp', ...qwenArgs]);
      } catch {
        vscode.window.showErrorMessage(
          `ACP Composer: Failed to start Qwen Code CLI from "${qwenPath}". Make sure 'qwen' is installed and in your PATH.`,
        );
      }
    }),

    vscode.commands.registerCommand('acpComposer.browseRegistry', async () => {
      try {
        const agents = await registryService.fetchAgents();
        const agentItems = agents.map((agent) => ({
          label: agent.name,
          description: `${agent.version} - ${agent.description}`,
          agent,
        }));

        const selected = await vscode.window.showQuickPick(agentItems, {
          placeHolder: 'Select an ACP agent to connect to',
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

    vscode.commands.registerCommand('acpComposer.applyDiff', async () => {
      // Could be triggered from a CodeLens or context menu in the future.
      vscode.window.showInformationMessage(
        'Use the Apply button in the Composer chat.',
      );
    }),

    vscode.commands.registerCommand('acpComposer.rejectDiff', () => {
      vscode.window.showInformationMessage(
        'Use the Reject button in the Composer chat.',
      );
    }),

    vscode.commands.registerCommand('acpComposer.statusBarClick', async () => {
      const connected = acpClient.connected;

      if (connected) {
        const choice = await vscode.window.showQuickPick(
          [
            { label: 'New Thread', description: 'Start a new conversation' },
            {
              label: 'Disconnect',
              description: 'Disconnect from current session',
            },
          ],
          { placeHolder: 'ACP Composer Actions' },
        );

        if (choice?.label === 'New Thread') {
          vscode.commands.executeCommand('acpComposer.newThread');
        } else if (choice?.label === 'Disconnect') {
          vscode.commands.executeCommand('acpComposer.disconnectServer');
        }
      } else {
        const choice = await vscode.window.showQuickPick(
          [
            {
              label: 'Connect to Server',
              description: 'Connect to ACP WebSocket server',
            },
            {
              label: 'Connect to Qwen Code CLI',
              description: 'Start Qwen Code in ACP mode',
            },
            {
              label: 'Browse Registry',
              description: 'Select from ACP registry agents',
            },
          ],
          { placeHolder: 'ACP Composer - Choose Connection Type' },
        );

        if (choice?.label === 'Connect to Server') {
          vscode.commands.executeCommand('acpComposer.connectServer');
        } else if (choice?.label === 'Connect to Qwen Code CLI') {
          vscode.commands.executeCommand('acpComposer.connectQwenCode');
        } else if (choice?.label === 'Browse Registry') {
          vscode.commands.executeCommand('acpComposer.browseRegistry');
        }
      }
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
    statusBarService,
  );
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

async function connectToAgent(agent: AcpRegistryAgent): Promise<void> {
  try {
    const dist = agent.distribution;

    if (!dist) {
      vscode.window.showWarningMessage(
        `ACP Composer: No distribution information available for ${agent.name}. Check the agent's homepage for installation instructions.`,
      );
      return;
    }

    // Handle npx package distribution
    if (dist.npx && dist.npx.package) {
      const npx = dist.npx;
      const argsList = npx.args ? npx.args.join(' ') : '';
      const confirmed = await vscode.window.showWarningMessage(
        `Connect to "${agent.name}"? This will run: npx ${npx.package}${argsList ? ' ' + argsList : ''}`,
        { modal: true },
        'Connect',
      );

      if (!confirmed) {
        return;
      }

      const command = 'npx';
      const args = [npx.package];
      if (npx.args) {
        args.push(...npx.args);
      }

      await acpClient.connectStdio(command, args, npx.env);
      vscode.window.showInformationMessage(
        `ACP Composer: Connected to ${agent.name}.`,
      );
    } else if (dist.uvx && dist.uvx.package) {
      // Handle uvx (Python) package distribution
      const uvx = dist.uvx;
      const argsList = uvx.args ? uvx.args.join(' ') : '';
      const confirmed = await vscode.window.showWarningMessage(
        `Connect to "${agent.name}"? This will run: uvx ${uvx.package}${argsList ? ' ' + argsList : ''}`,
        { modal: true },
        'Connect',
      );

      if (!confirmed) {
        return;
      }

      const command = 'uvx';
      const args = [uvx.package];
      if (uvx.args) {
        args.push(...uvx.args);
      }

      await acpClient.connectStdio(command, args);
      vscode.window.showInformationMessage(
        `ACP Composer: Connected to ${agent.name}.`,
      );
    } else if (dist.binary) {
      // Handle binary distribution
      const platform = getPlatformKey();
      const binaryDist = dist.binary[platform];

      if (!binaryDist) {
        vscode.window.showWarningMessage(
          `ACP Composer: No binary available for ${platform} for ${agent.name}. Available platforms: ${Object.keys(dist.binary).join(', ')}`,
        );
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        `Connect to "${agent.name}"? This will download and run the agent binary.`,
        { modal: true },
        'Connect',
      );

      if (!confirmed) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `ACP Composer: Installing ${agent.name}...`,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Downloading...' });

          const agentDir = await downloadAndExtractAgent(
            agent.id,
            binaryDist.archive,
          );

          progress.report({ message: 'Starting agent...' });

          // Resolve the command path (handle leading ./)
          const cmdPath = path.resolve(agentDir, binaryDist.cmd);

          // Make executable on Unix
          if (process.platform !== 'win32') {
            try {
              const { chmodSync } = require('fs') as typeof import('fs');
              chmodSync(cmdPath, 0o755);
            } catch {
              // May already be executable
            }
          }

          await acpClient.connectStdio(cmdPath, binaryDist.args || []);
        },
      );

      vscode.window.showInformationMessage(
        `ACP Composer: Connected to ${agent.name}.`,
      );
    } else {
      // Unknown or unsupported distribution type
      vscode.window.showWarningMessage(
        `ACP Composer: No supported distribution method for ${agent.name}. Check the agent's homepage for installation instructions.`,
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(
      `ACP Composer: Failed to connect to ${agent.name} - ${message}`,
    );
  }
}

/**
 * Gets the platform key for binary distributions.
 */
function getPlatformKey(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-aarch64' : 'darwin-x86_64';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'linux-aarch64' : 'linux-x86_64';
  }
  if (platform === 'win32') {
    return arch === 'arm64' ? 'windows-aarch64' : 'windows-x86_64';
  }
  return `${platform}-${arch}`;
}

/**
 * Downloads and extracts an agent binary distribution.
 * Returns the directory where the agent was extracted.
 */
async function downloadAndExtractAgent(
  agentId: string,
  archiveUrl: string,
): Promise<string> {
  const fs = require('fs') as typeof import('fs');
  const { execSync } =
    require('child_process') as typeof import('child_process');

  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const agentDir = path.join(homeDir, '.acp-composer', 'agents', agentId);

  fs.mkdirSync(agentDir, { recursive: true });

  const archiveName = path.basename(new URL(archiveUrl).pathname);
  const archivePath = path.join(agentDir, archiveName);

  // Download using curl (available on macOS, Linux, and modern Windows)
  execSync(`curl -fSL -o "${archivePath}" "${archiveUrl}"`, {
    timeout: 120000,
    stdio: 'pipe',
  });

  // Extract based on file type
  try {
    if (archiveName.endsWith('.tar.gz') || archiveName.endsWith('.tgz')) {
      execSync(`tar xzf "${archivePath}"`, { cwd: agentDir, timeout: 60000 });
    } else if (archiveName.endsWith('.tar.bz2')) {
      execSync(`tar xjf "${archivePath}"`, { cwd: agentDir, timeout: 60000 });
    } else if (archiveName.endsWith('.zip')) {
      if (process.platform === 'win32') {
        execSync(
          `powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${agentDir}' -Force"`,
          { timeout: 60000 },
        );
      } else {
        execSync(`unzip -o "${archivePath}" -d "${agentDir}"`, {
          timeout: 60000,
        });
      }
    }
  } finally {
    // Clean up archive file
    try {
      fs.unlinkSync(archivePath);
    } catch {
      // ignore cleanup errors
    }
  }

  return agentDir;
}

// ---------------------------------------------------------------------------
// Handle specific ACP stream messages on the extension-host side
// ---------------------------------------------------------------------------

function handleAcpMessage(msg: AcpStreamMessage): void {
  switch (msg.type) {
    case 'call_tool':
      handleToolCall(msg as AcpToolCall);
      break;
    case 'file_change':
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
