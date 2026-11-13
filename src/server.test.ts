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

  it("registers Get_Current_KRS_Record tool as read-only", () => {
    const tool = internals()._registeredTools["Get_Current_KRS_Record"];
    expect(tool).toBeDefined();
    expect(tool.description).toContain("current extract (odpis aktualny)");
    expect(tool.title).toBe("get-krs-current-extract");
    expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
  });

  it("registers Get_Full_KRS_Record tool as read-only", () => {
    const tool = internals()._registeredTools["Get_Full_KRS_Record"];
    expect(tool).toBeDefined();
    expect(tool.description).toContain("full extract (odpis pełny)");
    expect(tool.title).toBe("get-krs-full-extract");
    expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
  });

  it("registers Check_KRS_Status tool as read-only", () => {
    const tool = internals()._registeredTools["Check_KRS_Status"];
    expect(tool).toBeDefined();
    expect(tool.title).toBe("check-krs-status");
    expect(tool.description).toContain("risk signals");
    expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
  });

  it("registers Check_KRS_Watchlist tool as read-only", () => {
    const tool = internals()._registeredTools["Check_KRS_Watchlist"];
    expect(tool).toBeDefined();
    expect(tool.title).toBe("check-krs-watchlist");
    expect(tool.description).toContain("daily KRS bulletin");
    expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
    expect(Object.keys(tool.inputSchema.shape).sort()).toEqual(["data", "doDaty", "krs", "odDaty", "szczegoly"]);
  });

  it("registers Get_KRS_Entry_History tool as read-only", () => {
    const tool = internals()._registeredTools["Get_KRS_Entry_History"];
    expect(tool).toBeDefined();
    expect(tool.title).toBe("get-krs-entry-history");
    expect(tool.description).toContain("history");
    expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
    expect(Object.keys(tool.inputSchema.shape)).toEqual(["krs", "rejestr", "odDaty", "numerWpisu", "limit"]);
  });

  it("registers exactly 5 tools", () => {
    expect(Object.keys(internals()._registeredTools)).toHaveLength(5);
  });

  it("has input schemas with krs and rejestr fields", () => {
    const tools = internals()._registeredTools;

    for (const name of ["Get_Current_KRS_Record", "Get_Full_KRS_Record", "Check_KRS_Status", "Get_KRS_Entry_History"]) {
      const shape = tools[name].inputSchema.shape;
      expect(shape).toHaveProperty("krs");
      expect(shape).toHaveProperty("rejestr");
    }
  });

  it("makes rejestr optional everywhere – P and S are checked in turn when it is omitted", () => {
    const tools = internals()._registeredTools;
    const rejestr = (name: string) => tools[name].inputSchema.shape.rejestr as { isOptional(): boolean };

    for (const name of ["Get_Current_KRS_Record", "Get_Full_KRS_Record", "Check_KRS_Status", "Get_KRS_Entry_History"]) {
      expect(rejestr(name).isOptional()).toBe(true);
    }
  });

  it("marks every tool as read-only", () => {
    for (const [name, tool] of Object.entries(internals()._registeredTools)) {
      expect({ name, annotations: tool.annotations }).toEqual({ name, annotations: { readOnlyHint: true, openWorldHint: true } });
    }
  });
});
