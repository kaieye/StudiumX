# Built-in MCP plugin scan roots

This directory is scanned by `bootstrapPluginMcpFromFilesystem` (ADR-0013).

- Place local plugin folders containing `plugin.json`, `.studiumx-plugin`, `mcp-plugin.json`, or `package.json` with MCP server declarations.
- **No official remote marketplace catalog** is bundled. Optional remote catalogs are user-configured HTTPS URLs in Settings → MCP Marketplace.
- Built-in entries (if any) are treated as **trusted** plugin MCP sources; they still require root MCP enabled / smart-connect for discovery, and tool calls still pass effect + approval.
