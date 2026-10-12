import { ChannelTypes } from "oceanic.js";
import { z } from "zod";
import { defineTool, type Tool, ToolError } from "../tool.ts";
import { guildId, snowflake } from "./schemas.ts";
import { channelTypeName } from "./util.ts";

/** Channels that can start a thread from one of their messages. */
const THREAD_PARENT_TYPES: readonly number[] = [
  ChannelTypes.GUILD_TEXT,
  ChannelTypes.GUILD_ANNOUNCEMENT,
];

/** The shape of a thread in every thread result. */
interface ThreadLike {
  id: string;
  name: string;
  type: ChannelTypes;
  parentID: string;
  messageCount: number;
  threadMetadata: { archived: boolean };
}

const threadItem = (thread: ThreadLike, parentName: string | null) => ({
  id: thread.id,
  name: thread.name,
  type: channelTypeName(thread.type),
  parentId: thread.parentID,
  parentName,
  archived: thread.threadMetadata.archived,
  messageCount: thread.messageCount,
});

export const threadTools: Tool[] = [
  defineTool({
    name: "list_active_threads",
    title: "List active threads",
    description:
      "List the active threads of a server, with the ID and name of each thread's parent channel.",
    group: "threads",
    access: "read",
    input: z.object({ guildId }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const [{ threads }, channels] = await Promise.all([
        ctx.client.rest.guilds.getActiveThreads(id),
        ctx.client.rest.guilds.getChannels(id),
      ]);
      const parentNames = new Map(channels.map((c) => [c.id, c.name]));
      return {
        count: threads.length,
        threads: threads.map((thread) =>
          threadItem(thread, parentNames.get(thread.parentID) ?? null),
        ),
      };
    },
  }),
  defineTool({
    name: "create_thread_from_message",
    title: "Create thread from message",
    description:
      "Start a thread from a message in a text or announcement channel. The thread is named after the given name.",
    group: "threads",
    access: "write",
    input: z.object({
      channelId: snowflake("Channel ID").describe(
        "Text or announcement channel that holds the message",
      ),
      messageId: snowflake("Message ID").describe(
        "Message to start the thread from",
      ),
      name: z
        .string()
        .min(1)
        .max(100)
        .describe("Thread name, up to 100 characters"),
      autoArchiveDuration: z
        .literal([60, 1440, 4320, 10080])
        .optional()
        .describe(
          "Minutes of inactivity before the thread archives: 60, 1440, 4320, or 10080. Defaults to the channel setting",
        ),
    }),
    run: async (args, ctx) => {
      const channel = await ctx.client.rest.channels.get(args.channelId);
      if (!THREAD_PARENT_TYPES.includes(channel.type)) {
        throw new ToolError(
          `Channel ${args.channelId} is not a text or announcement channel`,
        );
      }
      const thread = await ctx.client.rest.channels.startThreadFromMessage(
        args.channelId,
        args.messageId,
        {
          name: args.name,
          ...(args.autoArchiveDuration === undefined
            ? {}
            : { autoArchiveDuration: args.autoArchiveDuration }),
        },
      );
      return threadItem(thread, "name" in channel ? channel.name : null);
    },
  }),
];
