import * as vscode from "vscode";
import {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  ChatMessage,
  AcpStreamMessage,
  WorkspaceFileEntry,
} from "../types/protocol";
import { getNonce } from "../utils/nonce";

/**
 * ComposerViewProvider registers the sidebar webview that hosts the
 * Composer chat interface. It acts as the bridge between the webview
 * (HTML/JS) and the extension host (services).
 */
export class ComposerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "acpComposer.chatView";

  private view?: vscode.WebviewView;

  private readonly _onDidReceiveMessage =
    new vscode.EventEmitter<WebviewToExtensionMessage>();
  public readonly onDidReceiveMessage = this._onDidReceiveMessage.event;

  constructor(private readonly extensionUri: vscode.Uri) {}

  // -----------------------------------------------------------------------
  // WebviewViewProvider
  // -----------------------------------------------------------------------

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (message: WebviewToExtensionMessage) => {
        this._onDidReceiveMessage.fire(message);
      },
    );
  }

  // -----------------------------------------------------------------------
  // Messaging helpers (extension → webview)
  // -----------------------------------------------------------------------

  postMessage(message: ExtensionToWebviewMessage): void {
    this.view?.webview.postMessage(message);
  }

  addMessage(message: ChatMessage): void {
    this.postMessage({ type: "addMessage", message });
  }

  streamChunk(chunk: AcpStreamMessage): void {
    this.postMessage({ type: "streamChunk", chunk });
  }

  updateConnectionStatus(connected: boolean): void {
    this.postMessage({ type: "updateConnectionStatus", connected });
  }

  sendFileSearchResults(files: WorkspaceFileEntry[]): void {
    this.postMessage({ type: "fileSearchResults", files });
  }

  clearThread(): void {
    this.postMessage({ type: "threadCleared" });
  }

  sendError(message: string): void {
    this.postMessage({ type: "error", message });
  }

  // -----------------------------------------------------------------------
  // HTML generation
  // -----------------------------------------------------------------------

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';" />
  <title>ACP Composer</title>
  <style>
    /* ------------------------------------------------------------------ */
    /* Base reset & VS Code theme integration                             */
    /* ------------------------------------------------------------------ */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* ------------------------------------------------------------------ */
    /* Connection status bar                                               */
    /* ------------------------------------------------------------------ */
    .status-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border));
      gap: 8px;
    }
    .status-left {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    #connectButtons {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }
    .status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--vscode-testing-iconFailed, #f44);
      flex-shrink: 0;
    }
    .status-dot.connected { background: var(--vscode-testing-iconPassed, #4c4); }
    .status-connect-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
      cursor: pointer;
      margin-left: 6px;
    }
    .status-connect-btn:hover { background: var(--vscode-button-hoverBackground); }

    /* ------------------------------------------------------------------ */
    /* Messages area                                                       */
    /* ------------------------------------------------------------------ */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .message {
      max-width: 100%;
      padding: 10px 14px;
      border-radius: 8px;
      line-height: 1.5;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .message.user {
      align-self: flex-end;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 8px 8px 2px 8px;
    }
    .message.assistant {
      align-self: flex-start;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 8px 8px 8px 2px;
    }

    /* Context pills */
    .context-pills {
      display: flex; flex-wrap: wrap; gap: 4px;
      margin-bottom: 6px;
    }
    .context-pill {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .context-pill .remove {
      cursor: pointer; opacity: 0.7;
    }
    .context-pill .remove:hover { opacity: 1; }

    /* Thought chain (collapsible) */
    .thought-chain {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
    }
    .thought-toggle {
      cursor: pointer;
      user-select: none;
      display: flex; align-items: center; gap: 4px;
      font-weight: 500;
      margin-bottom: 4px;
    }
    .thought-content { padding-left: 16px; }
    .thought-content.collapsed { display: none; }

    /* Action card (tool calls) */
    .action-card {
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 6px;
      padding: 10px;
      margin: 6px 0;
      background: var(--vscode-editor-background);
    }
    .action-card .action-header {
      font-weight: 600;
      margin-bottom: 6px;
      display: flex; align-items: center; gap: 6px;
    }
    .action-card .action-params {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family);
      white-space: pre-wrap;
      margin-bottom: 8px;
    }
    .action-card .action-buttons {
      display: flex; gap: 6px;
    }

    /* Diff preview card */
    .diff-card {
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 6px;
      padding: 10px;
      margin: 6px 0;
      background: var(--vscode-editor-background);
    }
    .diff-card .diff-header {
      font-weight: 600;
      display: flex; align-items: center; gap: 6px;
      margin-bottom: 6px;
    }
    .diff-card .diff-file-path {
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    .diff-card .diff-buttons {
      display: flex; gap: 6px;
    }

    /* Status / progress */
    .status-update {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      padding: 4px 0;
    }
    .progress-bar-container {
      height: 3px;
      background: var(--vscode-progressBar-background, #333);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 4px;
    }
    .progress-bar-fill {
      height: 100%;
      background: var(--vscode-progressBar-background, var(--vscode-button-background));
      transition: width 0.3s ease;
    }

    /* Buttons */
    .btn {
      padding: 4px 12px;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

    /* ------------------------------------------------------------------ */
    /* File search dropdown                                                */
    /* ------------------------------------------------------------------ */
    .file-search-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0; right: 0;
      max-height: 200px;
      overflow-y: auto;
      background: var(--vscode-editorSuggestWidget-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-widget-border));
      border-radius: 6px 6px 0 0;
      display: none;
      z-index: 10;
    }
    .file-search-dropdown.visible { display: block; }
    .file-search-item {
      padding: 6px 12px;
      cursor: pointer;
      font-size: 12px;
      font-family: var(--vscode-editor-font-family);
      display: flex; align-items: center; gap: 6px;
    }
    .file-search-item:hover,
    .file-search-item.selected {
      background: var(--vscode-list-hoverBackground);
    }

    /* ------------------------------------------------------------------ */
    /* Input area                                                          */
    /* ------------------------------------------------------------------ */
    .input-area {
      position: relative;
      border-top: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border));
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .input-row {
      display: flex; gap: 6px; align-items: flex-end;
    }
    .input-area textarea {
      flex: 1;
      resize: none;
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 8px 10px;
      border-radius: 6px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      min-height: 38px;
      max-height: 120px;
      line-height: 1.4;
    }
    .input-area textarea:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    .input-area textarea::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
    .send-btn {
      padding: 8px 14px;
      border: none;
      border-radius: 6px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-size: 13px;
      flex-shrink: 0;
      height: 38px;
    }
    .send-btn:hover { background: var(--vscode-button-hoverBackground); }
    .send-btn:disabled { opacity: 0.5; cursor: default; }

    /* ------------------------------------------------------------------ */
    /* Welcome screen                                                      */
    /* ------------------------------------------------------------------ */
    .welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      gap: 12px;
      color: var(--vscode-descriptionForeground);
      text-align: center;
      padding: 24px;
    }
    .welcome h2 {
      color: var(--vscode-foreground);
      font-weight: 600;
    }
    .welcome p { max-width: 280px; line-height: 1.5; }
    .welcome kbd {
      padding: 2px 6px;
      border-radius: 3px;
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      background: var(--vscode-editor-background);
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
    }
  </style>
</head>
<body>
  <!-- Status bar -->
  <div class="status-bar">
    <div class="status-left">
      <div id="statusDot" class="status-dot"></div>
      <span id="statusText">Disconnected</span>
    </div>
    <div id="connectButtons">
      <button id="browseRegistryBtn" class="status-connect-btn">Browse Registry</button>
      <button id="connectQwenBtn" class="status-connect-btn">Connect Qwen Code</button>
    </div>
  </div>

  <!-- Messages -->
  <div id="messages" class="messages">
    <div id="welcome" class="welcome">
      <h2>ACP Composer</h2>
      <p>Your agentic coding companion. Type a message or use <kbd>@</kbd> to tag files.</p>
    </div>
  </div>

  <!-- Input -->
  <div class="input-area">
    <div id="fileSearchDropdown" class="file-search-dropdown"></div>
    <div id="inputContextPills" class="context-pills"></div>
    <div class="input-row">
      <textarea
        id="promptInput"
        placeholder="Ask anything... (@ to tag files)"
        rows="1"
      ></textarea>
      <button id="sendBtn" class="send-btn" title="Send message">&#9654;</button>
    </div>
  </div>

  <script nonce="${nonce}">
    // ====================================================================
    // Webview Script
    // ====================================================================
    (function () {
      const vscode = acquireVsCodeApi();

      // DOM refs
      const messagesEl = document.getElementById('messages');
      const welcomeEl = document.getElementById('welcome');
      const promptInput = document.getElementById('promptInput');
      const sendBtn = document.getElementById('sendBtn');
      const statusDot = document.getElementById('statusDot');
      const statusText = document.getElementById('statusText');
      const pillsContainer = document.getElementById('inputContextPills');
      const fileDropdown = document.getElementById('fileSearchDropdown');
      const connectQwenBtn = document.getElementById('connectQwenBtn');
      const browseRegistryBtn = document.getElementById('browseRegistryBtn');

      // Connect button handlers
      if (connectQwenBtn) {
        connectQwenBtn.addEventListener('click', () => {
          vscode.postMessage({ command: 'connectQwenCode' });
        });
      }

      if (browseRegistryBtn) {
        browseRegistryBtn.addEventListener('click', () => {
          vscode.postMessage({ command: 'browseRegistry' });
        });
      }

      // State
      let contextFiles = [];
      let isStreaming = false;
      let currentStreamEl = null;
      let searchResults = [];
      let selectedSearchIdx = -1;

      // ----------------------------------------------------------------
      // Sending messages
      // ----------------------------------------------------------------
      function sendMessage() {
        const text = promptInput.value.trim();
        if (!text && contextFiles.length === 0) return;

        vscode.postMessage({
          command: 'sendMessage',
          text,
          contextFiles: contextFiles,
        });

        appendMessage('user', text, contextFiles);
        promptInput.value = '';
        contextFiles = [];
        renderPills();
        autoResizeInput();
        hideWelcome();
      }

      sendBtn.addEventListener('click', sendMessage);
      promptInput.addEventListener('keydown', (e) => {
        if (fileDropdown.classList.contains('visible')) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedSearchIdx = Math.min(selectedSearchIdx + 1, searchResults.length - 1);
            highlightSearchItem();
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedSearchIdx = Math.max(selectedSearchIdx - 1, 0);
            highlightSearchItem();
            return;
          }
          if (e.key === 'Enter' && selectedSearchIdx >= 0) {
            e.preventDefault();
            selectSearchItem(searchResults[selectedSearchIdx]);
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            hideFileSearch();
            return;
          }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });

      // ----------------------------------------------------------------
      // @ file search
      // ----------------------------------------------------------------
      promptInput.addEventListener('input', () => {
        autoResizeInput();
        const val = promptInput.value;
        const atIdx = val.lastIndexOf('@');
        if (atIdx >= 0) {
          const query = val.slice(atIdx + 1);
          if (!query.includes(' ')) {
            vscode.postMessage({ command: 'requestFileSearch', query });
            return;
          }
        }
        hideFileSearch();
      });

      function showFileSearch(files) {
        searchResults = files;
        selectedSearchIdx = files.length > 0 ? 0 : -1;
        fileDropdown.innerHTML = '';
        if (files.length === 0) {
          hideFileSearch();
          return;
        }
        files.forEach((f, i) => {
          const item = document.createElement('div');
          item.className = 'file-search-item' + (i === 0 ? ' selected' : '');
          item.textContent = f.relativePath;
          item.addEventListener('click', () => selectSearchItem(f));
          fileDropdown.appendChild(item);
        });
        fileDropdown.classList.add('visible');
      }

      function hideFileSearch() {
        fileDropdown.classList.remove('visible');
        searchResults = [];
        selectedSearchIdx = -1;
      }

      function highlightSearchItem() {
        const items = fileDropdown.querySelectorAll('.file-search-item');
        items.forEach((it, i) => it.classList.toggle('selected', i === selectedSearchIdx));
      }

      function selectSearchItem(file) {
        const val = promptInput.value;
        const atIdx = val.lastIndexOf('@');
        if (atIdx >= 0) {
          promptInput.value = val.slice(0, atIdx);
        }
        contextFiles.push({
          filePath: file.absolutePath,
          label: file.relativePath,
          languageId: file.languageId,
        });
        renderPills();
        hideFileSearch();
        promptInput.focus();
      }

      // ----------------------------------------------------------------
      // Context pills
      // ----------------------------------------------------------------
      function renderPills() {
        pillsContainer.innerHTML = '';
        contextFiles.forEach((f, idx) => {
          const pill = document.createElement('span');
          pill.className = 'context-pill';
          pill.innerHTML = '@' + escapeHtml(f.label)
            + ' <span class="remove" data-idx="' + idx + '">&times;</span>';
          pill.querySelector('.remove').addEventListener('click', () => {
            contextFiles.splice(idx, 1);
            renderPills();
          });
          pillsContainer.appendChild(pill);
        });
      }

      // ----------------------------------------------------------------
      // Rendering messages
      // ----------------------------------------------------------------
      function appendMessage(role, content, ctxFiles) {
        hideWelcome();
        const el = document.createElement('div');
        el.className = 'message ' + role;

        if (ctxFiles && ctxFiles.length > 0) {
          const pills = document.createElement('div');
          pills.className = 'context-pills';
          ctxFiles.forEach((f) => {
            const pill = document.createElement('span');
            pill.className = 'context-pill';
            pill.textContent = '@' + f.label;
            pills.appendChild(pill);
          });
          el.appendChild(pills);
        }

        const textNode = document.createElement('div');
        textNode.innerHTML = escapeHtml(content);
        el.appendChild(textNode);
        messagesEl.appendChild(el);
        scrollToBottom();
        return el;
      }

      function appendStreamStart() {
        hideWelcome();
        const el = document.createElement('div');
        el.className = 'message assistant';
        messagesEl.appendChild(el);
        currentStreamEl = el;
        isStreaming = true;
        scrollToBottom();
        return el;
      }

      function appendStreamChunk(chunk) {
        if (!currentStreamEl) appendStreamStart();

        switch (chunk.type) {
          case 'text':
            appendTextToStream(chunk.content);
            if (chunk.done) {
              isStreaming = false;
              currentStreamEl = null;
            }
            break;
          case 'thought':
            appendThought(chunk.content);
            break;
          case 'call_tool':
            appendActionCard(chunk);
            break;
          case 'file_change':
            appendDiffCard(chunk);
            break;
          case 'status':
            appendStatus(chunk);
            break;
        }
        scrollToBottom();
      }

      function appendTextToStream(text) {
        if (!currentStreamEl) return;
        let textEl = currentStreamEl.querySelector('.stream-text');
        if (!textEl) {
          textEl = document.createElement('div');
          textEl.className = 'stream-text';
          currentStreamEl.appendChild(textEl);
        }
        textEl.innerHTML += escapeHtml(text);
      }

      function appendThought(content) {
        if (!currentStreamEl) return;
        let chain = currentStreamEl.querySelector('.thought-chain');
        if (!chain) {
          chain = document.createElement('div');
          chain.className = 'thought-chain';
          const toggle = document.createElement('div');
          toggle.className = 'thought-toggle';
          toggle.innerHTML = '&#9662; Thoughts';
          const contentEl = document.createElement('div');
          contentEl.className = 'thought-content';
          toggle.addEventListener('click', () => {
            contentEl.classList.toggle('collapsed');
            toggle.innerHTML = contentEl.classList.contains('collapsed')
              ? '&#9656; Thoughts' : '&#9662; Thoughts';
          });
          chain.appendChild(toggle);
          chain.appendChild(contentEl);
          currentStreamEl.insertBefore(chain, currentStreamEl.firstChild);
        }
        const contentEl = chain.querySelector('.thought-content');
        const p = document.createElement('p');
        p.textContent = content;
        contentEl.appendChild(p);
      }

      function appendActionCard(toolCall) {
        if (!currentStreamEl) return;
        const card = document.createElement('div');
        card.className = 'action-card';
        card.innerHTML =
          '<div class="action-header">&#9881; ' + escapeHtml(toolCall.displayName || toolCall.name) + '</div>'
          + '<div class="action-params">' + escapeHtml(JSON.stringify(toolCall.parameters, null, 2)) + '</div>'
          + '<div class="action-buttons">'
          + '  <button class="btn btn-primary" data-action="approve" data-id="' + toolCall.id + '">Allow</button>'
          + '  <button class="btn btn-secondary" data-action="reject" data-id="' + toolCall.id + '">Deny</button>'
          + '</div>';
        card.querySelector('[data-action="approve"]').addEventListener('click', () => {
          vscode.postMessage({ command: 'approveToolCall', callId: toolCall.id });
          card.querySelector('.action-buttons').innerHTML = '<span style="color:var(--vscode-testing-iconPassed)">Approved</span>';
        });
        card.querySelector('[data-action="reject"]').addEventListener('click', () => {
          vscode.postMessage({ command: 'rejectToolCall', callId: toolCall.id });
          card.querySelector('.action-buttons').innerHTML = '<span style="color:var(--vscode-testing-iconFailed)">Denied</span>';
        });
        currentStreamEl.appendChild(card);
      }

      function appendDiffCard(change) {
        if (!currentStreamEl) return;
        const card = document.createElement('div');
        card.className = 'diff-card';
        card.innerHTML =
          '<div class="diff-header">&#128196; File Change</div>'
          + '<div class="diff-file-path">' + escapeHtml(change.filePath) + '</div>'
          + (change.description ? '<div style="font-size:12px;margin-bottom:8px">' + escapeHtml(change.description) + '</div>' : '')
          + '<div class="diff-buttons">'
          + '  <button class="btn btn-primary" data-action="apply" data-id="' + change.id + '">Apply</button>'
          + '  <button class="btn btn-secondary" data-action="reject" data-id="' + change.id + '">Reject</button>'
          + '</div>';
        card.querySelector('[data-action="apply"]').addEventListener('click', () => {
          vscode.postMessage({ command: 'applyFileChange', changeId: change.id });
          card.querySelector('.diff-buttons').innerHTML = '<span style="color:var(--vscode-testing-iconPassed)">Applied</span>';
        });
        card.querySelector('[data-action="reject"]').addEventListener('click', () => {
          vscode.postMessage({ command: 'rejectFileChange', changeId: change.id });
          card.querySelector('.diff-buttons').innerHTML = '<span style="color:var(--vscode-testing-iconFailed)">Rejected</span>';
        });
        currentStreamEl.appendChild(card);
      }

      function appendStatus(status) {
        if (!currentStreamEl) return;
        let statusEl = currentStreamEl.querySelector('.status-update');
        if (!statusEl) {
          statusEl = document.createElement('div');
          statusEl.className = 'status-update';
          currentStreamEl.appendChild(statusEl);
        }
        statusEl.textContent = status.message;
        if (typeof status.progress === 'number') {
          let bar = statusEl.querySelector('.progress-bar-container');
          if (!bar) {
            bar = document.createElement('div');
            bar.className = 'progress-bar-container';
            bar.innerHTML = '<div class="progress-bar-fill" style="width:0%"></div>';
            statusEl.appendChild(bar);
          }
          bar.querySelector('.progress-bar-fill').style.width = status.progress + '%';
        }
      }

      // ----------------------------------------------------------------
      // Helpers
      // ----------------------------------------------------------------
      function hideWelcome() {
        if (welcomeEl) welcomeEl.style.display = 'none';
      }

      function scrollToBottom() {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      function autoResizeInput() {
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
      }

      function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      // ----------------------------------------------------------------
      // Messages from extension host
      // ----------------------------------------------------------------
      window.addEventListener('message', (event) => {
        const msg = event.data;
        switch (msg.type) {
          case 'addMessage':
            if (msg.message.role === 'assistant') {
              appendStreamStart();
              appendTextToStream(msg.message.content);
              isStreaming = false;
              currentStreamEl = null;
            } else {
              appendMessage(msg.message.role, msg.message.content, msg.message.contextFiles);
            }
            break;
          case 'streamChunk':
            appendStreamChunk(msg.chunk);
            break;
          case 'updateConnectionStatus':
            statusDot.classList.toggle('connected', msg.connected);
            statusText.textContent = msg.connected ? 'Connected' : 'Disconnected';
            // Hide connect buttons when connected, show when disconnected
            if (connectQwenBtn) {
              connectQwenBtn.style.display = msg.connected ? 'none' : 'inline-block';
            }
            if (browseRegistryBtn) {
              browseRegistryBtn.style.display = msg.connected ? 'none' : 'inline-block';
            }
            break;
          case 'fileSearchResults':
            showFileSearch(msg.files);
            break;
          case 'threadCleared':
            messagesEl.innerHTML = '';
            if (welcomeEl) {
              messagesEl.appendChild(welcomeEl);
              welcomeEl.style.display = '';
            }
            contextFiles = [];
            renderPills();
            break;
          case 'error':
            const errEl = document.createElement('div');
            errEl.className = 'message assistant';
            errEl.style.borderColor = 'var(--vscode-testing-iconFailed)';
            errEl.textContent = msg.message;
            messagesEl.appendChild(errEl);
            scrollToBottom();
            break;
        }
      });

      // Tell extension we are ready
      vscode.postMessage({ command: 'ready' });
    })();
  </script>
</body>
</html>`;
  }
}
