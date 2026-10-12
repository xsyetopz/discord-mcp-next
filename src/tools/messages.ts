import { DiscordRESTError, type Message } from "oceanic.js";
import { z } from "zod";
import { defineTool, type Tool, ToolError } from "../tool.ts";
import {
  definedOnly,
  embedSchema,
  fileFields,
  fileSource,
  guildIdOf,
  historyOptions,
  jumpUrl,
  loadFiles,
  MAX_CONTENT_LENGTH,
  MAX_READ_LIMIT,
  messageFields,
  requireMessageChannel,
  toAttachmentItem,
  toMessageItem,
} from "./format.ts";
import { guildId, snowflake } from "./schemas.ts";

const channelIdParam = snowflake("Channel ID");
export const messageIdParam = snowflake("Message ID");
export const countParam = z
  .number()
  .int()
  .min(1)
  .max(MAX_READ_LIMIT)
  .optional()
  .describe(
    `Number of messages to return, from 1 to ${MAX_READ_LIMIT}. Defaults to ${MAX_READ_LIMIT}`,
  );
export const beforeParam = snowflake("Message ID")
  .optional()
  .describe("Return messages sent before this message ID");
export const afterParam = snowflake("Message ID")
  .optional()
  .describe("Return messages sent after this message ID");
export const aroundParam = snowflake("Message ID")
  .optional()
  .describe("Return messages around this message ID");
export const allowEveryoneParam = z
  .boolean()
  .optional()
  .describe("Let @everyone, @here, and role mentions ping. Defaults to false");

/** The Discord search filters that Oceanic types. */
const SEARCH_HAS = [
  "link",
  "embed",
  "file",
  "video",
  "image",
  "sound",
] as const;

/** Maps an index that is not ready, or a refused search, to an error that tells the caller what to do. */
const searchFailure = (error: unknown): unknown => {
  if (error instanceof DiscordRESTError && error.status === 403) {
    return new ToolError(
      "Discord refused the search with 403 Forbidden. Check that the bot can view the channels that the search covers, and that the server allows message search.",
    );
  }
  if (
    error instanceof Error &&
    error.message.includes("index not being available")
  ) {
    return new ToolError(
      "Discord's message search index for this server is not ready yet. Wait a few minutes, then run the search again.",
    );
  }
  return error;
};

