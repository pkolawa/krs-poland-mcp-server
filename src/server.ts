import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getKrsCurrentExtractTool } from "./tools/currentExtract.js";
import { getKrsFullExtractTool } from "./tools/fullExtract.js";
import { checkKrsStatusTool } from "./tools/checkStatus.js";
import { getKrsEntryHistoryTool } from "./tools/entryHistory.js";

export const server = new McpServer({
  name: "KRS Poland MCP Server",
  version: "1.3.5",
});

server.registerTool("Get_Current_KRS_Record",
    {
        title: "get-krs-current-extract",
        description: "Get current status of the entity in KRS",
        inputSchema: getKrsCurrentExtractTool.schema
    },
    (params) => getKrsCurrentExtractTool.handler(params)
);

server.registerTool("Get_Full_KRS_Record",
    {
        title: "get-krs-full-extract",
        description: "Get full status of the entity in KRS",
        inputSchema: getKrsFullExtractTool.schema
    },
    (params) => getKrsFullExtractTool.handler(params)
);

server.registerTool("Check_KRS_Status",
    {
        title: "check-krs-status",
        description:
            "Check whether an entity in KRS is active and list risk signals found in its register entry: " +
            "liquidation, bankruptcy, restructuring, arrangement, suspension, dissolution, tax and other arrears " +
            "with enforcement, asset security, dismissed bankruptcy petition, court-appointed curator, missing board, " +
            "overdue annual financial statements, and deletion from the register. Returns a compact report " +
            "instead of the raw extract. The register (P/S) is optional – both are checked when omitted.",
        inputSchema: checkKrsStatusTool.schema,
        annotations: { readOnlyHint: true, openWorldHint: true }
    },
    (params) => checkKrsStatusTool.handler(params)
);

server.registerTool("Get_KRS_Entry_History",
    {
        title: "get-krs-entry-history",
        description:
            "Get a compact history of an entity's entries (wpisy) in KRS, computed from the full extract " +
            "(which for large companies runs to hundreds of thousands of characters). Without numerWpisu: lists entries " +
            "newest first with date, description, case reference and the fields each entry changed; narrow it with " +
            "odDaty (dd.mm.yyyy or yyyy-mm-dd) and limit. With numerWpisu: shows what that entry introduced, struck out " +
            "and changed – e.g. name, address, capital, board members, PKD codes. Works also for entities deleted " +
            "from the register. The register (P/S) is optional – both are checked when omitted.",
        inputSchema: getKrsEntryHistoryTool.schema,
        annotations: { readOnlyHint: true, openWorldHint: true }
    },
    (params) => getKrsEntryHistoryTool.handler(params)
);
