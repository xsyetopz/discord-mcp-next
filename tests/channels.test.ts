import { describe, expect, test } from "bun:test";
import { ChannelTypes } from "oceanic.js";
import { channelTools } from "../src/tools/channels.ts";
import {
  callTool,
  DEFAULT_GUILD,
  fakeContext,
  recorder,
  restError,
} from "./harness.ts";

const TEXT = "200000000000000001";
const VOICE = "200000000000000002";
const CATEGORY = "300000000000000001";
const OTHER_GUILD_TEXT = "200000000000000009";

/** A guild channel as Oceanic returns it, with the fields that the tools read. */
const channel = (over: Record<string, unknown>) => ({
  id: TEXT,
  name: "general",
  type: ChannelTypes.GUILD_TEXT,
  parentID: null,
  position: 0,
  topic: "hello",
  nsfw: false,
  rateLimitPerUser: 0,
  createdAt: new Date("2020-01-01T00:00:00.000Z"),
  ...over,
});

const guildChannels = [
  channel({ id: TEXT, name: "General", parentID: CATEGORY }),
  channel({
    id: VOICE,
    name: "Lounge",
    type: ChannelTypes.GUILD_VOICE,
    parentID: null,
  }),
  channel({
    id: CATEGORY,
    name: "Info",
    type: ChannelTypes.GUILD_CATEGORY,
    parentID: null,
  }),
];

describe("delete_channel", () => {
  test("deletes the channel with the audit reason", async () => {
    const remove = recorder(undefined);
    const ctx = fakeContext({
      guilds: { getChannels: async () => guildChannels },
      channels: { delete: remove },
    });

    const result = await callTool(channelTools, ctx, "delete_channel", {
      channelId: TEXT,
      reason: "cleanup",
    });

    expect(result.isError).toBe(false);
    expect(remove.calls).toEqual([[TEXT, "cleanup"]]);
  });

  test("rejects a channel of another server before deleting", async () => {
    const remove = recorder(undefined);
    const ctx = fakeContext({
      guilds: { getChannels: async () => guildChannels },
      channels: { delete: remove },
    });

    const result = await callTool(channelTools, ctx, "delete_channel", {
      channelId: OTHER_GUILD_TEXT,
    });

    expect(result.isError).toBe(true);
    expect(remove.calls).toEqual([]);
  });

  test("turns a 404 from Discord into an error", async () => {
    const ctx = fakeContext({
      guilds: { getChannels: async () => guildChannels },
      channels: {
        delete: async () => {
          throw restError(404, 10003, "DELETE");
        },
      },
    });

    const result = await callTool(channelTools, ctx, "delete_channel", {
      channelId: TEXT,
    });

    expect(result.isError).toBe(true);
  });
});

describe("find_channel", () => {
  test("matches the name without case and returns every match", async () => {
    const ctx = fakeContext({
      guilds: {
        getChannels: async () => [
          channel({ id: TEXT, name: "General" }),
          channel({
            id: VOICE,
            name: "general",
            type: ChannelTypes.GUILD_VOICE,
          }),
          channel({ id: CATEGORY, name: "Info" }),
        ],
      },
    });

    const result = await callTool(channelTools, ctx, "find_channel", {
      channelName: "GENERAL",
    });

    expect(result.isError).toBe(false);
    expect(result.data).toEqual([
      expect.objectContaining({ id: TEXT, type: "text" }),
      expect.objectContaining({ id: VOICE, type: "voice" }),
    ]);
  });

  test("fails when no channel has the name", async () => {
    const ctx = fakeContext({
      guilds: { getChannels: async () => guildChannels },
    });

    const result = await callTool(channelTools, ctx, "find_channel", {
      channelName: "missing",
    });

    expect(result.isError).toBe(true);
  });
});

describe("list_channels", () => {
  test("lists the channels of the server with their type names", async () => {
    const ctx = fakeContext({
      guilds: { getChannels: async () => guildChannels },
    });

    const result = await callTool(channelTools, ctx, "list_channels", {});

    expect(result.isError).toBe(false);
    expect(result.data).toEqual([
      expect.objectContaining({ id: TEXT, parentId: CATEGORY, type: "text" }),
      expect.objectContaining({ id: VOICE, type: "voice" }),
      expect.objectContaining({ id: CATEGORY, type: "category" }),
    ]);
  });
});