export const messageTools: Tool[] = [
  defineTool({
    name: "send_message",
    title: "Send message",
    description:
      "Send a message to a channel or thread. Give text, embeds, or files. @everyone, @here, and roles do not ping unless allowEveryone is true.",
    group: "messages",
    access: "write",
    input: z.object({
      channelId: channelIdParam,
      message: z
        .string()
        .min(1)
        .max(MAX_CONTENT_LENGTH)
        .optional()
        .describe(`Message text, up to ${MAX_CONTENT_LENGTH} characters`),
      replyToMessageId: snowflake("Message ID")
        .optional()
        .describe("Message ID to reply to, in the same channel"),
      failIfNotExists: z
        .boolean()
        .optional()
        .describe(
          "When replying, fail if the replied message is gone. Defaults to true",
        ),
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
      if (args.failIfNotExists !== undefined && !args.replyToMessageId) {
        throw new ToolError("failIfNotExists needs replyToMessageId");
      }
      await requireMessageChannel(ctx, args.channelId);
      const files = await loadFiles(ctx, args.files);
      const options = messageFields({
        content: args.message,
        embeds: args.embeds,
        files,
        allowEveryone: args.allowEveryone,
      });
      const sent = await ctx.client.rest.channels.createMessage(
        args.channelId,
        definedOnly({
          ...options,
          messageReference: args.replyToMessageId
            ? {
                channelID: args.channelId,
                messageID: args.replyToMessageId,
                failIfNotExists: args.failIfNotExists ?? true,
              }
            : undefined,
        }),
      );
      return toMessageItem(sent);
    },
  }),
  defineTool({
    name: "send_file",
    title: "Send file",
    description:
      "Upload a file to a channel or thread, from a local path under the file roots, a public https URL, or base64 data. Give exactly one source.",
    group: "messages",
    access: "write",
    input: z.object({
      channelId: channelIdParam,
      ...fileFields,
      message: z
        .string()
        .min(1)
        .max(MAX_CONTENT_LENGTH)
        .optional()
        .describe("Text to post with the file"),
      allowEveryone: allowEveryoneParam,
    }),
    run: async (args, ctx) => {
      await requireMessageChannel(ctx, args.channelId);
      const file = await ctx.files.load(
        definedOnly({
          filePath: args.filePath,
          fileUrl: args.fileUrl,
          fileData: args.fileData,
          fileName: args.fileName,
        }),
      );
      const sent = await ctx.client.rest.channels.createMessage(
        args.channelId,
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
    name: "edit_message",
    title: "Edit message",
    description:
      "Edit a message in a channel or thread. Give new text, new embeds, or both. Embeds replace the existing embeds.",
    group: "messages",
    access: "write",
    input: z.object({
      channelId: channelIdParam,
      messageId: messageIdParam,
      newMessage: z
        .string()
        .min(1)
        .max(MAX_CONTENT_LENGTH)
        .optional()
        .describe(`New message text, up to ${MAX_CONTENT_LENGTH} characters`),
      embeds: z
        .array(embedSchema)
        .max(10)
        .optional()
        .describe("New rich embeds, up to 10. Replaces the existing embeds"),
      allowEveryone: allowEveryoneParam,
    }),
    run: async (args, ctx) => {
      if (!args.newMessage && !args.embeds) {
        throw new ToolError("Give newMessage, embeds, or both");
      }
      await requireMessageChannel(ctx, args.channelId);
      const edited = await ctx.client.rest.channels.editMessage(
        args.channelId,
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
    name: "delete_message",
    title: "Delete message",
    description: "Delete a message from a channel or thread.",
    group: "messages",
    access: "destructive",
    input: z.object({
      channelId: channelIdParam,
      messageId: messageIdParam,
    }),
    run: async (args, ctx) => {
      await requireMessageChannel(ctx, args.channelId);
      await ctx.client.rest.channels.deleteMessage(
        args.channelId,
        args.messageId,
      );
      return {
        deleted: true,
        channelId: args.channelId,
        messageId: args.messageId,
      };
    },
  }),
  defineTool({
    name: "read_messages",
    title: "Read messages",
    description: `Read the newest messages of a channel or thread, newest first. Page with at most one of before, after, or around. Returns up to ${MAX_READ_LIMIT} messages.`,
    group: "messages",
    access: "read",
    input: z.object({
      channelId: channelIdParam,
      count: countParam,
      before: beforeParam,
      after: afterParam,
      around: aroundParam,
    }),
    run: async (args, ctx) => {
      const options = historyOptions(args);
      await requireMessageChannel(ctx, args.channelId);
      const messages = await ctx.client.rest.channels.getMessages(
        args.channelId,
        options,
      );
      return {
        channelId: args.channelId,
        count: messages.length,
        messages: messages.map(toMessageItem),
      };
    },
  }),
  defineTool({
    name: "get_message",
    title: "Get message",
    description:
      "Get one message of a channel or thread, in the same shape as the items of read_messages.",
    group: "messages",
    access: "read",
    input: z.object({
      channelId: channelIdParam,
      messageId: messageIdParam,
    }),
    run: async (args, ctx) => {
      await requireMessageChannel(ctx, args.channelId);
      const message = await ctx.client.rest.channels.getMessage(
        args.channelId,
        args.messageId,
      );
      return toMessageItem(message);
    },
  }),
  defineTool({
    name: "search_guild_messages",
    title: "Search server messages",
    description:
      "Search the messages of a server with Discord's search index. Returns the total result count and up to 25 messages per call. Use offset to page.",
    group: "messages",
    access: "read",
    input: z.object({
      guildId,
      content: z
        .string()
        .min(1)
        .max(MAX_CONTENT_LENGTH)
        .optional()
        .describe("Text to search for"),
      authorId: snowflake("Author user ID")
        .optional()
        .describe("Only messages sent by this user"),
      mentions: snowflake("Mentioned user ID")
        .optional()
        .describe("Only messages that mention this user"),
      channelId: snowflake("Channel ID")
        .optional()
        .describe("Only messages in this channel"),
      has: z
        .array(z.enum(SEARCH_HAS))
        .optional()
        .describe("Only messages that contain these kinds of content"),
      minId: snowflake("Message ID")
        .optional()
        .describe("Only messages sent after this message ID"),
      maxId: snowflake("Message ID")
        .optional()
        .describe("Only messages sent before this message ID"),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Number of results to skip, for paging"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(25)
        .optional()
        .describe("Number of messages to return, from 1 to 25. Defaults to 25"),
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const result = await ctx.client.rest.guilds
        .searchMessages(
          id,
          definedOnly({
            content: args.content,
            authorIDs: args.authorId ? [args.authorId] : undefined,
            mentions: args.mentions ? [args.mentions] : undefined,
            channelIDs: args.channelId ? [args.channelId] : undefined,
            has: args.has,
            minID: args.minId,
            maxID: args.maxId,
            offset: args.offset,
          }),
        )
        .catch((error: unknown) => {
          throw searchFailure(error);
        });
      // Oceanic drops Discord's `hit` flag, so every message of the result groups is returned once.
      const unique = new Map<string, Message>();
      for (const group of result.messages) {
        for (const message of group) unique.set(message.id, message);
      }
      const messages = [...unique.values()]
        .slice(0, args.limit ?? 25)
        .map(toMessageItem);
      return {
        totalResults: result.totalResults,
        count: messages.length,
        messages,
      };
    },
  }),
  defineTool({
    name: "add_reaction",
    title: "Add reaction",
    description:
      "Add an emoji reaction to a message. Use a Unicode emoji, or name:id for a custom emoji.",
    group: "messages",
    access: "write",
    input: z.object({
      channelId: channelIdParam,
      messageId: messageIdParam,
      emoji: z
        .string()
        .min(1)
        .describe("Unicode emoji, or name:id for a custom emoji"),
    }),
    run: async (args, ctx) => {
      const channel = await requireMessageChannel(ctx, args.channelId);
      await ctx.client.rest.channels.createReaction(
        args.channelId,
        args.messageId,
        args.emoji,
      );
      return {
        added: true,
        emoji: args.emoji,
        jumpUrl: jumpUrl(guildIdOf(channel), args.channelId, args.messageId),
      };
    },
  }),
  defineTool({
    name: "remove_reaction",
    title: "Remove reaction",
    description:
      "Remove the bot's own emoji reaction from a message. Use a Unicode emoji, or name:id for a custom emoji.",
    group: "messages",
    access: "write",
    input: z.object({
      channelId: channelIdParam,
      messageId: messageIdParam,
      emoji: z
        .string()
        .min(1)
        .describe("Unicode emoji, or name:id for a custom emoji"),
    }),
    run: async (args, ctx) => {
      const channel = await requireMessageChannel(ctx, args.channelId);
      await ctx.client.rest.channels.deleteReaction(
        args.channelId,
        args.messageId,
        args.emoji,
      );
      return {
        removed: true,
        emoji: args.emoji,
        jumpUrl: jumpUrl(guildIdOf(channel), args.channelId, args.messageId),
      };
    },
  }),
  defineTool({
    name: "get_attachment",
    title: "Get attachments",
    description:
      "Get the metadata of a message's attachments: file name, size, content type, and URLs. Does not download files.",
    group: "messages",
    access: "read",
    input: z.object({
      channelId: channelIdParam,
      messageId: messageIdParam,
      attachmentId: snowflake("Attachment ID")
        .optional()
        .describe("Only this attachment. Omit to get all attachments"),
    }),
    run: async (args, ctx) => {
      await requireMessageChannel(ctx, args.channelId);
      const message = await ctx.client.rest.channels.getMessage(
        args.channelId,
        args.messageId,
      );
      const attachments = message.attachments.toArray();
      const selected = args.attachmentId
        ? attachments.filter((a) => a.id === args.attachmentId)
        : attachments;
      if (args.attachmentId && selected.length === 0) {
        throw new ToolError(
          `Attachment ${args.attachmentId} is not on message ${args.messageId}`,
        );
      }
      return {
        messageId: args.messageId,
        attachments: selected.map(toAttachmentItem),
      };
    },
  }),
];
