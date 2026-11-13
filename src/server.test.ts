import { server } from "./server.js";
import { readFileSync } from "fs";
import { resolve } from "path";

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "..", "package.json"), "utf8")
);

type ServerInternals = {
  server: { _serverInfo: { name: string; version: string } };
  _registeredTools: Record<
    string,
    {
      title: string;
      description: string;
      annotations?: Record<string, unknown>;
      inputSchema: { shape: Record<string, unknown> };
    }
  >;
};

function internals(): ServerInternals {
  return server as unknown as ServerInternals;
}

describe("MCP Server", () => {
  it("has correct server name and version matching package.json", () => {
    const info = internals().server._serverInfo;
    expect(info.name).toBe("KRS Poland MCP Server");
    expect(info.version).toBe(pkg.version);
  });

  it("registers Get_Current_KRS_Record tool", () => {
    const tool = internals()._registeredTools["Get_Current_KRS_Record"];
    expect(tool).toBeDefined();
    expect(tool.description).toBe("Get current status of the entity in KRS");
    expect(tool.title).toBe("get-krs-current-extract");
  });

  it("registers Get_Full_KRS_Record tool", () => {
    const tool = internals()._registeredTools["Get_Full_KRS_Record"];
    expect(tool).toBeDefined();
    expect(tool.description).toBe("Get full status of the entity in KRS");
    expect(tool.title).toBe("get-krs-full-extract");
  });

  it("registers Check_KRS_Status tool as read-only", () => {
    const tool = internals()._registeredTools["Check_KRS_Status"];
    expect(tool).toBeDefined();
    expect(tool.title).toBe("check-krs-status");
    expect(tool.description).toContain("risk signals");
    expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
  });

  it("registers exactly 3 tools", () => {
    expect(Object.keys(internals()._registeredTools)).toHaveLength(3);
  });

  it("has input schemas with krs and rejestr fields", () => {
    const tools = internals()._registeredTools;

    for (const name of ["Get_Current_KRS_Record", "Get_Full_KRS_Record", "Check_KRS_Status"]) {
      const shape = tools[name].inputSchema.shape;
      expect(shape).toHaveProperty("krs");
      expect(shape).toHaveProperty("rejestr");
    }
  });

  it("requires rejestr for extracts but not for the status check", () => {
    const tools = internals()._registeredTools;
    const rejestr = (name: string) => tools[name].inputSchema.shape.rejestr as { isOptional(): boolean };

    expect(rejestr("Get_Current_KRS_Record").isOptional()).toBe(false);
    expect(rejestr("Get_Full_KRS_Record").isOptional()).toBe(false);
    expect(rejestr("Check_KRS_Status").isOptional()).toBe(true);
  });
});
