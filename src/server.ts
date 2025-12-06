import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfigFromEnv } from "./config.js";
import { ClouderaManagerClient } from "./cmClient.js";

// Tool input schemas (JSON Schema)
const ViewEnum = {
  type: "string",
  enum: ["summary", "full"],
};

const ListClustersInput: any = {
  type: "object",
  properties: { view: ViewEnum },
  additionalProperties: false,
};

const ListServicesInput: any = {
  type: "object",
  required: ["cluster"],
  properties: {
    cluster: { type: "string" },
    view: ViewEnum,
  },
  additionalProperties: false,
};

const ServiceCommandInput: any = {
  type: "object",
  required: ["cluster", "service", "action"],
  properties: {
    cluster: { type: "string" },
    service: { type: "string" },
    action: { type: "string", enum: ["start", "stop", "restart"] },
    confirm: { type: "boolean", default: false },
  },
  additionalProperties: false,
};

const GetCommandInput: any = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "number" } },
  additionalProperties: false,
};

async function main() {
  const server = new Server({ name: "cloudera-manager-mcp", version: "0.1.0" }, {
    capabilities: {
      tools: {},
    },
  });

  // Load config and init client lazily when first tool runs to avoid process exit on import.
  let client: ClouderaManagerClient | undefined;
  const getClient = () => {
    if (!client) {
      const cfg = loadConfigFromEnv();
      client = new ClouderaManagerClient(cfg);
    }
    return client!;
  };

  // Registry helpers
  const allowWrites = (process.env.ALLOW_WRITES ?? "false").toLowerCase() === "true";
  type ToolDef = {
    name: string;
    description: string;
    inputSchema?: any;
    handler: Parameters<typeof server.tool>[2];
  };

  const readTools: ToolDef[] = [
    {
      name: "cm.read.get_api_info",
      description: "Get Cloudera Manager API version and base URL",
      handler: async () => {
        const c = getClient();
        const info = await c.getApiInfo();
        return { content: [{ type: "json", json: info }] };
      },
    },
    {
      name: "cm.read.list_clusters",
      description: "List clusters (summary or full view)",
      inputSchema: ListClustersInput,
      handler: async ({ input }) => {
        const c = getClient();
        await c.resolveVersion();
        const data = await c.listClusters(input?.view);
        return { content: [{ type: "json", json: data }] };
      },
    },
    {
      name: "cm.read.list_services",
      description: "List services in a cluster",
      inputSchema: ListServicesInput,
      handler: async ({ input }) => {
        const c = getClient();
        await c.resolveVersion();
        const data = await c.listServices(input.cluster, input.view);
        return { content: [{ type: "json", json: data }] };
      },
    },
    {
      name: "cm.read.get_command",
      description: "Get command status by id",
      inputSchema: GetCommandInput,
      handler: async ({ input }) => {
        const c = getClient();
        await c.resolveVersion();
        const cmd = await c.getCommand(input.id);
        return { content: [{ type: "json", json: cmd }] };
      },
    },
  ];

  const writeTools: ToolDef[] = [
    {
      name: "cm.write.service_command",
      description: "Run start/stop/restart on a service (requires confirm and ALLOW_WRITES=true)",
      inputSchema: ServiceCommandInput,
      handler: async ({ input }) => {
        if (!allowWrites) {
          return { content: [{ type: "text", text: "Writes disabled. Set ALLOW_WRITES=true to enable." }] };
        }
        if (!input.confirm) {
          return { content: [{ type: "text", text: "Refusing to run without confirm=true" }] };
        }
        const c = getClient();
        await c.resolveVersion();
        const cmd = await c.serviceCommand(input.cluster, input.service, input.action);
        return { content: [{ type: "json", json: cmd }] };
      },
    },
  ];

  const register = (defs: ToolDef[]) => {
    for (const d of defs) {
      server.tool(d.name, { description: d.description, inputSchema: d.inputSchema }, d.handler);
    }
  };

  register(readTools);
  register(writeTools);

  // Backward-compatible aliases (deprecated)
  server.tool("get_api_info", { description: "Deprecated alias for cm.read.get_api_info" }, readTools[0].handler);
  server.tool("list_clusters", { description: "Deprecated alias for cm.read.list_clusters", inputSchema: ListClustersInput }, readTools[1].handler);
  server.tool("list_services", { description: "Deprecated alias for cm.read.list_services", inputSchema: ListServicesInput }, readTools[2].handler);
  server.tool("get_command", { description: "Deprecated alias for cm.read.get_command", inputSchema: GetCommandInput }, readTools[3].handler);
  server.tool("service_command", { description: "Deprecated alias for cm.write.service_command", inputSchema: ServiceCommandInput }, writeTools[0].handler);

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error:", err);
  process.exit(1);
});
