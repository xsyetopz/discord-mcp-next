import { ChannelTypes } from "oceanic.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { defineTool, type Tool, ToolError } from "../tool.ts";
import { auditReason, guildId, snowflake } from "./schemas.ts";
import { channelTypeName, definedOnly, hasStatus } from "./util.ts";

/** A channel of a server, as `rest.guilds.getChannels` returns it. It leaves out threads. */
export type GuildChannel = Awaited<
  ReturnType<Context["client"]["rest"]["guilds"]["getChannels"]>
>[number];

/** The channel with the given ID, which must be in the server whose channels are given. */
export const findChannel = (
  channels: GuildChannel[],
  channelId: string,
): GuildChannel => {
  const channel = channels.find((c) => c.id === channelId);
  if (!channel)
    throw new ToolError(`Channel ${channelId} was not found in this server`);
  return channel;
};

/** The category with the given ID, which must be a category of the server whose channels are given. */
export const findCategory = (
  channels: GuildChannel[],
  categoryId: string,
): GuildChannel => {
  const category = channels.find(
    (c) => c.id === categoryId && c.type === ChannelTypes.GUILD_CATEGORY,
  );
  if (!category)
    throw new ToolError(`Category ${categoryId} was not found in this server`);
  return category;
};

/** The fields that the tools return. A field that the channel type lacks is left out of the JSON. */
export const describeChannel = (channel: GuildChannel) => ({
  id: channel.id,
  name: channel.name,
  type: channelTypeName(channel.type),
  parentId: channel.parentID,
  position: "position" in channel ? channel.position : undefined,
  topic: "topic" in channel ? channel.topic : undefined,
  nsfw: "nsfw" in channel ? channel.nsfw : undefined,
  rateLimitPerUser:
    "rateLimitPerUser" in channel ? channel.rateLimitPerUser : undefined,
});

/** Runs a call on one channel, and turns Discord's 404 into a ToolError, because the channel is gone. */
export const onChannel = async <T>(
  channelId: string,
  call: () => Promise<T>,
): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (hasStatus(error, 404))
      throw new ToolError(`Channel ${channelId} not found`);
    throw error;
  }
};

/** The parent for an edit: `undefined` keeps it, an empty string removes it, and an ID must be a category of the server. */
const parentFor = (
  channels: GuildChannel[],
  categoryId: string | undefined,
) => {
  if (categoryId === undefined) return undefined;
  if (categoryId === "") return null;
  return findCategory(channels, categoryId).id;
};

const parentParam = z
  .union([snowflake("Category ID"), z.literal("")])
  .optional()
  .describe(
    "Category ID. An empty string removes the channel from its category.",
  );

const slowmode = z
  .number()
  .int()
  .min(0)
  .max(21600)
  .optional()
  .describe("Slowmode in seconds (0-21600)");

const position = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe("Position in channel list");

const channelName = z.string().min(1).max(100);

