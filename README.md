# ACP Composer

A Cursor-like agentic experience for VS Code via the **Agent Client Protocol (ACP)**.

## Overview

ACP Composer brings AI-powered coding assistance to VS Code by connecting to ACP-compatible agents. It enables interactive chat-based development where AI agents can understand your codebase, reason about changes, and apply modifications directly to your files—with your approval.

## Features

- **AI Chat Interface**: Interactive sidebar chat for conversing with AI coding agents
- **Smart Context**: Automatic workspace file indexing for context-aware responses
- **Code Changes Preview**: Review and approve/reject suggested file modifications before applying
- **Multiple Connection Options**:
  - Connect to a WebSocket-based ACP server
  - Connect to Qwen Code CLI in ACP mode
  - Browse and connect to agents from the ACP registry
- **Flexible Execution Policies**:
  - **Strict**: Every tool call requires explicit approval
  - **Autonomous**: Read-only tools auto-approved; write tools require approval
- **Agent Thought Visibility**: See the reasoning chain behind AI decisions
- **Keyboard Shortcut**: Quick access with `Cmd+I` (macOS) or `Ctrl+I` (Windows/Linux)

## Requirements

- VS Code 1.85.0 or higher
- For Qwen Code CLI integration: `qwen` must be installed and available in your PATH

## Usage

### Opening Composer

1. Click the ACP Composer icon in the Activity Bar, or
2. Press `Cmd+I` (macOS) or `Ctrl+I` (Windows/Linux)

### Connecting to an Agent

#### Option 1: Qwen Code CLI

1. Run the command: **ACP Composer: Connect to Qwen Code CLI**
2. Ensure `qwen` is installed and configured

#### Option 2: Custom ACP Server

1. Configure the server URL in settings (`acpComposer.serverUrl`)
2. Run the command: **ACP Composer: Connect to Server**

#### Option 3: ACP Registry

1. Run the command: **ACP Composer: Connect to Registry Agent**
2. Select an agent from the registry list

### Chatting with the Agent

1. Type your question or request in the chat input
2. Attach context files if needed (search and select from workspace)
3. The agent will respond with reasoning and suggestions
4. Review any suggested file changes
5. Click **Apply** to accept changes or **Reject** to decline

### Managing Threads

- **New Thread**: Run **ACP Composer: New Thread** to start a fresh conversation
- File change tracking is cleared when starting a new thread

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `acpComposer.serverUrl` | `ws://localhost:3000` | WebSocket URL of the ACP server |
| `acpComposer.qwenCodePath` | `qwen` | Path or command to run Qwen Code CLI |
| `acpComposer.qwenCodeArgs` | `[]` | Additional arguments for Qwen Code CLI |
| `acpComposer.executionPolicy` | `autonomous` | Tool call approval policy (`strict` or `autonomous`) |
| `acpComposer.showThoughts` | `true` | Show agent thought chain by default |

## Commands

| Command | Description |
|---------|-------------|
| `acpComposer.focus` | Focus the Composer chat view |
| `acpComposer.newThread` | Start a new conversation thread |
| `acpComposer.connectServer` | Connect to a WebSocket ACP server |
| `acpComposer.disconnectServer` | Disconnect from the current server |
| `acpComposer.connectQwenCode` | Connect to Qwen Code CLI in ACP mode |
| `acpComposer.connectRegistryAgent` | Browse and connect to a registry agent |
| `acpComposer.browseRegistry` | Browse available ACP agents |
| `acpComposer.applyDiff` | Apply a suggested file change |
| `acpComposer.rejectDiff` | Reject a suggested file change |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    VS Code Extension                     │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌──────────────────────────┐   │
│  │  Composer       │    │  Extension Host          │   │
│  │  ViewProvider   │◄──►│  - AcpClient             │   │
│  │  (Webview)      │    │  - ToolExecutionManager  │   │
│  └─────────────────┘    │  - ContextProvider       │   │
│                         │  - DiffProvider          │   │
│                         │  - AcpRegistryService    │   │
│                         └──────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────┐
│  ACP Server     │ │  Qwen Code CLI  │ │  ACP        │
│  (WebSocket)    │ │  (stdio)        │ │  Registry   │
└─────────────────┘ └─────────────────┘ └─────────────┘
```

### Key Components

- **AcpClient**: Manages WebSocket/stdio connections and JSON-RPC message framing
- **ComposerViewProvider**: Renders the chat UI in a webview
- **ContextProvider**: Indexes workspace files for context resolution
- **DiffProvider**: Manages file change previews and application
- **ToolExecutionManager**: Evaluates and handles tool call approvals
- **AcpRegistryService**: Fetches and manages ACP agent registry

## Development

### Prerequisites

- Node.js and npm
- VS Code Extension Development Kit

### Setup

```bash
# Install dependencies
pnpm install
```

### Build

```bash
# Production build
pnpm run build

# Development build with watch
pnpm run dev
```

### Linting

```bash
pnpm run lint
```

### Debugging

1. Press `F5` to launch the Extension Development Host
2. The extension will activate automatically
3. Use the Composer view to test functionality

### Quick Install

Use the provided script to build and install the extension:

```bash
./scripts/install.sh
```

This will:
1. Install dependencies with pnpm
2. Build the extension
3. Package it as a `.vsix` file
4. Install it to VS Code

## License

[Specify your license here]

## Contributing

[Add contribution guidelines if applicable]

## Acknowledgments

- Built on the **Agent Client Protocol (ACP)** specification
- Inspired by Cursor's agentic coding experience
