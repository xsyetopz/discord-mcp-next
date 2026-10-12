/**
 * Prints each tool with its group and access level, and whether DISCORD_MCP_ALLOW and DISCORD_MCP_DENY enable it.
 * It needs no Discord token.
 */
import { isEnabled, parseSelectors } from "../src/policy.ts";
import { allTools } from "../src/tools/index.ts";

const allow = parseSelectors(Bun.env["DISCORD_MCP_ALLOW"]);
const policy = {
  allow: allow.length > 0 ? allow : ["*"],
  deny: parseSelectors(Bun.env["DISCORD_MCP_DENY"]),
};

const rows = [...allTools]
  .sort(
    (a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name),
  )
  .map((t) => ({
    tool: t.name,
    group: t.group,
    access: t.access,
    enabled: isEnabled(policy, t),
  }));
console.table(rows);
console.log(
  `${rows.filter((r) => r.enabled).length} of ${rows.length} tools enabled`,
);
