import type { Member } from "oceanic.js";
import { z } from "zod";
import { defineTool, ToolError } from "../tool.ts";
import { guildId, snowflake } from "./schemas.ts";
import { hasStatus } from "./util.ts";

type Field = "id" | "username" | "globalName" | "nick";

interface Match {
  field: Field;
  /** True when the field equals the query, ignoring case. */
  exact: boolean;
}

interface Candidate {
  member: Member;
  matches: Match[];
  exact: boolean;
}

const SNOWFLAKE = /^\d{17,20}$/;

const displayName = (member: Member) =>
  member.nick ?? member.user.globalName ?? member.user.username;

/** Ranks the members that Discord returned for a query, with exact matches first. */
const rankMembers = (members: Member[], query: string): Candidate[] => {
  const q = query.toLowerCase();
  return members
    .map((member): Candidate => {
      const fields: Array<[Field, string | null]> = [
        ["username", member.user.username],
        ["globalName", member.user.globalName],
        ["nick", member.nick],
      ];
      const matches = fields.flatMap(([field, value]): Match[] => {
        const v = value?.toLowerCase();
        if (!v?.includes(q)) return [];
        return [{ field, exact: v === q }];
      });
      return { member, matches, exact: matches.some((m) => m.exact) };
    })
    .sort((a, b) => Number(b.exact) - Number(a.exact));
};

const summarize = (candidate: Candidate) => ({
  userId: candidate.member.user.id,
  username: candidate.member.user.username,
  globalName: candidate.member.user.globalName,
  nick: candidate.member.nick,
  displayName: displayName(candidate.member),
  bot: candidate.member.user.bot,
  matches: candidate.matches,
  exact: candidate.exact,
});

/** Splits `name#discriminator` into its parts. */
const splitUsername = (username: string) => {
  const idx = username.lastIndexOf("#");
  if (idx < 0) return { name: username.trim(), discriminator: undefined };
  return {
    name: username.slice(0, idx).trim(),
    discriminator: username.slice(idx + 1).trim() || undefined,
  };
};

export const memberTools = [
  defineTool({
    name: "get_user_id_by_name",
    title: "Get user ID by name",
    description:
      "Finds members of a server whose username, global display name, or server nickname matches, and returns their user IDs for <@id> mentions. Exact matches come first. Accepts username#discriminator to narrow the search.",
    group: "members",
    access: "read",
    input: z.object({
      username: z
        .string()
        .min(1)
        .describe("Username, display name, or nickname to search for"),
      guildId,
    }),
    run: async (args, ctx) => {
      const { name, discriminator } = splitUsername(args.username);
      if (!name)
        throw new ToolError("username needs a name before the #discriminator");
      const id = ctx.guildId(args.guildId);
      const found = await ctx.client.rest.guilds.searchMembers(id, {
        query: name,
        limit: 100,
      });
      const candidates = rankMembers(found, name).filter(
        (c) => !discriminator || c.member.user.discriminator === discriminator,
      );
      if (candidates.length === 0)
        throw new ToolError(
          `No member of this server matches ${args.username}`,
        );
      return { candidates: candidates.map(summarize) };
    },
  }),

  defineTool({
    name: "get_member_by_id",
    title: "Get member by ID",
    description:
      "Gets a server member by user ID: names, bot flag, join date, roles with names, and the timeout end time if one is active.",
    group: "members",
    access: "read",
    input: z.object({
      guildId,
      userId: snowflake("User ID"),
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const [member, roles] = await Promise.all([
        ctx.client.rest.guilds.getMember(id, args.userId),
        ctx.client.rest.guilds.getRoles(id),
      ]);
      const roleNames = new Map(roles.map((role) => [role.id, role.name]));
      return {
        userId: member.user.id,
        username: member.user.username,
        globalName: member.user.globalName,
        nick: member.nick,
        displayName: displayName(member),
        bot: member.user.bot,
        joinedAt: member.joinedAt?.toISOString() ?? null,
        roles: member.roles.map((roleId) => ({
          id: roleId,
          name: roleNames.get(roleId) ?? null,
        })),
        timeoutUntil: member.communicationDisabledUntil?.toISOString() ?? null,
      };
    },
  }),

  defineTool({
    name: "search_members",
    title: "Search members",
    description:
      "Searches server members by username, global display name, or nickname. A query that is a user ID returns that member exactly.",
    group: "members",
    access: "read",
    input: z.object({
      guildId,
      query: z.string().min(1).describe("Name or user ID to search for"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(25)
        .describe("Maximum number of members to return (1-100, default 25)"),
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      if (SNOWFLAKE.test(args.query)) {
        try {
          const member = await ctx.client.rest.guilds.getMember(id, args.query);
          return {
            members: [
              summarize({
                member,
                matches: [{ field: "id", exact: true }],
                exact: true,
              }),
            ],
          };
        } catch (error) {
          // A 404 means no member has this ID, so the query is searched as a name.
          if (!hasStatus(error, 404)) throw error;
        }
      }
      const found = await ctx.client.rest.guilds.searchMembers(id, {
        query: args.query,
        limit: args.limit,
      });
      return { members: rankMembers(found, args.query).map(summarize) };
    },
  }),

  defineTool({
    name: "list_guild_members",
    title: "List server members",
    description:
      "Lists members of a server, one page at a time. Needs the Server Members privileged intent enabled in the Discord Developer Portal. Pass nextAfter as after to get the next page.",
    group: "members",
    access: "read",
    input: z.object({
      guildId,
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(100)
        .describe("Members per page (1-1000, default 100)"),
      after: snowflake("After user ID")
        .optional()
        .describe(
          "User ID to start after, from nextAfter of the previous page",
        ),
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const members = await ctx.client.rest.guilds
        .getMembers(id, {
          limit: args.limit,
          ...(args.after ? { after: args.after } : {}),
        })
        .catch((error: unknown) => {
          if (hasStatus(error, 403))
            throw new ToolError(
              "Discord refused the member list. Enable the Server Members privileged intent in the Discord Developer Portal, under the bot settings, and try again.",
            );
          throw error;
        });
      const last = members.at(-1);
      return {
        members: members.map((member) => ({
          userId: member.user.id,
          username: member.user.username,
          globalName: member.user.globalName,
          nick: member.nick,
          displayName: displayName(member),
          bot: member.user.bot,
          joinedAt: member.joinedAt?.toISOString() ?? null,
        })),
        nextAfter: members.length === args.limit && last ? last.user.id : null,
      };
    },
  }),
];
