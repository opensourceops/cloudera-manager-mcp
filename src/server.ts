import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
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

const ListCommandsInput: any = {
  type: "object",
  required: ["cluster"],
  properties: {
    cluster: { type: "string" },
    service: { type: "string" },
    view: ViewEnum,
    limit: { type: "number", minimum: 1, maximum: 500 },
    offset: { type: "number", minimum: 0 },
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

const InspectHostsInput: any = {
  type: "object",
  properties: {
    hostIds: { type: "array", items: { type: "string" }, minItems: 1 },
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

const ParcelsInput: any = {
  type: "object",
  required: ["cluster"],
  properties: {
    cluster: { type: "string" },
    view: ViewEnum,
    limit: { type: "number", minimum: 1, maximum: 500 },
    offset: { type: "number", minimum: 0 },
  },
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
    handler: (args: { input?: any }) => Promise<any>;
  };

  const readTools: ToolDef[] = [
    {
      name: "cm_read_get_api_info",
      description: "Get Cloudera Manager API version and base URL",
      handler: async () => {
        const c = getClient();
        const info = await c.getApiInfo();
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      },
    },
    {
      name: "cm_read_list_clusters",
      description: "List clusters (summary or full view)",
      inputSchema: ListClustersInput,
      handler: async ({ input }) => {
        const c = getClient();
        await c.resolveVersion();
        const data = await c.listClusters(input?.view);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      },
    },
    {
      name: "cm_read_list_services",
      description: "List services in a cluster",
      inputSchema: ListServicesInput,
      handler: async ({ input }) => {
        const c = getClient();
        await c.resolveVersion();
        const data = await c.listServices(input.cluster, input.view);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      },
    },
    {
      name: "cm_read_list_commands",
      description: "List recent commands for a cluster or service",
      inputSchema: ListCommandsInput,
      handler: async ({ input }) => {
        const c = getClient();
        await c.resolveVersion();
        const opts = { view: input.view, limit: input.limit, offset: input.offset };
        const data = input.service
          ? await c.listServiceCommands(input.cluster, input.service, opts)
          : await c.listClusterCommands(input.cluster, opts);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      },
    },
    {
      name: "cm_read_get_command",
      description: "Get command status by id",
      inputSchema: GetCommandInput,
      handler: async ({ input }) => {
        const c = getClient();
        await c.resolveVersion();
        const cmd = await c.getCommand(input.id);
        return { content: [{ type: "text", text: JSON.stringify(cmd, null, 2) }] };
      },
    },
    {
      name: "cm_read_list_parcels",
      description: "List parcels that a cluster has access to (supports view; limit/offset are applied client-side)",
      inputSchema: ParcelsInput,
      handler: async ({ input }) => {
        const c = getClient();
        await c.resolveVersion();
        const view = input?.view ?? "summary";
        const limit = input?.limit ?? 50;
        const offset = input?.offset ?? 0;
        const data = await c.listParcels(input.cluster, view);
        const items: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
        const total = items.length;
        const pagedItems = items.slice(offset, offset + limit);
        const result = {
          items: pagedItems,
          paging: {
            total,
            limit,
            offset,
            nextOffset: offset + limit < total ? offset + limit : null,
          },
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "cm_read_get_parcels_usage",
      description: "Get parcel usage details for a cluster (no paging supported by CM)",
      inputSchema: ParcelsInput,
      handler: async ({ input }) => {
        const c = getClient();
        await c.resolveVersion();
        const data = await c.getParcelsUsage(input.cluster);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      },
    },
  ];

  const writeTools: ToolDef[] = [
    {
      name: "cm_write_service_command",
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
        return { content: [{ type: "text", text: JSON.stringify(cmd, null, 2) }] };
      },
    },
    {
      name: "cm_write_inspect_hosts",
      description: "Run Cloudera Manager host inspector (requires confirm and ALLOW_WRITES=true)",
      inputSchema: InspectHostsInput,
      handler: async ({ input }) => {
        if (!allowWrites) {
          return { content: [{ type: "text", text: "Writes disabled. Set ALLOW_WRITES=true to enable." }] };
        }
        if (!input?.confirm) {
          return { content: [{ type: "text", text: "Refusing to run without confirm=true" }] };
        }
        const c = getClient();
        await c.resolveVersion();
        const cmd = await c.inspectHosts(input.hostIds);
        return { content: [{ type: "text", text: JSON.stringify(cmd, null, 2) }] };
      },
    },
  ];

  const allTools: ToolDef[] = [
    ...readTools,
    ...writeTools,
  ];

  const toolMap = new Map<string, ToolDef>(allTools.map((t) => [t.name, t]));

  // Hidden compatibility mapping for legacy dotted names (not advertised via tools/list).
  const legacyNameMap: Record<string, string> = {
    "cm.read.get_api_info": "cm_read_get_api_info",
    "cm.read.list_clusters": "cm_read_list_clusters",
    "cm.read.list_services": "cm_read_list_services",
    "cm.read.list_commands": "cm_read_list_commands",
    "cm.read.get_command": "cm_read_get_command",
    "cm.read.list_parcels": "cm_read_list_parcels",
    "cm.read.get_parcels_usage": "cm_read_get_parcels_usage",
    "cm.write.service_command": "cm_write_service_command",
    "cm.write.inspect_hosts": "cm_write_inspect_hosts",
  };
  for (const [legacy, current] of Object.entries(legacyNameMap)) {
    const def = toolMap.get(current);
    if (def) toolMap.set(legacy, def);
  }

  // MCP tools/list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema ?? {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      })),
    };
  });

  // MCP tools/call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const tool = toolMap.get(name);
    if (!tool) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
    const input = request.params.arguments ?? {};
    return tool.handler({ input });
  });

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error:", err);
  process.exit(1);
});
