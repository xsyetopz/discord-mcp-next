import { GuildInviteChannelTypes } from "oceanic.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { defineTool, ToolError } from "../tool.ts";
import { auditReason, guildId, snowflake } from "./schemas.ts";
import { definedOnly, reasonOption } from "./util.ts";

const INVITE_CHANNEL_TYPES: ReadonlySet<number> = new Set(
  GuildInviteChannelTypes,
);
const INVITE_CODE = /^[A-Za-z0-9-]+$/;
const INVITE_URL =
  /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/|discord\.com\/invite\/)([A-Za-z0-9-]+)\/?(?:[?#].*)?$/i;

/** Takes an invite code, or a discord.gg or discord.com/invite URL, and returns the code. */
export const parseInviteCode = (input: string): string => {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(INVITE_URL)?.[1];
  if (fromUrl) return fromUrl;
  if (INVITE_CODE.test(trimmed)) return trimmed;
  throw new ToolError(
    "inviteCode must be an invite code, or a discord.gg or discord.com/invite URL",
  );
};

const inviteCodeInput = z
  .string()
  .min(1)
  .max(500)
  .describe(
    "Invite code or full URL (e.g. 'ABCde' or 'https://discord.gg/ABCde')",
  );

const inviteUrl = (code: string) => `https://discord.gg/${code}`;

export const inviteTools = [
  defineTool({
    name: "create_invite",
    title: "Create invite",
    description:
      "Creates an invite link for a channel of a server. Choose how long it lasts, how many uses it has, and whether members get temporary membership.",
    group: "invites",
    access: "write",
    input: z.object({
      guildId,
      channelId: snowflake("Channel ID"),
      maxAge: z
        .number()
        .int()
        .min(0)
        .max(604800)
        .optional()
        .describe(
          "Seconds before the invite expires. 0 means it never expires. Discord defaults to 86400 (24 hours).",
        ),
      maxUses: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional()
        .describe("Maximum number of uses. 0 means unlimited. Defaults to 0."),
      temporary: z
        .boolean()
        .optional()
        .describe(
          "Whether members get temporary membership, and are removed when they disconnect unless they have a role",
        ),
      unique: z
        .boolean()
        .optional()
        .describe("Whether to force a new, unique invite code"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const channel = await findInviteChannel(ctx, id, args.channelId);
      const invite = await ctx.client.rest.channels.createInvite(
        channel.id,
        definedOnly({
          maxAge: args.maxAge,
          maxUses: args.maxUses,
          temporary: args.temporary,
          unique: args.unique,
          ...reasonOption(args.reason),
        }),
      );
      return {
        code: invite.code,
        url: inviteUrl(invite.code),
        channelId: channel.id,
        channelName: channel.name,
        maxAge: invite.maxAge,
        maxUses: invite.maxUses,
        temporary: invite.temporary,
      };
    },
  }),

  defineTool({
    name: "list_invites",
    title: "List invites",
    description:
      "Lists the active invites of a server, with their channel, creator, use count, limits, and temporary flag.",
    group: "invites",
    access: "read",
    input: z.object({ guildId }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const invites = await ctx.client.rest.guilds.getInvites(id);
      return {
        invites: invites.map((invite) => ({
          code: invite.code,
          url: inviteUrl(invite.code),
          channelId: invite.channelID,
          inviterId: invite.inviter?.id ?? null,
          inviterName: invite.inviter?.username ?? null,
          uses: invite.uses,
          maxUses: invite.maxUses,
          maxAge: invite.maxAge,
          temporary: invite.temporary,
          createdAt: invite.createdAt?.toISOString() ?? null,
        })),
      };
    },
  }),

  defineTool({
    name: "delete_invite",
    title: "Delete invite",
    description:
      "Deletes (revokes) an invite, so that its link stops working. Accepts a code or a full URL.",
    group: "invites",
    access: "destructive",
    input: z.object({
      inviteCode: inviteCodeInput,
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const code = parseInviteCode(args.inviteCode);
      await ctx.client.rest.channels.deleteInvite(code, args.reason);
      return { deleted: true, code };
    },
  }),

  defineTool({
    name: "get_invite_details",
    title: "Get invite details",
    description:
      "Gets the details of an invite, such as its server, channel, and creator. Works for any public invite.",
    group: "invites",
    access: "read",
    input: z.object({
      inviteCode: inviteCodeInput,
      withCounts: z
        .boolean()
        .optional()
        .describe(
          "Whether to include approximate member counts. Defaults to true.",
        ),
    }),
    run: async (args, ctx) => {
      const code = parseInviteCode(args.inviteCode);
      const invite =
        args.withCounts === false
          ? await ctx.client.rest.channels.getInvite(code)
          : await ctx.client.rest.channels.getInvite(code, {
              withCounts: true,
            });
      return {
        code: invite.code,
        url: inviteUrl(invite.code),
        guild: invite.guild
          ? { id: invite.guild.id, name: invite.guild.name }
          : null,
        channelId: invite.channelID,
        inviterName: invite.inviter?.username ?? null,
        approximateMemberCount: invite.approximateMemberCount ?? null,
        approximatePresenceCount: invite.approximatePresenceCount ?? null,
      };
    },
  }),
];

/** The channel of the server that an invite can point to, and a ToolError for any other channel. */
const findInviteChannel = async (
  ctx: Context,
  server: string,
  channelId: string,
) => {
  const channel = (await ctx.client.rest.guilds.getChannels(server)).find(
    (c) => c.id === channelId,
  );
  if (!channel)
    throw new ToolError(`Channel ${channelId} was not found in this server`);
  if (!INVITE_CHANNEL_TYPES.has(channel.type))
    throw new ToolError("This channel type does not support invites");
  return channel;
};
