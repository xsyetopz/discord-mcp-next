import { z } from "zod";
import type { Context } from "../context.ts";
import { defineTool, type Tool } from "../tool.ts";
import {
  embedSchema,
  fileFields,
  fileSource,
  historyOptions,
  loadFiles,
  MAX_CONTENT_LENGTH,
  MAX_READ_LIMIT,
  messageFields,
  toMessageItem,
} from "./format.ts";
import {
  afterParam,
  allowEveryoneParam,
  aroundParam,
  beforeParam,
  countParam,
  messageIdParam,
} from "./messages.ts";
import { snowflake } from "./schemas.ts";
import { definedOnly } from "./util.ts";

const userIdParam = snowflake("User ID").describe(
  "User ID (a Discord snowflake ID) of the DM partner",
);

/** Opens, or reuses, the DM channel with a user. */
const dmChannelOf = (ctx: Context, userId: string) =>
  ctx.client.rest.channels.createDM(userId);

const messageText = z
  .string()
  .min(1)
  .max(MAX_CONTENT_LENGTH)
  .optional()
  .describe(`Message text, up to ${MAX_CONTENT_LENGTH} characters`);

export const dmTools: Tool[] = [
  defineTool({
    name: "send_private_message",
    title: "Send private message",
    description:
      "Send a direct message to a user. Give text, embeds, or files. @everyone, @here, and roles do not ping unless allowEveryone is true.",
    group: "dms",
    access: "write",
    input: z.object({
      userId: userIdParam,
      message: messageText,
      embeds: z
        .array(embedSchema)
        .max(10)
        .optional()
        .describe("Up to 10 rich embeds"),
      files: z
        .array(fileSource)
        .max(10)
        .optional()
        .describe("Up to 10 files to attach"),
      allowEveryone: allowEveryoneParam,
    }),
    run: async (args, ctx) => {
      const dm = await dmChannelOf(ctx, args.userId);
      const files = await loadFiles(ctx, args.files);
      const sent = await ctx.client.rest.channels.createMessage(
        dm.id,
        messageFields({
          content: args.message,
          embeds: args.embeds,
          files,
          allowEveryone: args.allowEveryone,
        }),
      );
      return toMessageItem(sent);
    },
  }),
  defineTool({
    name: "send_private_file",
    title: "Send private file",
    description:
      "Send a file as a direct message to a user, from a local path under the file roots, a public https URL, or base64 data. Give exactly one source.",
    group: "dms",
    access: "write",
    input: z.object({
      userId: userIdParam,
      ...fileFields,
      message: messageText.describe("Text to post with the file"),
      allowEveryone: allowEveryoneParam,
    }),
    run: async (args, ctx) => {
      const dm = await dmChannelOf(ctx, args.userId);
      const file = await ctx.files.load(
        definedOnly({
          filePath: args.filePath,
          fileUrl: args.fileUrl,
          fileData: args.fileData,
          fileName: args.fileName,
        }),
      );
      const sent = await ctx.client.rest.channels.createMessage(
        dm.id,
        messageFields({
          content: args.message,
          files: [file],
          allowEveryone: args.allowEveryone,
        }),
      );
      return toMessageItem(sent);
    },
  }),
  defineTool({
    name: "edit_private_message",
    title: "Edit private message",
    description:
      "Edit a direct message that the bot sent to a user. Give new text, new embeds, or both. Embeds replace the existing embeds.",
    group: "dms",
    access: "write",
    input: z.object({
      userId: userIdParam,
      messageId: messageIdParam,
      newMessage: messageText.describe("New message text"),
      embeds: z
        .array(embedSchema)
        .max(10)
        .optional()
        .describe("New rich embeds, up to 10. Replaces the existing embeds"),
      allowEveryone: allowEveryoneParam,
    }),
    run: async (args, ctx) => {
      const dm = await dmChannelOf(ctx, args.userId);
      const edited = await ctx.client.rest.channels.editMessage(
        dm.id,
        args.messageId,
        messageFields({
          content: args.newMessage,
          embeds: args.embeds,
          allowEveryone: args.allowEveryone,
        }),
      );
      return toMessageItem(edited);
    },
  }),
  defineTool({
    name: "delete_private_message",
    title: "Delete private message",
    description: "Delete a direct message from the DM with a user.",
    group: "dms",
    access: "destructive",
    input: z.object({
      userId: userIdParam,
      messageId: messageIdParam,
    }),
    run: async (args, ctx) => {
      const dm = await dmChannelOf(ctx, args.userId);
      await ctx.client.rest.channels.deleteMessage(dm.id, args.messageId);
      return {
        deleted: true,
        channelId: dm.id,
        messageId: args.messageId,
      };
    },
  }),
  defineTool({
    name: "read_private_messages",
    title: "Read private messages",
    description: `Read the newest direct messages with a user, newest first. Page with at most one of before, after, or around. Returns up to ${MAX_READ_LIMIT} messages.`,
    group: "dms",
    access: "read",
    input: z.object({
      userId: userIdParam,
      count: countParam,
      before: beforeParam,
      after: afterParam,
      around: aroundParam,
    }),
    run: async (args, ctx) => {
      const options = historyOptions(args);
      const dm = await dmChannelOf(ctx, args.userId);
      const messages = await ctx.client.rest.channels.getMessages(
        dm.id,
        options,
      );
      return {
        channelId: dm.id,
        count: messages.length,
        messages: messages.map(toMessageItem),
      };
    },
  }),
];
