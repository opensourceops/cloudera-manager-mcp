# cloudera-manager-mcp

Cloudera Manager MCP stdio server for inspecting and operating Cloudera Manager clusters via MCP.

## Overview

This is a Model Context Protocol (MCP) stdio server that integrates with the Cloudera Manager REST API for cluster and service inspection and basic lifecycle actions.

Tool names are dot‑free (`cm_read_*`, `cm_write_*`) for broad MCP client compatibility. Legacy dotted names still work if called directly.

## Tools

**Read tools**

- `cm_read_get_api_info`
- `cm_read_list_clusters`
- `cm_read_list_services`
- `cm_read_list_commands`
- `cm_read_get_command`
- `cm_read_list_parcels` (supports `view`; `limit`/`offset` applied client‑side)
- `cm_read_get_parcels_usage` (no paging supported by CM)

**Write tools**

- `cm_write_service_command` (start/stop/restart) — requires `ALLOW_WRITES=true` and per‑call `confirm=true`
- `cm_write_inspect_hosts` — triggers `/cm/commands/inspectHosts`; requires `ALLOW_WRITES=true` and per‑call `confirm=true`

## Prerequisites

- Node.js >= 18 (uses global `fetch`)

## Setup

1. Clone the repo and enter it:

   ```bash
   git clone https://github.com/opensourceops/cloudera-manager-mcp
   cd cloudera-manager-mcp
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Configure environment variables:

   - `CLDR_CM_BASE_URL` (e.g., `https://cm-host:7183`)
   - `CLDR_CM_USERNAME`
   - `CLDR_CM_PASSWORD`
   - `CLDR_CM_API_VERSION` (optional, e.g., `v49`). If not set, the server probes `/api/version` and caches it.
   - `CLDR_CM_VERIFY_SSL` (optional, default: `true`)
   - `ALLOW_WRITES` (optional, default: `false`) — enables write tools

4. Build and run:

   ```bash
   npm run build
   npm start
   ```

During development:

```bash
npm run dev
```

## Using With Codex CLI

After building, add this MCP server to Codex:

```bash
codex mcp add cloudera-manager-mcp \
  --env CLDR_CM_BASE_URL=<CM_BASE_URL> \
  --env CLDR_CM_USERNAME=<CM_USERNAME> \
  --env CLDR_CM_PASSWORD=<CM_PASSWORD> \
  --env CLDR_CM_API_VERSION=<CM_API_VERSION> \
  --env CLDR_CM_VERIFY_SSL=true \
  --env ALLOW_WRITES=true \
  -- node dist/server.js
```

The above enables write tools. Write tools still require `confirm=true` on each call.

## Notes

- The server calls the CM REST API directly using HTTP Basic authentication on each request (no cookie jar required).
- For metrics/events/parcels and streaming command updates, additional tools will be added incrementally.

## Testing (Read‑only Smoke)

Configure env vars as above, then run:

```bash
npm run smoke:read
```

This prints API info, clusters (summary view), and services for the first cluster if present, exercising the same client used by the read tools.
