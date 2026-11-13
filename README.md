![logo](logo.png)

# KRS Poland MCP Server

An MCP server for the Polish National Court Register (KRS) public API.

## Usage

This server is designed to be run with `npx`, allowing you to use it as a tool provider for LLM clients without a global installation.

### Running with `npx`

To start the server, run the following command:

```bash
npx krs-poland-mcp-server
```

### Configuration for LLM Clients

To integrate this server with an LLM client (like LM Studio or others that support MCP), you can configure it to spawn the server process. Here is an example configuration:

```json
{
  "mcpServers": {
    "krs-poland-mcp-server": {
      "command": "npx",
      "args": [
        "-y",
        "krs-poland-mcp-server"
      ]
    }
  }
}
```

This configuration tells the client how to start the KRS tool server.

### Cache

Responses of the KRS API are kept in memory for 10 minutes (up to 50 most recently used requests), so the status check, the profile and the history of the same entity do not download its extract again. Set `KRS_CACHE_TTL_SECONDS` in the server's environment to change the lifetime, or to `0` to turn the cache off:

```json
"env": { "KRS_CACHE_TTL_SECONDS": "0" }
```

## Server Functions


The server provides the following tools (checklist):

- [x] **Get Current KRS Record** (`get-krs-current-extract`): Returns the raw current extract (odpis aktualny) of an entity as JSON. The register (`P`/`S`) is optional; both are checked when it is omitted.
- [x] **Get Full KRS Record** (`get-krs-full-extract`): Returns the raw full extract (odpis pełny) — current data plus the complete history of entries — as JSON; also available for entities struck off the register. The register (`P`/`S`) is optional.
- [x] **Check KRS Status** (`check-krs-status`): Checks whether an entity is active and returns a compact report of risk signals found in its register entry — liquidation, bankruptcy, restructuring, suspension, dissolution, arrears with enforcement, asset security, dismissed bankruptcy petitions, court-appointed curator, missing board, overdue annual financial statements, and deletion from the register. The register (`P`/`S`) is optional; both are checked when it is omitted.
- [x] **Get KRS Entity Profile** (`get-krs-entity-profile`): A compact profile of the entity from its current extract — NIP/REGON with NIP status, seat and address, contact and e-delivery address, share capital, representation (the board's composition by function and the rule for acting on the entity's behalf, commercial proxies, attorneys, liquidators when applicable), supervisory board, owners (companies are named, people are not), PKD codes, the purpose and public-benefit status of associations, branches, and a one-line status assessment. Personal data is never returned. The register (`P`/`S`) is optional.
- [x] **Get KRS Entry History** (`get-krs-entry-history`): Returns a compact history of the entity's register entries, computed from the full extract (which for large companies runs to hundreds of thousands of characters). By default it lists entries newest first — date, description, case reference and the fields each entry changed — optionally filtered with `odDaty` (`dd.mm.yyyy` or `yyyy-mm-dd`) and `limit` (default 20, max 100). With `numerWpisu` it shows what that single entry introduced, struck out and changed: name, address, capital, board members, PKD codes and so on. Works for entities struck off the register as well; the register (`P`/`S`) is optional.
- [x] **Check KRS Watchlist** (`check-krs-watchlist`): Takes up to 50 watched KRS numbers and a day (`data`) or a date range (`odDaty`/`doDaty`, up to 31 days; `doDaty` defaults to today) and tells which of the entities had an entry in the register in that period, based on the daily KRS bulletin. For each such entity it returns the bulletin days and — unless `szczegoly` is `false` — its name, last register entry (number, date, case reference, court; for an entity struck off also the entry description) and the status assessment of `check-krs-status`. Entities without entries and bulletin days that could not be fetched are listed separately.

  Example arguments:

  ```json
  { "krs": ["0000019193", "0000109411"], "odDaty": "2026-11-01", "doDaty": "2026-11-12" }
  ```

## Prompts

- **Weryfikacja kontrahenta w KRS** (`weryfikacja-kontrahenta`): arguments `krs` (required), `rejestr` and `kontekst` (e.g. "umowa dostawy na 200 tys. zł"). Walks the model through the entity profile, the status check and the last 12 months of register entries, and asks for a report with a green/yellow/red assessment and a plain answer to who can sign a contract on the entity's behalf.

All tools are read-only and none of the analytic tools return personal data of natural persons (the KRS API masks names and PESEL numbers but not, for example, birth dates).

## Development

To run the server in a development environment:

1.  Clone the repository.
2.  Install dependencies: `npm install`
3.  Build the project: `npm run build`
4.  Run the server: `npm start`

## Author

Piotr Kolawa ([@pkolawa](https://github.com/pkolawa)) / ([Linkedin](https://linkedin.com/in/pkolawa))

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
