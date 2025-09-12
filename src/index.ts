import { server } from "./server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("KRS MCP Server running on stdio");
  await new Promise(() => {});
}

if (process.argv[1] === (import.meta && import.meta.url && new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });
}
