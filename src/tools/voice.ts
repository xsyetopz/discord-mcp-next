import { ChannelTypes } from "oceanic.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { defineTool, ToolError } from "../tool.ts";
import { auditReason, guildId, snowflake } from "./schemas.ts";
import { channelTypeName, definedOnly, hasStatus } from "./util.ts";

const NOT_CONNECTED = "User is not connected to any voice channel";

const isAudioChannel = (type: ChannelTypes) =>
  type === ChannelTypes.GUILD_VOICE || type === ChannelTypes.GUILD_STAGE_VOICE;

/** Fetches a channel of the server, and turns a missing channel into a ToolError. */
const findChannel = async (ctx: Context, server: string, channelId: string) => {
  const channel = (await ctx.client.rest.guilds.getChannels(server)).find(
    (c) => c.id === channelId,
  );
  if (!channel)
    throw new ToolError("Channel not found in this server by channelId");
  return channel;
};

/** Fetches a category of the server, and turns a missing category into a ToolError. */
const findCategory = async (
  ctx: Context,
  server: string,
  categoryId: string,
) => {
  const category = (await ctx.client.rest.guilds.getChannels(server)).find(
    (c) => c.id === categoryId && c.type === ChannelTypes.GUILD_CATEGORY,
  );
  if (!category)
    throw new ToolError("Category not found in this server by categoryId");
  return category;
};

/** Throws a ToolError unless the member is connected to a voice channel of the server. */
const requireConnected = async (
  ctx: Context,
  server: string,
  userId: string,
): Promise<void> => {
  const state = await ctx.client.rest.guilds
    .getVoiceState(server, userId)
    .catch((error: unknown) => {
      if (hasStatus(error, 404)) throw new ToolError(NOT_CONNECTED);
      throw error;
    });
  if (!state.channelID) throw new ToolError(NOT_CONNECTED);
};

const summarize = (channel: {
  id: string;
  name: string | null;
  type: ChannelTypes;
}) => ({
  id: channel.id,
  name: channel.name,
  type: channelTypeName(channel.type),
});

