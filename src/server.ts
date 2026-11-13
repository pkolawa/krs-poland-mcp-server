import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getKrsCurrentExtractTool } from "./tools/currentExtract.js";
import { getKrsFullExtractTool } from "./tools/fullExtract.js";
import { checkKrsStatusTool } from "./tools/checkStatus.js";
import { checkKrsWatchlistTool, MAX_RANGE_DAYS, MAX_WATCHED_KRS } from "./tools/watchlist.js";

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

server.registerTool("Check_KRS_Watchlist",
    {
        title: "check-krs-watchlist",
        description:
            `Check which of the watched entities (up to ${MAX_WATCHED_KRS} KRS numbers) had an entry in the KRS register ` +
            `on a given day (data) or within a date range (odDaty/doDaty, up to ${MAX_RANGE_DAYS} days), based on the ` +
            "daily KRS bulletin. For each entity with an entry returns the bulletin days and, unless szczegoly is false, " +
            "its name, last register entry (number, date, case reference, court) and the status assessment of " +
            "Check_KRS_Status. Also lists entities without entries and bulletin days that could not be fetched.",
        inputSchema: checkKrsWatchlistTool.schema,
        annotations: { readOnlyHint: true, openWorldHint: true }
    },
    (params) => checkKrsWatchlistTool.handler(params)
);
