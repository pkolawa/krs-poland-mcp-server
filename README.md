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

## Server Functions


The server provides the following tools (checklist):

- [x] **Get Current KRS Record** (`get-krs-current-extract`): Retrieves the current status and information for a given entity from the KRS.
- [x] **Get Full KRS Record** (`get-krs-full-extract`): Retrieves the complete historical data for a given entity from the KRS.
- [x] **Check KRS Status** (`check-krs-status`): Checks whether an entity is active and returns a compact report of risk signals found in its register entry — liquidation, bankruptcy, restructuring, suspension, dissolution, arrears with enforcement, asset security, dismissed bankruptcy petitions, court-appointed curator, missing board, overdue annual financial statements, and deletion from the register. The register (`P`/`S`) is optional; both are checked when it is omitted.
- [x] **Check KRS Watchlist** (`check-krs-watchlist`): Takes up to 50 watched KRS numbers and a day (`data`) or a date range (`odDaty`/`doDaty`, up to 31 days; `doDaty` defaults to today) and tells which of the entities had an entry in the register in that period, based on the daily KRS bulletin. For each such entity it returns the bulletin days and — unless `szczegoly` is `false` — its name, last register entry (number, date, case reference, court; for an entity struck off also the entry description) and the status assessment of `check-krs-status`. Entities without entries and bulletin days that could not be fetched are listed separately.

  Example arguments:

  ```json
  { "krs": ["0000019193", "0000109411"], "odDaty": "2026-11-01", "doDaty": "2026-11-12" }
  ```

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
