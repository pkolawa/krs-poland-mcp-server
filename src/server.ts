import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getKrsCurrentExtractTool, getKrsFullExtractTool } from "./tools/extract.js";
import { checkKrsStatusTool } from "./tools/checkStatus.js";
import { checkKrsWatchlistTool, MAX_RANGE_DAYS, MAX_WATCHED_KRS } from "./tools/watchlist.js";
import { getKrsEntryHistoryTool } from "./tools/entryHistory.js";
import { getKrsEntityProfileTool } from "./tools/entityProfile.js";
import { counterpartyCheckPrompt } from "./prompts/counterpartyCheck.js";

export const server = new McpServer({
  name: "KRS Poland MCP Server",
  version: "1.5.0",
});

server.registerTool("Get_Current_KRS_Record",
    {
        title: "get-krs-current-extract",
        description:
            "Get the raw current extract (odpis aktualny) of an entity from KRS as JSON – all register sections " +
            "as they stand today (tens of thousands of characters for a large company; prefer Check_KRS_Status " +
            "for a compact answer). Entities struck off the register have no current extract. " +
            "The register (P/S) is optional – both are checked when omitted.",
        inputSchema: getKrsCurrentExtractTool.schema,
        annotations: { readOnlyHint: true, openWorldHint: true }
    },
    (params) => getKrsCurrentExtractTool.handler(params)
);

server.registerTool("Get_Full_KRS_Record",
    {
        title: "get-krs-full-extract",
        description:
            "Get the raw full extract (odpis pełny) of an entity from KRS as JSON – current data plus the complete " +
            "history of register entries (hundreds of thousands of characters for a large company; prefer " +
            "Get_KRS_Entry_History for the history). Available also for entities struck off the register. " +
            "The register (P/S) is optional – both are checked when omitted.",
        inputSchema: getKrsFullExtractTool.schema,
        annotations: { readOnlyHint: true, openWorldHint: true }
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

server.registerTool("Get_KRS_Entity_Profile",
    {
        title: "get-krs-entity-profile",
        description:
            "Get a compact profile of an entity from its current KRS extract: NIP/REGON (with NIP status), seat and " +
            "address, contact and e-delivery address, share capital, representation (who can act for the entity and how: " +
            "the board's composition by function and the representation rule, commercial proxies, attorneys; liquidators " +
            "or a trustee when applicable), supervisory board, owners (shareholders that are companies are named, people " +
            "are not), PKD activity codes, purpose and public-benefit status for associations, branches, and a one-line " +
            "status assessment. Personal data is never returned. The register (P/S) is optional – both are checked when omitted.",
        inputSchema: getKrsEntityProfileTool.schema,
        annotations: { readOnlyHint: true, openWorldHint: true }
    },
    (params) => getKrsEntityProfileTool.handler(params)
);

server.registerPrompt("weryfikacja-kontrahenta",
    {
        title: "Weryfikacja kontrahenta w KRS",
        description:
            "Prowadzi przez kartę podmiotu, kontrolę statusu i historię zmian z ostatnich 12 miesięcy, a potem prosi " +
            "o raport z oceną (zielona/żółta/czerwona) i odpowiedzią, kto może podpisać umowę w imieniu podmiotu.",
        argsSchema: counterpartyCheckPrompt.argsSchema
    },
    (args) => counterpartyCheckPrompt.build(args)
);
