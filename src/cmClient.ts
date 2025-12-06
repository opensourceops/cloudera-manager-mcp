import type { CmConfig } from "./config.js";

export class ClouderaManagerClient {
  private cfg: CmConfig;
  private cachedVersion?: string;

  constructor(cfg: CmConfig) {
    this.cfg = cfg;
    if (cfg.apiVersion) this.cachedVersion = cfg.apiVersion;
    if (!cfg.verifySsl) {
      // Allow self-signed certs for lab/testing when verifySsl=false.
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
  }

  private apiBase(): string {
    const v = this.cachedVersion;
    if (!v) throw new Error("API version not resolved yet");
    return `${this.cfg.baseUrl}/api/${v}`;
  }

  async resolveVersion(): Promise<string> {
    if (this.cachedVersion) return this.cachedVersion;
    const url = `${this.cfg.baseUrl}/api/version`;
    const res = await this.rawFetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`Failed to get API version: ${res.status} ${res.statusText}`);
    const text = await res.text();
    // Expect forms like "v54" or JSON string; trim quotes/spaces
    const v = text.trim().replace(/^"|"$/g, "");
    if (!/^v\d+$/i.test(v)) throw new Error(`Unexpected version format from /api/version: ${text}`);
    this.cachedVersion = v;
    return v;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = path.startsWith("http") ? path : `${this.apiBase()}${path}`;
    return this.rawFetch(url, init);
  }

  private async rawFetch(url: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      "Accept": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    };
    // Add basic auth header
    const auth = Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString("base64");
    headers["Authorization"] = `Basic ${auth}`;

    const res = await fetch(url, {
      ...init,
      headers,
    } as RequestInit);
    return res;
  }

  // Core methods
  async getApiInfo(): Promise<{ version: string; baseUrl: string }> {
    const version = await this.resolveVersion();
    return { version, baseUrl: this.cfg.baseUrl };
  }

  async listClusters(view?: "summary" | "full"): Promise<any> {
    const q = view ? `?view=${encodeURIComponent(view)}` : "";
    const res = await this.request(`/clusters${q}`, { method: "GET" });
    await this.assertOk(res, "listClusters");
    return res.json();
  }

  async listServices(clusterName: string, view?: "summary" | "full"): Promise<any> {
    if (!clusterName) throw new Error("clusterName is required");
    const q = view ? `?view=${encodeURIComponent(view)}` : "";
    const res = await this.request(`/clusters/${encodeURIComponent(clusterName)}/services${q}`, { method: "GET" });
    await this.assertOk(res, "listServices");
    return res.json();
  }

  async serviceCommand(clusterName: string, serviceName: string, action: "start" | "stop" | "restart"): Promise<any> {
    if (!clusterName) throw new Error("clusterName is required");
    if (!serviceName) throw new Error("serviceName is required");
    const path = `/clusters/${encodeURIComponent(clusterName)}/services/${encodeURIComponent(serviceName)}/commands/${action}`;
    const res = await this.request(path, { method: "POST" });
    await this.assertOk(res, `serviceCommand:${action}`);
    return res.json();
  }

  async getCommand(commandId: number): Promise<any> {
    const res = await this.request(`/commands/${commandId}`, { method: "GET" });
    await this.assertOk(res, "getCommand");
    return res.json();
  }

  private async assertOk(res: Response, op: string): Promise<void> {
    if (res.ok) return;
    let body: any;
    try { body = await res.text(); } catch {}
    throw new Error(`${op} failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`);
  }
}
