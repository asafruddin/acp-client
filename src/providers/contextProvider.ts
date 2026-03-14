import * as vscode from "vscode";
import { WorkspaceFileEntry, ContextFile } from "../types/protocol";

/**
 * ContextProvider indexes the workspace file tree so the webview can offer
 * `@` file-tagging with fast fuzzy filtering — without needing to query the
 * ACP server.  File contents are loaded on-demand when a file is actually
 * attached to a prompt.
 */
export class ContextProvider implements vscode.Disposable {
  private fileIndex: WorkspaceFileEntry[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;
  private indexReady = false;

  private readonly _onIndexReady = new vscode.EventEmitter<void>();
  public readonly onIndexReady = this._onIndexReady.event;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Build the initial workspace index and start watching for changes. */
  async initialize(): Promise<void> {
    await this.buildIndex();

    this.watcher = vscode.workspace.createFileSystemWatcher("**/*");
    this.watcher.onDidCreate(() => this.buildIndex());
    this.watcher.onDidDelete(() => this.buildIndex());
    // Renames surface as delete + create, so no explicit rename handler needed.
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Return workspace files whose relative path matches `query` (case-insensitive substring). */
  search(query: string): WorkspaceFileEntry[] {
    if (!query) {
      // Return first 50 entries when the query is empty.
      return this.fileIndex.slice(0, 50);
    }
    const lower = query.toLowerCase();
    return this.fileIndex
      .filter((f) => f.relativePath.toLowerCase().includes(lower))
      .slice(0, 50);
  }

  /** Load the content of a file and return a fully-populated ContextFile. */
  async resolveContextFile(entry: WorkspaceFileEntry): Promise<ContextFile> {
    const uri = vscode.Uri.file(entry.absolutePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    return {
      filePath: entry.absolutePath,
      label: entry.relativePath,
      content: doc.getText(),
      languageId: doc.languageId,
    };
  }

  /** Convenience: resolve by absolute path string. */
  async resolveByPath(absolutePath: string): Promise<ContextFile | undefined> {
    const entry = this.fileIndex.find((f) => f.absolutePath === absolutePath);
    if (!entry) {
      return undefined;
    }
    return this.resolveContextFile(entry);
  }

  get isReady(): boolean {
    return this.indexReady;
  }

  get entries(): ReadonlyArray<WorkspaceFileEntry> {
    return this.fileIndex;
  }

  // -----------------------------------------------------------------------
  // Indexing
  // -----------------------------------------------------------------------

  private async buildIndex(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.fileIndex = [];
      this.indexReady = true;
      this._onIndexReady.fire();
      return;
    }

    const entries: WorkspaceFileEntry[] = [];

    for (const folder of workspaceFolders) {
      const pattern = new vscode.RelativePattern(folder, "**/*");
      const uris = await vscode.workspace.findFiles(
        pattern,
        "**/node_modules/**",
        5000,
      );

      for (const uri of uris) {
        const relativePath = vscode.workspace.asRelativePath(uri, false);
        const languageId = this.guessLanguageId(relativePath);
        entries.push({
          relativePath,
          absolutePath: uri.fsPath,
          languageId,
        });
      }
    }

    // Sort alphabetically for stable ordering.
    entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    this.fileIndex = entries;
    this.indexReady = true;
    this._onIndexReady.fire();
  }

  private guessLanguageId(filePath: string): string | undefined {
    const ext = filePath.split(".").pop()?.toLowerCase();
    const map: Record<string, string> = {
      ts: "typescript",
      tsx: "typescriptreact",
      js: "javascript",
      jsx: "javascriptreact",
      py: "python",
      rs: "rust",
      go: "go",
      java: "java",
      rb: "ruby",
      css: "css",
      html: "html",
      json: "json",
      md: "markdown",
      yaml: "yaml",
      yml: "yaml",
      sh: "shellscript",
      sql: "sql",
      swift: "swift",
      kt: "kotlin",
      c: "c",
      cpp: "cpp",
      h: "c",
      hpp: "cpp",
    };
    return ext ? map[ext] : undefined;
  }

  // -----------------------------------------------------------------------
  // Disposable
  // -----------------------------------------------------------------------

  dispose(): void {
    this.watcher?.dispose();
    this._onIndexReady.dispose();
  }
}