export const channelTools: Tool[] = [
  defineTool({
    name: "delete_channel",
    title: "Delete channel",
    description: "Delete a channel of a Discord server.",
    group: "channels",
    access: "destructive",
    input: z.object({
      guildId,
      channelId: snowflake("Channel ID"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const channels = await ctx.client.rest.guilds.getChannels(
        ctx.guildId(args.guildId),
      );
      const channel = findChannel(channels, args.channelId);
      await onChannel(channel.id, () =>
        ctx.client.rest.channels.delete(channel.id, args.reason),
      );
      return { deleted: true, ...describeChannel(channel) };
    },
  }),
  defineTool({
    name: "create_text_channel",
    title: "Create text channel",
    description: "Create a text channel in a Discord server.",
    group: "channels",
    access: "write",
    input: z.object({
      guildId,
      name: channelName.describe("Channel name"),
      categoryId: snowflake("Category ID")
        .optional()
        .describe("Category ID to create the channel in"),
      topic: z.string().max(1024).optional().describe("Channel topic"),
      nsfw: z.boolean().optional().describe("Whether the channel is NSFW"),
      slowmode,
      position,
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const channels = await ctx.client.rest.guilds.getChannels(id);
      const parentID =
        args.categoryId === undefined
          ? undefined
          : findCategory(channels, args.categoryId).id;
      const channel = await ctx.client.rest.guilds.createChannel(
        id,
        ChannelTypes.GUILD_TEXT,
        {
          name: args.name,
          ...definedOnly({
            parentID,
            topic: args.topic,
            nsfw: args.nsfw,
            rateLimitPerUser: args.slowmode,
            position: args.position,
            reason: args.reason,
          }),
        },
      );
      return describeChannel(channel);
    },
  }),
  defineTool({
    name: "find_channel",
    title: "Find channel",
    description:
      "Find channels by name in a Discord server. The name is matched without case, and every match is returned.",
    group: "channels",
    access: "read",
    input: z.object({
      guildId,
      channelName: channelName.describe("Channel name to find"),
    }),
    run: async (args, ctx) => {
      const channels = await ctx.client.rest.guilds.getChannels(
        ctx.guildId(args.guildId),
      );
      const wanted = args.channelName.toLowerCase();
      const matches = channels.filter((c) => c.name.toLowerCase() === wanted);
      if (matches.length === 0)
        throw new ToolError(`No channel named ${args.channelName} was found`);
      return matches.map(describeChannel);
    },
  }),
  defineTool({
    name: "list_channels",
    title: "List channels",
    description:
      "List the channels of a Discord server. Threads are not included.",
    group: "channels",
    access: "read",
    input: z.object({ guildId }),
    run: async (args, ctx) =>
      (await ctx.client.rest.guilds.getChannels(ctx.guildId(args.guildId))).map(
        describeChannel,
      ),
  }),
  defineTool({
    name: "edit_text_channel",
    title: "Edit text channel",
    description:
      "Edit a text or announcement channel: name, topic, NSFW, slowmode, category, or position. Only the given fields change.",
    group: "channels",
    access: "write",
    input: z.object({
      guildId,
      channelId: snowflake("Channel ID"),
      name: channelName.optional().describe("New channel name"),
      topic: z.string().max(1024).optional().describe("New channel topic"),
      nsfw: z.boolean().optional().describe("Whether the channel is NSFW"),
      slowmode,
      categoryId: parentParam,
      position,
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const channels = await ctx.client.rest.guilds.getChannels(
        ctx.guildId(args.guildId),
      );
      const channel = findChannel(channels, args.channelId);
      if (
        channel.type !== ChannelTypes.GUILD_TEXT &&
        channel.type !== ChannelTypes.GUILD_ANNOUNCEMENT
      )
        throw new ToolError(
          `Channel ${channel.id} is not a text or announcement channel`,
        );
      if (
        args.slowmode !== undefined &&
        channel.type !== ChannelTypes.GUILD_TEXT
      )
        throw new ToolError("slowmode is supported only for text channels");
      const edited = await onChannel(channel.id, () =>
        ctx.client.rest.channels.edit<GuildChannel>(
          channel.id,
          definedOnly({
            name: args.name,
            topic: args.topic,
            // Oceanic types nsfw as a string, but Discord takes a boolean and Oceanic passes it through.
            nsfw: args.nsfw as unknown as string,
            rateLimitPerUser: args.slowmode,
            parentID: parentFor(channels, args.categoryId),
            position: args.position,
            reason: args.reason,
          }),
        ),
      );
      return describeChannel(edited);
    },
  }),
  defineTool({
    name: "get_channel_info",
    title: "Get channel info",
    description:
      "Get the details of a channel of a Discord server, including when it was created.",
    group: "channels",
    access: "read",
    input: z.object({ guildId, channelId: snowflake("Channel ID") }),
    run: async (args, ctx) => {
      const channels = await ctx.client.rest.guilds.getChannels(
        ctx.guildId(args.guildId),
      );
      const channel = findChannel(channels, args.channelId);
      return {
        ...describeChannel(channel),
        createdAt: channel.createdAt.toISOString(),
      };
    },
  }),
  defineTool({
    name: "move_channel",
    title: "Move channel",
    description:
      "Move a channel to another category, or out of its category, and change its position. Categories cannot be moved.",
    group: "channels",
    access: "write",
    input: z.object({
      guildId,
      channelId: snowflake("Channel ID"),
      categoryId: parentParam,
      position,
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const channels = await ctx.client.rest.guilds.getChannels(
        ctx.guildId(args.guildId),
      );
      const channel = findChannel(channels, args.channelId);
      if (channel.type === ChannelTypes.GUILD_CATEGORY)
        throw new ToolError(
          `Channel ${channel.id} is a category and cannot be moved`,
        );
      const edited = await onChannel(channel.id, () =>
        ctx.client.rest.channels.edit<GuildChannel>(
          channel.id,
          definedOnly({
            parentID: parentFor(channels, args.categoryId),
            position: args.position,
            reason: args.reason,
          }),
        ),
      );
      return describeChannel(edited);
    },
  }),
];