export const voiceTools = [
  defineTool({
    name: "create_voice_channel",
    title: "Create voice channel",
    description:
      "Creates a voice channel in a server, with an optional category, user limit, and bitrate.",
    group: "voice",
    access: "write",
    input: z.object({
      guildId,
      name: z.string().min(1).max(100).describe("Name of the channel"),
      categoryId: snowflake("Category ID")
        .optional()
        .describe("ID of the category to put the channel in"),
      userLimit: z
        .number()
        .int()
        .min(0)
        .max(99)
        .optional()
        .describe("Maximum number of users. 0 means unlimited."),
      bitrate: z
        .number()
        .int()
        .min(8000)
        .optional()
        .describe(
          "Audio bitrate in bits per second, such as 64000. The maximum depends on the server boost level.",
        ),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const server = ctx.guildId(args.guildId);
      const parentID =
        args.categoryId === undefined
          ? undefined
          : (await findCategory(ctx, server, args.categoryId)).id;
      const channel = await ctx.client.rest.guilds.createChannel(
        server,
        ChannelTypes.GUILD_VOICE,
        {
          name: args.name,
          ...definedOnly({
            parentID,
            bitrate: args.bitrate,
            userLimit: args.userLimit,
            reason: args.reason,
          }),
        },
      );
      return summarize(channel);
    },
  }),

  defineTool({
    name: "create_stage_channel",
    title: "Create stage channel",
    description:
      "Creates a stage channel for audio events in a server, with an optional category and bitrate.",
    group: "voice",
    access: "write",
    input: z.object({
      guildId,
      name: z.string().min(1).max(100).describe("Name of the channel"),
      categoryId: snowflake("Category ID")
        .optional()
        .describe("ID of the category to put the channel in"),
      bitrate: z
        .number()
        .int()
        .min(8000)
        .optional()
        .describe("Audio bitrate in bits per second, such as 64000"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const server = ctx.guildId(args.guildId);
      const parentID =
        args.categoryId === undefined
          ? undefined
          : (await findCategory(ctx, server, args.categoryId)).id;
      const channel = await ctx.client.rest.guilds.createChannel(
        server,
        ChannelTypes.GUILD_STAGE_VOICE,
        {
          name: args.name,
          ...definedOnly({
            parentID,
            bitrate: args.bitrate,
            reason: args.reason,
          }),
        },
      );
      return summarize(channel);
    },
  }),

  defineTool({
    name: "edit_voice_channel",
    title: "Edit voice channel",
    description:
      "Edits a voice or stage channel: name, bitrate, user limit, and voice region. Only the given fields change.",
    group: "voice",
    access: "write",
    input: z.object({
      channelId: snowflake("Channel ID"),
      name: z.string().min(1).max(100).optional().describe("New name"),
      bitrate: z
        .number()
        .int()
        .min(8000)
        .optional()
        .describe("New audio bitrate in bits per second"),
      userLimit: z
        .number()
        .int()
        .min(0)
        .max(99)
        .optional()
        .describe("New maximum number of users. 0 means unlimited."),
      rtcRegion: z
        .string()
        .optional()
        .describe(
          "Voice region, such as rotterdam or us-east. An empty string sets automatic.",
        ),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const current = await ctx.client.rest.channels
        .get(args.channelId)
        .catch((error: unknown) => {
          if (hasStatus(error, 404))
            throw new ToolError("Channel not found by channelId");
          throw error;
        });
      if (!isAudioChannel(current.type))
        throw new ToolError("Channel is not a voice or stage channel");
      const edited = await ctx.client.rest.channels.edit(
        args.channelId,
        definedOnly({
          name: args.name,
          bitrate: args.bitrate,
          userLimit: args.userLimit,
          rtcRegion:
            args.rtcRegion === undefined ? undefined : args.rtcRegion || null,
          reason: args.reason,
        }),
      );
      return summarize(edited);
    },
  }),

  defineTool({
    name: "move_member",
    title: "Move member to voice channel",
    description:
      "Moves a member who is connected to a voice channel into another voice or stage channel of the server.",
    group: "voice",
    access: "write",
    input: z.object({
      guildId,
      userId: snowflake("ID of the user to move"),
      channelId: snowflake("ID of the target voice or stage channel"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const server = ctx.guildId(args.guildId);
      const target = await findChannel(ctx, server, args.channelId);
      if (!isAudioChannel(target.type))
        throw new ToolError("Target channel is not a voice or stage channel");
      await requireConnected(ctx, server, args.userId);
      await ctx.client.rest.guilds.editMember(
        server,
        args.userId,
        definedOnly({ channelID: args.channelId, reason: args.reason }),
      );
      return {
        userId: args.userId,
        channelId: target.id,
        channelName: target.name,
      };
    },
  }),

  defineTool({
    name: "disconnect_member",
    title: "Disconnect member from voice",
    description:
      "Disconnects a member from the voice channel that they are connected to.",
    group: "voice",
    access: "write",
    input: z.object({
      guildId,
      userId: snowflake("ID of the user to disconnect"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const server = ctx.guildId(args.guildId);
      await requireConnected(ctx, server, args.userId);
      await ctx.client.rest.guilds.editMember(
        server,
        args.userId,
        definedOnly({ channelID: null, reason: args.reason }),
      );
      return { userId: args.userId, channelId: null };
    },
  }),

  defineTool({
    name: "modify_voice_state",
    title: "Server mute or deafen member",
    description:
      "Server mutes or server deafens a member across all voice channels. The member must be connected to a voice channel.",
    group: "voice",
    access: "write",
    input: z.object({
      guildId,
      userId: snowflake("ID of the user"),
      mute: z
        .boolean()
        .optional()
        .describe("Whether to server mute the user's microphone"),
      deafen: z
        .boolean()
        .optional()
        .describe("Whether to server deafen the user's audio"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      if (args.mute === undefined && args.deafen === undefined)
        throw new ToolError("Give mute or deafen, or both");
      const server = ctx.guildId(args.guildId);
      await requireConnected(ctx, server, args.userId);
      await ctx.client.rest.guilds.editMember(
        server,
        args.userId,
        definedOnly({
          mute: args.mute,
          deaf: args.deafen,
          reason: args.reason,
        }),
      );
      return { userId: args.userId, mute: args.mute, deafen: args.deafen };
    },
  }),
];
