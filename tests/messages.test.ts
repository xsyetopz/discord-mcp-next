import { describe, expect, test } from "bun:test";
import { ChannelTypes } from "oceanic.js";
import { messageTools } from "../src/tools/messages.ts";
import {
  callTool,
  type FakeRest,
  fakeContext,
  recorder,
  restError,
} from "./harness.ts";
import { fakeAttachment, fakeMessage } from "./messages-harness.ts";

const CHANNEL = "300000000000000001";
const MESSAGE = "200000000000000009";

/** Channel routes that answer as a text channel, with the given message routes. */
const textChannel = (channels: Record<string, unknown> = {}): FakeRest => ({
  channels: {
    get: async () => ({ id: CHANNEL, type: ChannelTypes.GUILD_TEXT }),
    ...channels,
  },
});

describe("send_message", () => {
  test("a reply references the replied message and fails when it is gone by default", async () => {
    const createMessage = recorder(fakeMessage());
    const ctx = fakeContext(textChannel({ createMessage }));

    const result = await callTool(messageTools, ctx, "send_message", {
      channelId: CHANNEL,
      message: "hi",
      replyToMessageId: MESSAGE,
    });

    expect(result.isError).toBe(false);
    const [channelId, options] = createMessage.calls[0] as [
      string,
      { messageReference: unknown },
    ];
    expect(channelId).toBe(CHANNEL);
    expect(options.messageReference).toEqual({
      channelID: CHANNEL,
      messageID: MESSAGE,
      failIfNotExists: true,
    });
  });

  test("a reply passes failIfNotExists false when the caller asks for it", async () => {
    const createMessage = recorder(fakeMessage());
    const ctx = fakeContext(textChannel({ createMessage }));

    await callTool(messageTools, ctx, "send_message", {
      channelId: CHANNEL,
      message: "hi",
      replyToMessageId: MESSAGE,
      failIfNotExists: false,
    });

    const [, options] = createMessage.calls[0] as [
      string,
      { messageReference: { failIfNotExists: boolean } },
    ];
    expect(options.messageReference.failIfNotExists).toBe(false);
  });

  test("is an error with no text, embeds, or files, and sends nothing", async () => {
    const createMessage = recorder(fakeMessage());
    const ctx = fakeContext(textChannel({ createMessage }));

    const result = await callTool(messageTools, ctx, "send_message", {
      channelId: CHANNEL,
    });

    expect(result.isError).toBe(true);
    expect(createMessage.calls).toHaveLength(0);
  });

  test("does not ping @everyone or roles unless allowEveryone is true", async () => {
    const createMessage = recorder(fakeMessage());
    const ctx = fakeContext(textChannel({ createMessage }));

    await callTool(messageTools, ctx, "send_message", {
      channelId: CHANNEL,
      message: "@everyone hi",
    });
    await callTool(messageTools, ctx, "send_message", {
      channelId: CHANNEL,
      message: "@everyone hi",
      allowEveryone: true,
    });

    const mentionsOf = (call: unknown[]) =>
      (call[1] as { allowedMentions: { everyone: boolean; roles: boolean } })
        .allowedMentions;
    expect(mentionsOf(createMessage.calls[0] ?? [])).toMatchObject({
      everyone: false,
      roles: false,
    });
    expect(mentionsOf(createMessage.calls[1] ?? [])).toMatchObject({
      everyone: true,
      roles: true,
    });
  });
});

describe("send_file", () => {
  test("sends the file that the loader returned", async () => {
    const file = { name: "notes.txt", contents: Buffer.from("hello") };
    const load = recorder(file);
    const createMessage = recorder(fakeMessage());
    const ctx = fakeContext(textChannel({ createMessage }), {
      files: { load },
    });

    const result = await callTool(messageTools, ctx, "send_file", {
      channelId: CHANNEL,
      filePath: "/srv/files/notes.txt",
    });

    expect(result.isError).toBe(false);
    expect(load.calls[0]).toEqual([{ filePath: "/srv/files/notes.txt" }]);
    const [, options] = createMessage.calls[0] as [
      string,
      { files: unknown[] },
    ];
    expect(options.files).toEqual([file]);
  });
});

describe("read_messages", () => {
  test.each([
    ["before", "after"],
    ["before", "around"],
    ["after", "around"],
  ])("rejects %s together with %s, and reads nothing", async (a, b) => {
    const getMessages = recorder([fakeMessage()]);
    const ctx = fakeContext(textChannel({ getMessages }));

    const result = await callTool(messageTools, ctx, "read_messages", {
      channelId: CHANNEL,
      [a]: MESSAGE,
      [b]: MESSAGE,
    });

    expect(result.isError).toBe(true);
    expect(getMessages.calls).toHaveLength(0);
  });

  test("passes one cursor and the count to Discord", async () => {
    const getMessages = recorder([fakeMessage()]);
    const ctx = fakeContext(textChannel({ getMessages }));

    await callTool(messageTools, ctx, "read_messages", {
      channelId: CHANNEL,
      count: 5,
      before: MESSAGE,
    });

    expect(getMessages.calls[0]).toEqual([
      CHANNEL,
      { limit: 5, before: MESSAGE },
    ]);
  });

  test("returns each message in the item shape", async () => {
    const message = fakeMessage({
      attachments: { toArray: () => [fakeAttachment()] },
      messageReference: { messageID: MESSAGE },
    });
    const ctx = fakeContext(textChannel({ getMessages: recorder([message]) }));

    const result = await callTool(messageTools, ctx, "read_messages", {
      channelId: CHANNEL,
    });

    expect(result.isError).toBe(false);
    const data = result.data as {
      channelId: string;
      count: number;
      messages: Array<Record<string, unknown>>;
    };
    expect(data.count).toBe(1);
    const item = data.messages[0];
    expect(item).toMatchObject({
      id: "200000000000000001",
      channelId: CHANNEL,
      jumpUrl: `https://discord.com/channels/111111111111111111/${CHANNEL}/200000000000000001`,
      content: "hello",
      author: {
        id: "400000000000000001",
        username: "alex",
        globalName: "Alex",
        bot: false,
      },
      attachments: [
        {
          id: "500000000000000001",
          filename: "notes.txt",
          size: 12,
          contentType: "text/plain",
          url: "https://cdn.discordapp.com/attachments/notes.txt",
          proxyUrl: "https://media.discordapp.net/attachments/notes.txt",
        },
      ],
      replyTo: MESSAGE,
    });
  });
});

describe("get_message", () => {
  test("returns the message in the read_messages item shape", async () => {
    const ctx = fakeContext(
      textChannel({ getMessage: recorder(fakeMessage()) }),
    );

    const result = await callTool(messageTools, ctx, "get_message", {
      channelId: CHANNEL,
      messageId: "200000000000000001",
    });

    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({
      id: "200000000000000001",
      channelId: CHANNEL,
      replyTo: null,
    });
  });
});

describe("search_guild_messages", () => {
  test("is an error when Discord refuses the search with 403", async () => {
    const ctx = fakeContext({
      guilds: {
        searchMessages: async () => {
          throw restError(403, 0, "GET");
        },
      },
    });

    const result = await callTool(messageTools, ctx, "search_guild_messages", {
      content: "hello",
    });

    expect(result.isError).toBe(true);
  });
});
