import { server } from "./server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("KRS MCP Server running on stdio");
    await new Promise(() => {});
  } catch (error) {
    console.error("Fatal error in main():", error);
    process.exit(1);
  }
}

main();
