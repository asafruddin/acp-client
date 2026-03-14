import * as vscode from 'vscode';
import {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  ChatMessage,
  AcpStreamMessage,
  WorkspaceFileEntry,
  ContextFile,
  ChatMode,
} from '../types/protocol';
import { getNonce } from '../utils/nonce';

/**
 * ComposerViewProvider registers the sidebar webview that hosts the
 * Composer chat interface. It acts as the bridge between the webview
 * (HTML/JS) and the extension host (services).
 */
export class ComposerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'acpComposer.chatView';

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
    this.postMessage({ type: 'addMessage', message });
  }

  streamChunk(chunk: AcpStreamMessage): void {
    this.postMessage({ type: 'streamChunk', chunk });
  }

  updateConnectionStatus(connected: boolean, agentName?: string): void {
    this.postMessage({ type: 'updateConnectionStatus', connected, agentName });
  }

  sendFileSearchResults(files: WorkspaceFileEntry[]): void {
    this.postMessage({ type: 'fileSearchResults', files });
  }

  clearThread(): void {
    this.postMessage({ type: 'threadCleared' });
  }

  sendError(message: string): void {
    this.postMessage({ type: 'error', message });
  }

  addContextFile(file: ContextFile): void {
    this.postMessage({ type: 'addContextFile', file });
  }

  notifyModelChanged(modelId: string): void {
    this.postMessage({ type: 'modelChanged', modelId });
  }

  notifyModeChanged(mode: ChatMode): void {
    this.postMessage({ type: 'modeChanged', mode });
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
             img-src data: ${webview.cspSource};
             script-src 'nonce-${nonce}';" />
  <title>ACP Composer</title>
  <style>
    /* ------------------------------------------------------------------ */
    /* Base reset & VS Code theme integration                              */
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
      padding: 5px 10px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border));
      gap: 6px;
      flex-shrink: 0;
    }
    .status-left {
      display: flex; align-items: center; gap: 5px; min-width: 0;
    }
    .status-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--vscode-testing-iconFailed, #f44);
      flex-shrink: 0;
    }
    .status-dot.connected { background: var(--vscode-testing-iconPassed, #4c4); }
    #statusText { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #connectButtons { display: flex; gap: 5px; flex-shrink: 0; }
    .status-connect-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; border-radius: 3px;
      padding: 2px 7px; font-size: 11px; cursor: pointer;
    }
    .status-connect-btn:hover { background: var(--vscode-button-hoverBackground); }

    /* ------------------------------------------------------------------ */
    /* Mode selector bar                                                   */
    /* ------------------------------------------------------------------ */
    .mode-bar {
      display: flex; align-items: center; gap: 4px;
      padding: 4px 10px;
      border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border));
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .mode-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-right: 2px; }
    .mode-pill {
      padding: 2px 9px; border-radius: 10px; font-size: 11px; cursor: pointer;
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      background: transparent; color: var(--vscode-foreground);
      transition: background 0.15s;
    }
    .mode-pill:hover { background: var(--vscode-list-hoverBackground); }
    .mode-pill.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }

    /* ------------------------------------------------------------------ */
    /* Model selector                                                      */
    /* ------------------------------------------------------------------ */
    .model-bar {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 10px;
      border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border));
      flex-shrink: 0;
    }
    .model-bar label { font-size: 11px; color: var(--vscode-descriptionForeground); }
    #modelInput {
      flex: 1; min-width: 0;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
      border-radius: 3px;
      padding: 2px 6px; font-size: 11px;
      font-family: var(--vscode-font-family);
    }
    #modelInput:focus { outline: none; border-color: var(--vscode-focusBorder); }
    #modelInput::placeholder { color: var(--vscode-input-placeholderForeground); }

    /* ------------------------------------------------------------------ */
    /* Messages area                                                       */
    /* ------------------------------------------------------------------ */
    .messages {
      flex: 1; overflow-y: auto;
      padding: 10px; display: flex; flex-direction: column; gap: 10px;
    }
    .message {
      max-width: 100%; padding: 9px 13px; border-radius: 8px;
      line-height: 1.55; word-wrap: break-word;
    }
    .message.user {
      align-self: flex-end;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 8px 8px 2px 8px;
    }
    .message.assistant {
      align-self: flex-start; width: 100%;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 8px 8px 8px 2px;
    }

    /* Markdown-style rendering */
    .stream-text pre {
      background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 4px; padding: 8px 10px; margin: 6px 0;
      overflow-x: auto; font-family: var(--vscode-editor-font-family);
      font-size: 12px; white-space: pre;
    }
    .stream-text code {
      font-family: var(--vscode-editor-font-family); font-size: 12px;
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1));
      padding: 1px 4px; border-radius: 3px;
    }
    .stream-text p { margin: 4px 0; }
    .stream-text ul, .stream-text ol { padding-left: 18px; margin: 4px 0; }
    .stream-text li { margin: 2px 0; }

    /* Context pills (in message & input) */
    .context-pills { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 5px; }
    .context-pill {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 2px 7px; border-radius: 12px; font-size: 11px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground); max-width: 180px;
    }
    .context-pill .pill-icon { flex-shrink: 0; }
    .context-pill .pill-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .context-pill .remove { cursor: pointer; opacity: 0.7; flex-shrink: 0; }
    .context-pill .remove:hover { opacity: 1; }
    .context-pill.image-pill img {
      width: 20px; height: 20px; object-fit: cover; border-radius: 2px;
    }

    /* Thought chain */
    .thought-chain { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 5px; }
    .thought-toggle { cursor: pointer; user-select: none; display: flex; align-items: center; gap: 4px; font-weight: 500; margin-bottom: 4px; }
    .thought-content { padding-left: 14px; }
    .thought-content.collapsed { display: none; }

    /* Action card */
    .action-card {
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 5px; padding: 8px; margin: 5px 0;
      background: var(--vscode-editor-background);
    }
    .action-card .action-header { font-weight: 600; margin-bottom: 5px; display: flex; align-items: center; gap: 5px; }
    .action-card .action-params {
      font-size: 11px; color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family); white-space: pre-wrap; margin-bottom: 7px;
      max-height: 100px; overflow-y: auto;
    }
    .action-card .action-buttons { display: flex; gap: 5px; }

    /* Diff card */
    .diff-card {
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 5px; padding: 8px; margin: 5px 0;
      background: var(--vscode-editor-background);
    }
    .diff-card .diff-header { font-weight: 600; display: flex; align-items: center; gap: 5px; margin-bottom: 5px; }
    .diff-card .diff-file-path { font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 7px; }
    .diff-card .diff-buttons { display: flex; gap: 5px; }

    /* Status */
    .status-update { font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic; padding: 3px 0; }
    .progress-bar-container { height: 2px; background: var(--vscode-progressBar-background, #333); border-radius: 1px; overflow: hidden; margin-top: 3px; }
    .progress-bar-fill { height: 100%; background: var(--vscode-button-background); transition: width 0.3s; }

    /* Buttons */
    .btn { padding: 3px 10px; border: none; border-radius: 3px; font-size: 11px; cursor: pointer; font-family: var(--vscode-font-family); }
    .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

    /* ------------------------------------------------------------------ */
    /* File search dropdown                                                */
    /* ------------------------------------------------------------------ */
    .file-search-dropdown {
      position: absolute; bottom: 100%; left: 0; right: 0;
      max-height: 180px; overflow-y: auto;
      background: var(--vscode-editorSuggestWidget-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-widget-border));
      border-radius: 5px 5px 0 0; display: none; z-index: 10;
    }
    .file-search-dropdown.visible { display: block; }
    .file-search-item {
      padding: 5px 10px; cursor: pointer; font-size: 11px;
      font-family: var(--vscode-editor-font-family);
      display: flex; align-items: center; gap: 5px;
    }
    .file-search-item:hover, .file-search-item.selected { background: var(--vscode-list-hoverBackground); }

    /* ------------------------------------------------------------------ */
    /* Input area                                                          */
    /* ------------------------------------------------------------------ */
    .input-area {
      position: relative; flex-shrink: 0;
      border-top: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border));
      padding: 8px 10px; display: flex; flex-direction: column; gap: 5px;
    }
    .input-row { display: flex; gap: 5px; align-items: flex-end; }
    .input-area textarea {
      flex: 1; resize: none;
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      padding: 6px 8px; border-radius: 5px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
      min-height: 36px; max-height: 120px; line-height: 1.4;
    }
    .input-area textarea:focus { outline: none; border-color: var(--vscode-focusBorder); }
    .input-area textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
    .send-btn {
      padding: 6px 12px; border: none; border-radius: 5px;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      cursor: pointer; font-size: 13px; flex-shrink: 0; height: 36px;
    }
    .send-btn:hover { background: var(--vscode-button-hoverBackground); }
    .send-btn:disabled { opacity: 0.45; cursor: default; }

    /* Attachment toolbar */
    .attach-bar {
      display: flex; align-items: center; gap: 4px;
    }
    .attach-btn {
      display: flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 4px; border: none;
      background: transparent; color: var(--vscode-foreground);
      cursor: pointer; opacity: 0.65; font-size: 14px;
    }
    .attach-btn:hover { background: var(--vscode-list-hoverBackground); opacity: 1; }
    .attach-btn title { display: none; }

    /* ------------------------------------------------------------------ */
    /* Welcome screen                                                      */
    /* ------------------------------------------------------------------ */
    .welcome {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; flex: 1; gap: 10px;
      color: var(--vscode-descriptionForeground); text-align: center; padding: 20px;
    }
    .welcome h2 { color: var(--vscode-foreground); font-weight: 600; font-size: 15px; }
    .welcome p { max-width: 260px; line-height: 1.5; font-size: 12px; }
    .welcome kbd {
      padding: 1px 5px; border-radius: 3px;
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      background: var(--vscode-editor-background);
      font-family: var(--vscode-editor-font-family); font-size: 11px;
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
      <button id="connectQwenBtn" class="status-connect-btn">Qwen Code</button>
    </div>
  </div>

  <!-- Mode selector -->
  <div class="mode-bar">
    <span class="mode-label">Mode:</span>
    <button class="mode-pill active" data-mode="default">Default</button>
    <button class="mode-pill" data-mode="plan">Plan</button>
    <button class="mode-pill" data-mode="yolo">Yolo</button>
    <button class="mode-pill" data-mode="auto">Auto</button>
  </div>

  <!-- Model selector -->
  <div class="model-bar">
    <label for="modelInput">Model:</label>
    <input id="modelInput" type="text" placeholder="e.g. gpt-4o, claude-3-5-sonnet (optional)" />
  </div>

  <!-- Messages -->
  <div id="messages" class="messages">
    <div id="welcome" class="welcome">
      <h2>ACP Composer</h2>
      <p>Connect to an agent, then type a message or use <kbd>@</kbd> to tag files. Attach images with 📎 or paste from clipboard.</p>
    </div>
  </div>

  <!-- Input -->
  <div class="input-area">
    <div id="fileSearchDropdown" class="file-search-dropdown"></div>
    <div id="inputContextPills" class="context-pills"></div>
    <div class="attach-bar">
      <button class="attach-btn" id="attachFileBtn" title="Attach file">📄</button>
      <button class="attach-btn" id="attachDirBtn" title="Attach directory">📁</button>
      <button class="attach-btn" id="attachImageBtn" title="Attach image">🖼️</button>
    </div>
    <div class="input-row">
      <textarea
        id="promptInput"
        placeholder="Ask anything… (@ to tag files, paste image)"
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
      'use strict';
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
      const modelInput = document.getElementById('modelInput');
      const attachFileBtn = document.getElementById('attachFileBtn');
      const attachDirBtn = document.getElementById('attachDirBtn');
      const attachImageBtn = document.getElementById('attachImageBtn');

      // ---- Connection button handlers ----
      connectQwenBtn && connectQwenBtn.addEventListener('click', () => vscode.postMessage({ command: 'connectQwenCode' }));
      browseRegistryBtn && browseRegistryBtn.addEventListener('click', () => vscode.postMessage({ command: 'browseRegistry' }));

      // ---- Mode selector ----
      let currentMode = 'default';
      document.querySelectorAll('.mode-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.mode-pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentMode = btn.dataset.mode;
          vscode.postMessage({ command: 'setMode', mode: currentMode });
        });
      });

      // ---- Model input (debounced) ----
      let modelDebounce = null;
      modelInput && modelInput.addEventListener('input', () => {
        clearTimeout(modelDebounce);
        modelDebounce = setTimeout(() => {
          const val = modelInput.value.trim();
          vscode.postMessage({ command: 'setModel', modelId: val });
        }, 600);
      });

      // ---- Attachment buttons ----
      attachFileBtn && attachFileBtn.addEventListener('click', () => vscode.postMessage({ command: 'requestAttachFile' }));
      attachDirBtn && attachDirBtn.addEventListener('click', () => vscode.postMessage({ command: 'requestAttachDirectory' }));
      attachImageBtn && attachImageBtn.addEventListener('click', () => vscode.postMessage({ command: 'requestAttachFile' }));

      // ---- Image paste from clipboard ----
      document.addEventListener('paste', (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            const blob = item.getAsFile();
            if (!blob) continue;
            const mimeType = item.type;
            const reader = new FileReader();
            reader.onload = (ev) => {
              const dataUrl = ev.target.result;
              const label = 'pasted-image-' + Date.now() + '.png';
              // Add as a context file directly in the webview
              contextFiles.push({
                filePath: label,
                label,
                type: 'image',
                content: dataUrl,
                mimeType,
              });
              renderPills();
            };
            reader.readAsDataURL(blob);
          }
        }
      });

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

        const modelVal = modelInput ? modelInput.value.trim() : '';
        vscode.postMessage({
          command: 'sendMessage',
          text,
          contextFiles: contextFiles.slice(),
          model: modelVal || undefined,
          mode: currentMode !== 'default' ? currentMode : undefined,
        });

        appendMessage('user', text, contextFiles.slice());
        promptInput.value = '';
        contextFiles = [];
        renderPills();
        autoResizeInput();
        hideWelcome();
      }

      sendBtn.addEventListener('click', sendMessage);
      promptInput.addEventListener('keydown', (e) => {
        if (fileDropdown.classList.contains('visible')) {
          if (e.key === 'ArrowDown') { e.preventDefault(); selectedSearchIdx = Math.min(selectedSearchIdx + 1, searchResults.length - 1); highlightSearchItem(); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); selectedSearchIdx = Math.max(selectedSearchIdx - 1, 0); highlightSearchItem(); return; }
          if (e.key === 'Enter' && selectedSearchIdx >= 0) { e.preventDefault(); selectSearchItem(searchResults[selectedSearchIdx]); return; }
          if (e.key === 'Escape') { e.preventDefault(); hideFileSearch(); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
      });

      // ----------------------------------------------------------------
      // @ file search
      // ----------------------------------------------------------------
      promptInput.addEventListener('input', () => {
        autoResizeInput();
        const val = promptInput.value;
        const atIdx = val.lastIndexOf('@');
        if (atIdx >= 0 && !val.slice(atIdx + 1).includes(' ')) {
          vscode.postMessage({ command: 'requestFileSearch', query: val.slice(atIdx + 1) });
          return;
        }
        hideFileSearch();
      });

      function showFileSearch(files) {
        searchResults = files;
        selectedSearchIdx = files.length > 0 ? 0 : -1;
        fileDropdown.innerHTML = '';
        if (files.length === 0) { hideFileSearch(); return; }
        files.forEach((f, i) => {
          const item = document.createElement('div');
          item.className = 'file-search-item' + (i === 0 ? ' selected' : '');
          item.textContent = f.relativePath;
          item.addEventListener('click', () => selectSearchItem(f));
          fileDropdown.appendChild(item);
        });
        fileDropdown.classList.add('visible');
      }

      function hideFileSearch() { fileDropdown.classList.remove('visible'); searchResults = []; selectedSearchIdx = -1; }

      function highlightSearchItem() {
        fileDropdown.querySelectorAll('.file-search-item').forEach((it, i) => it.classList.toggle('selected', i === selectedSearchIdx));
      }

      function selectSearchItem(file) {
        const val = promptInput.value;
        const atIdx = val.lastIndexOf('@');
        if (atIdx >= 0) promptInput.value = val.slice(0, atIdx);
        contextFiles.push({ filePath: file.absolutePath, label: file.relativePath, type: 'file', languageId: file.languageId });
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
          pill.className = 'context-pill' + (f.type === 'image' ? ' image-pill' : '');

          let icon = '';
          if (f.type === 'image') {
            icon = '<img src="' + escapeAttr(f.content || '') + '" />';
          } else if (f.type === 'directory') {
            icon = '<span class="pill-icon">📁</span>';
          } else {
            icon = '<span class="pill-icon">📄</span>';
          }

          pill.innerHTML = icon
            + '<span class="pill-label">' + escapeHtml(f.label) + '</span>'
            + '<span class="remove" data-idx="' + idx + '">&times;</span>';
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
            pill.className = 'context-pill' + (f.type === 'image' ? ' image-pill' : '');
            if (f.type === 'image') {
              pill.innerHTML = '<img src="' + escapeAttr(f.content || '') + '" /><span class="pill-label">' + escapeHtml(f.label) + '</span>';
            } else {
              pill.innerHTML = (f.type === 'directory' ? '📁' : '📄') + ' <span class="pill-label">' + escapeHtml(f.label) + '</span>';
            }
            pills.appendChild(pill);
          });
          el.appendChild(pills);
        }

        const textNode = document.createElement('div');
        textNode.innerHTML = renderMarkdown(content);
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
            if (chunk.done) { isStreaming = false; currentStreamEl = null; }
            break;
          case 'thought': appendThought(chunk.content); break;
          case 'call_tool': appendActionCard(chunk); break;
          case 'file_change': appendDiffCard(chunk); break;
          case 'status': appendStatus(chunk); break;
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
        // Accumulate raw text and re-render as markdown
        textEl.dataset.raw = (textEl.dataset.raw || '') + text;
        textEl.innerHTML = renderMarkdown(textEl.dataset.raw);
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
          contentEl.className = 'thought-content collapsed';
          toggle.addEventListener('click', () => {
            contentEl.classList.toggle('collapsed');
            toggle.innerHTML = contentEl.classList.contains('collapsed') ? '&#9656; Thoughts' : '&#9662; Thoughts';
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
          + '  <button class="btn btn-primary" data-action="approve" data-id="' + escapeAttr(toolCall.id) + '">Allow</button>'
          + '  <button class="btn btn-secondary" data-action="reject" data-id="' + escapeAttr(toolCall.id) + '">Deny</button>'
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
          + (change.description ? '<div style="font-size:11px;margin-bottom:7px">' + escapeHtml(change.description) + '</div>' : '')
          + '<div class="diff-buttons">'
          + '  <button class="btn btn-primary" data-action="apply" data-id="' + escapeAttr(change.id) + '">Apply</button>'
          + '  <button class="btn btn-secondary" data-action="reject" data-id="' + escapeAttr(change.id) + '">Reject</button>'
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
      // Simple Markdown renderer
      // ----------------------------------------------------------------
      function renderMarkdown(text) {
        if (!text) return '';
        let html = '';
        const lines = text.split('\\n');
        let inCode = false;
        let codeLang = '';
        let codeLines = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!inCode && line.startsWith('\`\`\`')) {
            inCode = true;
            codeLang = line.slice(3).trim();
            codeLines = [];
          } else if (inCode && line.startsWith('\`\`\`')) {
            inCode = false;
            html += '<pre><code class="lang-' + escapeHtml(codeLang) + '">' + escapeHtml(codeLines.join('\\n')) + '</code></pre>';
          } else if (inCode) {
            codeLines.push(line);
          } else {
            let l = escapeHtml(line);
            // Inline code
            l = l.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
            // Bold
            l = l.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            // Italic
            l = l.replace(/\*([^*]+)\*/g, '<em>$1</em>');
            // Headers
            if (l.startsWith('### ')) { html += '<p><strong>' + l.slice(4) + '</strong></p>'; continue; }
            if (l.startsWith('## ')) { html += '<p><strong>' + l.slice(3) + '</strong></p>'; continue; }
            if (l.startsWith('# ')) { html += '<p><strong>' + l.slice(2) + '</strong></p>'; continue; }
            // List items
            if (l.startsWith('- ') || l.startsWith('* ')) { html += '<p>&bull; ' + l.slice(2) + '</p>'; continue; }
            // Numbered list
            if (/^\\d+\\.\\s/.test(l)) { html += '<p>' + l + '</p>'; continue; }
            // Blank line = spacing
            if (l.trim() === '') { html += '<p></p>'; continue; }
            html += '<p>' + l + '</p>';
          }
        }
        if (inCode && codeLines.length) {
          html += '<pre><code>' + escapeHtml(codeLines.join('\\n')) + '</code></pre>';
        }
        return html;
      }

      // ----------------------------------------------------------------
      // Helpers
      // ----------------------------------------------------------------
      function hideWelcome() { if (welcomeEl) welcomeEl.style.display = 'none'; }
      function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }
      function autoResizeInput() { promptInput.style.height = 'auto'; promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px'; }

      function escapeHtml(str) {
        if (str == null) return '';
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }
      function escapeAttr(str) {
        if (str == null) return '';
        return String(str).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
              appendTextToStream(msg.message.content || '');
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
            statusText.textContent = msg.connected
              ? ('Connected' + (msg.agentName ? ' \u2014 ' + msg.agentName : ''))
              : 'Disconnected';
            if (connectQwenBtn) connectQwenBtn.style.display = msg.connected ? 'none' : 'inline-block';
            if (browseRegistryBtn) browseRegistryBtn.style.display = msg.connected ? 'none' : 'inline-block';
            break;

          case 'fileSearchResults':
            showFileSearch(msg.files);
            break;

          case 'addContextFile':
            contextFiles.push(msg.file);
            renderPills();
            break;

          case 'modelChanged':
            if (modelInput) modelInput.value = msg.modelId;
            break;

          case 'modeChanged':
            currentMode = msg.mode;
            document.querySelectorAll('.mode-pill').forEach(b => b.classList.toggle('active', b.dataset.mode === msg.mode));
            break;

          case 'threadCleared':
            messagesEl.innerHTML = '';
            if (welcomeEl) { messagesEl.appendChild(welcomeEl); welcomeEl.style.display = ''; }
            contextFiles = [];
            renderPills();
            currentStreamEl = null;
            isStreaming = false;
            break;

          case 'error': {
            const errEl = document.createElement('div');
            errEl.className = 'message assistant';
            errEl.style.borderColor = 'var(--vscode-testing-iconFailed)';
            errEl.textContent = '⚠️ ' + msg.message;
            messagesEl.appendChild(errEl);
            scrollToBottom();
            break;
          }
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
