import {
  type AllowedMentions,
  type Attachment,
  ChannelTypes,
  type CreateMessageOptions,
  type EmbedField,
  type EmbedOptions,
  type GetChannelMessagesOptions,
  type Message,
} from "oceanic.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import type { FileSource, LoadedFile } from "../files.ts";
import { ToolError } from "../tool.ts";
import { definedOnly } from "./util.ts";

export { definedOnly };

/** The longest text that Discord accepts in one message. */
export const MAX_CONTENT_LENGTH = 2000;

/** The most messages that one read or search returns. */
export const MAX_READ_LIMIT = 100;

/** Channels that message tools may post to or read, as the Java server allowed. */
const MESSAGE_CHANNEL_TYPES: readonly number[] = [
  ChannelTypes.GUILD_TEXT,
  ChannelTypes.GUILD_ANNOUNCEMENT,
  ChannelTypes.PUBLIC_THREAD,
  ChannelTypes.PRIVATE_THREAD,
  ChannelTypes.ANNOUNCEMENT_THREAD,
];

/** Fetches a channel and checks that it takes messages. */
export const requireMessageChannel = async (
  ctx: Context,
  channelId: string,
) => {
  const channel = await ctx.client.rest.channels.get(channelId);
  if (!MESSAGE_CHANNEL_TYPES.includes(channel.type)) {
    throw new ToolError(`Channel ${channelId} is not a text channel or thread`);
  }
  return channel;
};

/** The server ID of a guild channel or thread, or `null` for a DM. */
export const guildIdOf = (channel: object): string | null =>
  "guildID" in channel && typeof channel.guildID === "string"
    ? channel.guildID
    : null;

export const jumpUrl = (
  guildId: string | null,
  channelId: string,
  messageId: string,
): string =>
  `https://discord.com/channels/${guildId ?? "@me"}/${channelId}/${messageId}`;

/** Pings for `@everyone`, `@here`, and roles stay off unless `allowEveryone` is true. Users stay mentionable. */
export const mentionPolicy = (allowEveryone: boolean): AllowedMentions => ({
  everyone: allowEveryone,
  roles: allowEveryone,
  users: true,
  repliedUser: true,
});

export const fileFields = {
  filePath: z
    .string()
    .min(1)
    .optional()
    .describe("Absolute path to a local file under DISCORD_MCP_FILE_ROOTS"),
  fileUrl: z
    .string()
    .min(1)
    .optional()
    .describe("Public https URL to download the file from"),
  fileData: z
    .string()
    .min(1)
    .optional()
    .describe("Base64 file contents, raw or as a data URI"),
  fileName: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe("File name shown in Discord. Required with fileData"),
};

/** One file source. Give exactly one of filePath, fileUrl, or fileData. */
export const fileSource = z.object(fileFields);

const embedFieldSchema = z.object({
  name: z.string().min(1).max(256).describe("Field title"),
  value: z.string().min(1).max(1024).describe("Field text"),
  inline: z
    .boolean()
    .optional()
    .describe("Whether the field sits beside the next field"),
});

export const embedSchema = z
  .object({
    title: z.string().min(1).max(256).optional().describe("Embed title"),
    description: z
      .string()
      .min(1)
      .max(4096)
      .optional()
      .describe("Embed body text"),
    url: z.url().optional().describe("Link that the title opens"),
    color: z
      .number()
      .int()
      .min(0)
      .max(0xffffff)
      .optional()
      .describe("Colour as an integer, such as 5793266"),
    fields: z
      .array(embedFieldSchema)
      .max(25)
      .optional()
      .describe("Up to 25 name and value fields"),
    footer: z
      .object({
        text: z.string().min(1).max(2048).describe("Footer text"),
      })
      .optional()
      .describe("Footer line"),
    image: z
      .object({
        url: z
          .string()
          .min(1)
          .describe(
            "Image URL, or attachment://<fileName> for an attached file",
          ),
      })
      .optional()
      .describe("Large image"),
    thumbnail: z
      .object({
        url: z
          .string()
          .min(1)
          .describe(
            "Image URL, or attachment://<fileName> for an attached file",
          ),
      })
      .optional()
      .describe("Small image at the top right"),
    author: z
      .object({
        name: z.string().min(1).max(256).describe("Author name"),
        url: z.url().optional().describe("Link that the author name opens"),
      })
      .optional()
      .describe("Author line"),
    timestamp: z.iso
      .datetime()
      .optional()
      .describe("ISO 8601 time shown in the embed"),
  })
  .describe("A rich embed block");