describe("edit_text_channel", () => {
  test("sends only the fields that were given", async () => {
    const edit = recorder(channel({ id: TEXT, topic: "new" }));
    const ctx = fakeContext({
      guilds: { getChannels: async () => guildChannels },
      channels: { edit },
    });

    const result = await callTool(channelTools, ctx, "edit_text_channel", {
      channelId: TEXT,
      topic: "new",
    });

    expect(result.isError).toBe(false);
    expect(edit.calls).toEqual([[TEXT, { topic: "new" }]]);
  });

  test("sends NSFW as a boolean", async () => {
    const edit = recorder(channel({ id: TEXT, nsfw: true }));
    const ctx = fakeContext({
      guilds: { getChannels: async () => guildChannels },
      channels: { edit },
    });

    await callTool(channelTools, ctx, "edit_text_channel", {
      channelId: TEXT,
      nsfw: true,
    });

    expect(edit.calls).toEqual([[TEXT, { nsfw: true }]]);
  });

  test("an empty category removes the channel from its category", async () => {
    const edit = recorder(channel({ id: TEXT, parentID: null }));
    const ctx = fakeContext({
      guilds: { getChannels: async () => guildChannels },
      channels: { edit },
    });

    await callTool(channelTools, ctx, "edit_text_channel", {
      channelId: TEXT,
      categoryId: "",
    });

    expect(edit.calls).toEqual([[TEXT, { parentID: null }]]);
  });

  test("rejects a channel of another server before editing", async () => {
    const edit = recorder(channel({ id: OTHER_GUILD_TEXT }));
    const ctx = fakeContext({
      guilds: { getChannels: async () => guildChannels },
      channels: { edit },
    });

    const result = await callTool(channelTools, ctx, "edit_text_channel", {
      channelId: OTHER_GUILD_TEXT,
      topic: "new",
    });

    expect(result.isError).toBe(true);
    expect(edit.calls).toEqual([]);
  });

  test("rejects slowmode on a voice channel", async () => {
    const edit = recorder(channel({ id: VOICE }));
    const ctx = fakeContext({
      guilds: { getChannels: async () => guildChannels },
      channels: { edit },
    });

    const result = await callTool(channelTools, ctx, "edit_text_channel", {
      channelId: VOICE,
      slowmode: 10,
    });

    expect(result.isError).toBe(true);
    expect(edit.calls).toEqual([]);
  });

  test("turns a 404 from Discord into an error", async () => {
    const ctx = fakeContext({
      guilds: { getChannels: async () => guildChannels },
      channels: {
        edit: async () => {
          throw restError(404, 10003, "PATCH");
        },
      },
    });

    const result = await callTool(channelTools, ctx, "edit_text_channel", {
      channelId: TEXT,
      topic: "new",
    });

    expect(result.isError).toBe(true);
  });
});

describe("create_text_channel", () => {
  test("creates the channel under a category of the server", async () => {
    const create = recorder(channel({ id: TEXT, name: "news" }));
    const ctx = fakeContext({
      guilds: {
        getChannels: async () => guildChannels,
        createChannel: create,
      },
    });

    const result = await callTool(channelTools, ctx, "create_text_channel", {
      name: "news",
      categoryId: CATEGORY,
      slowmode: 5,
    });

    expect(result.isError).toBe(false);
    expect(create.calls).toEqual([
      [
        DEFAULT_GUILD,
        ChannelTypes.GUILD_TEXT,
        { name: "news", parentID: CATEGORY, rateLimitPerUser: 5 },
      ],
    ]);
  });

  test("fails when the category is not in the server", async () => {
    const create = recorder(channel({ id: TEXT }));
    const ctx = fakeContext({
      guilds: {
        getChannels: async () => guildChannels,
        createChannel: create,
      },
    });

    const result = await callTool(channelTools, ctx, "create_text_channel", {
      name: "news",
      categoryId: VOICE,
    });

    expect(result.isError).toBe(true);
    expect(create.calls).toEqual([]);
  });
});

describe("get_channel_info", () => {
  test("returns the channel with its parent and creation date", async () => {
    const ctx = fakeContext({
      guilds: { getChannels: async () => guildChannels },
    });

    const result = await callTool(channelTools, ctx, "get_channel_info", {
      channelId: TEXT,
    });

    expect(result.isError).toBe(false);
    expect(result.data).toEqual(
      expect.objectContaining({
        id: TEXT,
        parentId: CATEGORY,
        topic: "hello",
        createdAt: "2020-01-01T00:00:00.000Z",
      }),
    );
  });
});

describe("move_channel", () => {
  test("moves the channel out of its category with an empty category", async () => {
    const edit = recorder(channel({ id: TEXT, parentID: null }));
    const ctx = fakeContext({
      guilds: { getChannels: async () => guildChannels },
      channels: { edit },
    });

    const result = await callTool(channelTools, ctx, "move_channel", {
      channelId: TEXT,
      categoryId: "",
      position: 2,
    });

    expect(result.isError).toBe(false);
    expect(edit.calls).toEqual([[TEXT, { parentID: null, position: 2 }]]);
  });

  test("refuses to move a category", async () => {
    const edit = recorder(channel({ id: CATEGORY }));
    const ctx = fakeContext({
      guilds: { getChannels: async () => guildChannels },
      channels: { edit },
    });

    const result = await callTool(channelTools, ctx, "move_channel", {
      channelId: CATEGORY,
      position: 1,
    });

    expect(result.isError).toBe(true);
    expect(edit.calls).toEqual([]);
  });
});
