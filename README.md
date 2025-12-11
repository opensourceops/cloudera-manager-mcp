# cloudera-manager-mcp

Cloudera Manager MCP (Stdio Server)

Overview

This is a Model Context Protocol (MCP) stdio server that integrates with the Cloudera Manager REST API for cluster and service inspection and basic lifecycle actions.

Status

- Initial scaffolding with a minimal REST client and the following tools:
  - Read tools (namespace `cm.read.*`)
    - cm.read.get_api_info
    - cm.read.list_clusters
    - cm.read.list_services
    - cm.read.list_commands
    - cm.read.get_command
    - cm.read.list_parcels (supports `view`; `limit`/`offset` client-side)
    - cm.read.get_parcels_usage (no paging supported)
  - Write tools (namespace `cm.write.*`)
    - cm.write.service_command (start/stop/restart) — requires `confirm=true` and `ALLOW_WRITES=true`
    - cm.write.inspect_hosts — triggers `/cm/commands/inspectHosts`; requires `confirm=true` and `ALLOW_WRITES=true`
  - Tools are only exposed under their namespaced forms.

Prerequisites

- Node.js >= 18 (uses global fetch)

Setup

0. Clone the repo and enter it:
   git clone https://github.com/opensourceops/cloudera-manager-mcp
   cd cloudera-manager-mcp

1. Install dependencies:
   npm install

2. Configure environment variables:
   - CLDR_CM_BASE_URL (e.g., https://cm-host:7183)
   - CLDR_CM_USERNAME
   - CLDR_CM_PASSWORD
   - CLDR_CM_API_VERSION (optional, e.g., v54). If not set, the server will probe /api/version and cache it.
   - CLDR_CM_VERIFY_SSL (optional, default: true). For self-signed labs you can set NODE_TLS_REJECT_UNAUTHORIZED=0 as a fallback.
   - ALLOW_WRITES (optional, default: false). Set to `true` to enable write tools; write tools also require `confirm=true` per call.

3. Build and run:
   npm run build
   npm start

Using With Codex CLI

After building, add this MCP server to Codex:

codex mcp add cloudera-manager-mcp --command "node dist/server.js" --env CLDR_CM_BASE_URL=... --env CLDR_CM_USERNAME=... --env CLDR_CM_PASSWORD=... --env CLDR_CM_API_VERSION=v49

If you want write tools, also pass `--env ALLOW_WRITES=true` and remember to set `confirm=true` in each write tool call.

During development:
   npm run dev

Notes

- The server calls the CM REST API directly using HTTP Basic authentication on each request (no cookie jar required).
- Write tools require `ALLOW_WRITES=true` and per-call `confirm=true`.
- For metrics/events/parcels and streaming command updates, additional tools will be added incrementally.

Testing the Read Tools (Quick Smoke Test)

- Configure env vars as above.
- Run the smoke test (reads only):
  npm run smoke:read

This prints API info, clusters (summary view), and services for the first cluster if present. It exercises the same underlying client used by the read tools.