export type EmbedInput = z.output<typeof embedSchema>;

export const toEmbedOptions = (embed: EmbedInput): EmbedOptions =>
  definedOnly({
    title: embed.title,
    description: embed.description,
    url: embed.url,
    color: embed.color,
    timestamp: embed.timestamp,
    fields: embed.fields?.map(
      (field): EmbedField => definedOnly({ ...field }) as EmbedField,
    ),
    footer: embed.footer && { text: embed.footer.text },
    image: embed.image && { url: embed.image.url },
    thumbnail: embed.thumbnail && { url: embed.thumbnail.url },
    author: embed.author && definedOnly({ ...embed.author }),
  }) as EmbedOptions;

export interface MessageFields {
  content?: string | undefined;
  embeds?: EmbedInput[] | undefined;
  files?: LoadedFile[] | undefined;
  allowEveryone?: boolean | undefined;
}

/** Builds the content, embeds, files, and mention policy of a message. */
export const messageFields = (fields: MessageFields): CreateMessageOptions => {
  if (!fields.content && !fields.embeds?.length && !fields.files?.length) {
    throw new ToolError("Give message text, embeds, or files");
  }
  return definedOnly({
    content: fields.content,
    embeds: fields.embeds?.map(toEmbedOptions),
    files: fields.files,
    allowedMentions: mentionPolicy(fields.allowEveryone ?? false),
  });
};

/** Loads each file source in order, through the file loader that checks roots, hosts, and sizes. */
export const loadFiles = async (
  ctx: Context,
  sources: readonly FileSource[] | undefined,
): Promise<LoadedFile[]> => {
  // The files of one message share one budget, so many files cannot add up past the limit.
  const files: LoadedFile[] = [];
  let remaining = ctx.config.maxUploadBytes;
  for (const source of sources ?? []) {
    if (remaining <= 0) {
      throw new ToolError(
        `The files are over the total limit of ${ctx.config.maxUploadBytes} bytes`,
      );
    }
    const file = await ctx.files.load(source, remaining);
    remaining -= file.contents.length;
    files.push(file);
  }
  return files;
};

/** Maps `before`, `after`, or `around` to Oceanic's options, and rejects more than one cursor. */
export const historyOptions = (args: {
  count?: number | undefined;
  before?: string | undefined;
  after?: string | undefined;
  around?: string | undefined;
}): GetChannelMessagesOptions => {
  const cursors = [args.before, args.after, args.around].filter(
    (v) => v !== undefined,
  );
  if (cursors.length > 1) {
    throw new ToolError(
      "before, after, and around are mutually exclusive; give only one",
    );
  }
  return definedOnly({
    limit: args.count ?? MAX_READ_LIMIT,
    before: args.before,
    after: args.after,
    around: args.around,
  });
};

export interface AttachmentItem {
  id: string;
  filename: string;
  size: number;
  contentType: string | null;
  url: string;
  proxyUrl: string;
}

export const toAttachmentItem = (attachment: Attachment): AttachmentItem => ({
  id: attachment.id,
  filename: attachment.filename,
  size: attachment.size,
  contentType: attachment.contentType ?? null,
  url: attachment.url,
  proxyUrl: attachment.proxyURL,
});

export interface MessageItem {
  id: string;
  channelId: string;
  jumpUrl: string;
  content: string;
  timestamp: string;
  editedTimestamp: string | null;
  author: {
    id: string;
    username: string;
    globalName: string | null;
    bot: boolean;
    nick?: string | null;
  };
  attachments: AttachmentItem[];
  embedCount: number;
  replyTo: string | null;
}

/** The shape of a message in every read, search, and send result. */
export const toMessageItem = (message: Message): MessageItem => {
  const author: MessageItem["author"] = {
    id: message.author.id,
    username: message.author.username,
    globalName: message.author.globalName,
    bot: message.author.bot,
  };
  if (message.member) author.nick = message.member.nick;
  return {
    id: message.id,
    channelId: message.channelID,
    jumpUrl: jumpUrl(message.guildID ?? null, message.channelID, message.id),
    content: message.content,
    timestamp: message.timestamp.toISOString(),
    editedTimestamp: message.editedTimestamp?.toISOString() ?? null,
    author,
    attachments: message.attachments.toArray().map(toAttachmentItem),
    embedCount: message.embeds.length,
    replyTo: message.messageReference?.messageID ?? null,
  };
};
