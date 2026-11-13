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
- [x] **Get KRS Entry History** (`get-krs-entry-history`): Returns a compact history of the entity's register entries, computed from the full extract (which for large companies runs to hundreds of thousands of characters). By default it lists entries newest first — date, description, case reference and the fields each entry changed — optionally filtered with `odDaty` (`dd.mm.yyyy` or `yyyy-mm-dd`) and `limit` (default 20, max 100). With `numerWpisu` it shows what that single entry introduced, struck out and changed: name, address, capital, board members, PKD codes and so on. Works for entities struck off the register as well; the register (`P`/`S`) is optional.

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
