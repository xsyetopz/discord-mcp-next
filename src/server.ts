import { McpServer } from "@modelcontextprotocol/server";
import pkg from "../package.json" with { type: "json" };
import { ConfigError } from "./config.ts";
import type { Context } from "./context.ts";
import { isEnabled, type ToolPolicy, unknownSelectors } from "./policy.ts";
import type { Tool } from "./tool.ts";

export const SERVER_NAME = "discord-mcp";

/** Returns the tools that the policy enables, or throws when a selector matches no tool. */
export const selectTools = (
  tools: readonly Tool[],
  policy: ToolPolicy,
): Tool[] => {
  const unknown = unknownSelectors([...policy.allow, ...policy.deny], tools);
  if (unknown.length > 0) {
    throw new ConfigError(
      `Tool selectors that match no tool: ${unknown.join(", ")}. Run \`bun run tools\` to list the tools.`,
    );
  }
  return tools.filter((tool) => isEnabled(policy, tool));
};

export const createServer = (
  tools: readonly Tool[],
  ctx: Context,
): McpServer => {
  const server = new McpServer(
    { name: SERVER_NAME, version: pkg.version },
    {
      instructions:
        "Tools for a Discord server. IDs are Discord snowflakes. Tools that take guildId use DISCORD_GUILD_ID when it is omitted.",
    },
  );
  for (const tool of tools) tool.register(server, ctx);
  return server;
};
