import type { Member } from "oceanic.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { defineTool, ToolError } from "../tool.ts";
import { auditReason, guildId, snowflake } from "./schemas.ts";
import { hasStatus, reasonOption } from "./util.ts";

/** Discord allows a timeout of at most 28 days. */
const MAX_TIMEOUT_SECONDS = 2419200;
/** Discord allows deleting at most 7 days of messages on a ban. */
const MAX_DELETE_MESSAGE_SECONDS = 604800;

/** Fetches a member, and turns a missing member into a ToolError. */
const fetchMember = async (
  ctx: Context,
  server: string,
  userId: string,
): Promise<Member> =>
  ctx.client.rest.guilds.getMember(server, userId).catch((error: unknown) => {
    if (hasStatus(error, 404))
      throw new ToolError("User not found in this server by userId");
    throw error;
  });

/** The reason option of an Oceanic options object, which omits it when unset. */

export const moderationTools = [
  defineTool({
    name: "kick_member",
    title: "Kick member",
    description:
      "Kicks a member from the server. The user can rejoin with a new invite.",
    group: "moderation",
    access: "destructive",
    input: z.object({
      guildId,
      userId: snowflake("User ID"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const member = await fetchMember(ctx, id, args.userId);
      await ctx.client.rest.guilds.removeMember(id, args.userId, args.reason);
      return {
        userId: args.userId,
        username: member.user.username,
        reason: args.reason ?? null,
      };
    },
  }),

  defineTool({
    name: "ban_member",
    title: "Ban member",
    description:
      "Bans a user from the server, preventing them from rejoining. Optionally deletes their recent messages.",
    group: "moderation",
    access: "destructive",
    input: z.object({
      guildId,
      userId: snowflake("User ID"),
      deleteMessageSeconds: z
        .number()
        .int()
        .min(0)
        .max(MAX_DELETE_MESSAGE_SECONDS)
        .optional()
        .describe(
          "Seconds of the user's recent messages to delete (0-604800, which is 7 days). Defaults to 0.",
        ),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const deleteMessageSeconds = args.deleteMessageSeconds ?? 0;
      await ctx.client.rest.guilds.createBan(id, args.userId, {
        deleteMessageSeconds,
        ...reasonOption(args.reason),
      });
      return {
        userId: args.userId,
        deleteMessageSeconds,
        reason: args.reason ?? null,
      };
    },
  }),

  defineTool({
    name: "unban_member",
    title: "Unban member",
    description:
      "Removes a ban from a user, allowing them to rejoin the server.",
    group: "moderation",
    access: "write",
    input: z.object({
      guildId,
      userId: snowflake("User ID"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      await ctx.client.rest.guilds.removeBan(id, args.userId, args.reason);
      return { userId: args.userId, reason: args.reason ?? null };
    },
  }),

  defineTool({
    name: "timeout_member",
    title: "Timeout member",
    description:
      "Disables communication for a member for a specified duration (timeout, mute). The maximum is 28 days.",
    group: "moderation",
    access: "write",
    input: z.object({
      guildId,
      userId: snowflake("User ID"),
      durationSeconds: z
        .number()
        .int()
        .min(1)
        .max(MAX_TIMEOUT_SECONDS)
        .describe("Timeout length in seconds (1 to 2419200, which is 28 days)"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      if (
        args.durationSeconds < 1 ||
        args.durationSeconds > MAX_TIMEOUT_SECONDS
      )
        throw new ToolError(
          "durationSeconds must be between 1 and 2419200 (28 days)",
        );
      const id = ctx.guildId(args.guildId);
      const member = await fetchMember(ctx, id, args.userId);
      const until = new Date(Date.now() + args.durationSeconds * 1000);
      await ctx.client.rest.guilds.editMember(id, args.userId, {
        communicationDisabledUntil: until.toISOString(),
        ...reasonOption(args.reason),
      });
      return {
        userId: args.userId,
        username: member.user.username,
        durationSeconds: args.durationSeconds,
        timeoutUntil: until.toISOString(),
        reason: args.reason ?? null,
      };
    },
  }),

  defineTool({
    name: "remove_timeout",
    title: "Remove timeout",
    description: "Removes a timeout (unmute) from a member before it expires.",
    group: "moderation",
    access: "write",
    input: z.object({
      guildId,
      userId: snowflake("User ID"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const member = await fetchMember(ctx, id, args.userId);
      await ctx.client.rest.guilds.editMember(id, args.userId, {
        communicationDisabledUntil: null,
        ...reasonOption(args.reason),
      });
      return {
        userId: args.userId,
        username: member.user.username,
        reason: args.reason ?? null,
      };
    },
  }),

  defineTool({
    name: "set_nickname",
    title: "Set nickname",
    description:
      "Changes a member's nickname on the server. An empty nick resets it to the username.",
    group: "moderation",
    access: "write",
    input: z.object({
      guildId,
      userId: snowflake("User ID"),
      nick: z
        .string()
        .optional()
        .describe("New nickname. Empty or omitted resets it to the username."),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const member = await fetchMember(ctx, id, args.userId);
      const nick = args.nick?.trim() ? args.nick.trim() : null;
      await ctx.client.rest.guilds.editMember(id, args.userId, {
        nick,
        ...reasonOption(args.reason),
      });
      return {
        userId: args.userId,
        username: member.user.username,
        nick,
        reason: args.reason ?? null,
      };
    },
  }),

  defineTool({
    name: "get_bans",
    title: "Get bans",
    description:
      "Lists users banned from the server, with the ban reason of each.",
    group: "moderation",
    access: "read",
    input: z.object({
      guildId,
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(50)
        .describe("Maximum number of bans to return (1-1000, default 50)"),
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const bans = await ctx.client.rest.guilds.getBans(id, {
        limit: args.limit,
      });
      return {
        bans: bans.map((ban) => ({
          userId: ban.user.id,
          username: ban.user.username,
          globalName: ban.user.globalName,
          reason: ban.reason,
        })),
      };
    },
  }),
];
