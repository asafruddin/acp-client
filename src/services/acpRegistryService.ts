import * as vscode from "vscode";
import * as https from "https";
import { AcpRegistryAgent, AcpRegistryData } from "../types/protocol";

/**
 * AcpRegistryService fetches and caches agent data from the ACP registry.
 */
export class AcpRegistryService implements vscode.Disposable {
  private static readonly REGISTRY_URL =
    "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

  private readonly _onDidChange = new vscode.EventEmitter<AcpRegistryAgent[]>();
  public readonly onDidChange: vscode.Event<AcpRegistryAgent[]> =
    this._onDidChange.event;

  private agents: AcpRegistryAgent[] = [];
  private loading = false;
  private error: string | null = null;

  /**
   * Fetches the latest agent list from the ACP registry.
   */
  async fetchAgents(): Promise<AcpRegistryAgent[]> {
    if (this.loading) {
      return this.agents;
    }

    this.loading = true;
    this.error = null;

    try {
      const data = await this.fetchJson<AcpRegistryData>(
        AcpRegistryService.REGISTRY_URL,
      );
      this.agents = data.agents || [];
      this._onDidChange.fire(this.agents);
      return this.agents;
    } catch (err: unknown) {
      this.error = err instanceof Error ? err.message : String(err);
      this._onDidChange.fire([]);
      throw err;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Fetches JSON data from a URL.
   */
  private fetchJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `Failed to fetch registry: ${res.statusCode} ${res.statusMessage}`,
              ),
            );
            return;
          }

          let rawData = "";
          res.on("data", (chunk) => {
            rawData += chunk;
          });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(rawData) as T;
              resolve(parsed);
            } catch (err: unknown) {
              reject(err);
            }
          });
        })
        .on("error", reject);
    });
  }

  /**
   * Returns cached agents.
   */
  getAgents(): AcpRegistryAgent[] {
    return this.agents;
  }

  /**
   * Returns the current loading state.
   */
  isLoading(): boolean {
    return this.loading;
  }

  /**
   * Returns the current error state.
   */
  getError(): string | null {
    return this.error;
  }

  /**
   * Finds an agent by its ID.
   */
  getAgentById(id: string): AcpRegistryAgent | undefined {
    return this.agents.find((agent) => agent.id === id);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
