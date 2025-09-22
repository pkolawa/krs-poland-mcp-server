import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getKrsCurrentExtractTool } from "./tools/currentExtract.js";
import { getKrsFullExtractTool } from "./tools/fullExtract.js";
import { z } from "zod";

export const server = new McpServer({
  name: "KRS Poland MCP Server",
  version: "1.0.0",
});

server.registerTool("Get Current KRS Record",
    {
        title: "get-krs-current-extract",
        description: "Get current status of the entity in KRS",
        inputSchema: getKrsCurrentExtractTool.schema
    },
    (params, extra) => getKrsCurrentExtractTool.handler(params, extra)
);

server.registerTool("Get Full KRS Record",
    {
        title: "get-krs-full-extract",
        description: "Get full status of the entity in KRS",
        inputSchema: getKrsFullExtractTool.schema
    },
    (params, extra) => getKrsFullExtractTool.handler(params, extra)
);