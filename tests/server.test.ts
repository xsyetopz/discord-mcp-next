import { describe, expect, test } from "bun:test";
import { ConfigError } from "../src/config.ts";
import { createHttpApp } from "../src/http.ts";
import type { ToolPolicy } from "../src/policy.ts";
import { createServer, selectTools } from "../src/server.ts";
import { allTools } from "../src/tools/index.ts";
import { fakeContext } from "./harness.ts";

interface ListedTool {
  name: string;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
}

/** Lists the tools over the MCP protocol, as a client sees them. */
const listTools = async (policy: ToolPolicy): Promise<ListedTool[]> => {
  const tools = selectTools(allTools, policy);
  const app = createHttpApp(
    {
      host: "127.0.0.1",
      port: 0,
      token: undefined,
      allowedHosts: ["localhost"],
    },
    () => createServer(tools, fakeContext({})),
  );
  const response = await app.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    }),
  );
  const body = await response.text();
  const data = body.split("\n").find((line) => line.startsWith("data: "));
  if (!data) throw new Error(`no data in ${body}`);
  return (JSON.parse(data.slice(6)) as { result: { tools: ListedTool[] } })
    .result.tools;
};

describe("tool registration", () => {
  test("tool names are unique", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every tool is listed when everything is allowed", async () => {
    const listed = await listTools({ allow: ["*"], deny: [] });
    expect(listed.map((t) => t.name).sort()).toEqual(
      allTools.map((t) => t.name).sort(),
    );
  });

  test("denied tools are not listed to the client", async () => {
    const listed = await listTools({ allow: ["*"], deny: ["@destructive"] });
    const names = listed.map((t) => t.name);
    for (const name of [
      "delete_channel",
      "delete_category",
      "delete_role",
      "kick_member",
      "ban_member",
    ]) {
      expect(names).not.toContain(name);
    }
    expect(names).toContain("send_message");
    expect(listed.every((t) => !t.annotations.destructiveHint)).toBe(true);
  });

  test("a read-only allowlist lists only read-only tools", async () => {
    const listed = await listTools({ allow: ["@read"], deny: [] });
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  test("the annotations follow the access level", async () => {
    const listed = await listTools({ allow: ["*"], deny: [] });
    for (const tool of allTools) {
      const annotations = listed.find((t) => t.name === tool.name)?.annotations;
      expect(annotations?.readOnlyHint).toBe(tool.access === "read");
      expect(annotations?.destructiveHint).toBe(tool.access === "destructive");
    }
  });

  test("a selector that matches no tool stops the start", () => {
    expect(() =>
      selectTools(allTools, { allow: ["*"], deny: ["delete_chanel"] }),
    ).toThrow(ConfigError);
  });
});
