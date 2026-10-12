import { describe, expect, test } from "bun:test";
import { ChannelTypes } from "oceanic.js";
import { threadTools } from "../src/tools/threads.ts";
import { callTool, fakeContext, recorder } from "./harness.ts";

const GUILD = "111111111111111111";
const PARENT = "300000000000000001";
const THREAD = "600000000000000001";
const MESSAGE = "200000000000000009";

const fakeThread = (overrides: Record<string, unknown> = {}) => ({
  id: THREAD,
  name: "release notes",
  type: ChannelTypes.PUBLIC_THREAD,
  parentID: PARENT,
  messageCount: 3,
  threadMetadata: { archived: false },
  ...overrides,
});

describe("list_active_threads", () => {
  test("lists each thread with its parent ID and parent name", async () => {
    const getChannels = recorder([
      { id: PARENT, name: "announcements", type: ChannelTypes.GUILD_TEXT },
      {
        id: "300000000000000002",
        name: "general",
        type: ChannelTypes.GUILD_TEXT,
      },
    ]);
    const ctx = fakeContext({
      guilds: {
        getActiveThreads: async () => ({
          members: [],
          threads: [fakeThread()],
        }),
        getChannels,
      },
    });

    const result = await callTool(threadTools, ctx, "list_active_threads", {});

    expect(result.isError).toBe(false);
    expect(getChannels.calls).toEqual([[GUILD]]);
    expect(result.data).toEqual({
      count: 1,
      threads: [
        {
          id: THREAD,
          name: "release notes",
          type: "public_thread",
          parentId: PARENT,
          parentName: "announcements",
          archived: false,
          messageCount: 3,
        },
      ],
    });
  });

  test("gives a null parent name when the parent is not in the server", async () => {
    const ctx = fakeContext({
      guilds: {
        getActiveThreads: async () => ({
          members: [],
          threads: [fakeThread({ parentID: "300000000000000999" })],
        }),
        getChannels: async () => [],
      },
    });

    const result = await callTool(threadTools, ctx, "list_active_threads", {});

    const threads = (result.data as { threads: Array<{ parentName: unknown }> })
      .threads;
    expect(threads[0]?.parentName).toBeNull();
  });
});

describe("create_thread_from_message", () => {
  test("starts a thread from the message with the name and archive duration", async () => {
    const startThreadFromMessage = recorder(fakeThread({ name: "discussion" }));
    const ctx = fakeContext({
      channels: {
        get: async () => ({
          id: PARENT,
          name: "announcements",
          type: ChannelTypes.GUILD_TEXT,
        }),
        startThreadFromMessage,
      },
    });

    const result = await callTool(
      threadTools,
      ctx,
      "create_thread_from_message",
      {
        channelId: PARENT,
        messageId: MESSAGE,
        name: "discussion",
        autoArchiveDuration: 1440,
      },
    );

    expect(result.isError).toBe(false);
    expect(startThreadFromMessage.calls).toEqual([
      [PARENT, MESSAGE, { name: "discussion", autoArchiveDuration: 1440 }],
    ]);
    expect(result.data).toMatchObject({
      id: THREAD,
      name: "discussion",
      parentId: PARENT,
      parentName: "announcements",
    });
  });

  test("rejects a voice channel and starts no thread", async () => {
    const startThreadFromMessage = recorder(fakeThread());
    const ctx = fakeContext({
      channels: {
        get: async () => ({ id: PARENT, type: ChannelTypes.GUILD_VOICE }),
        startThreadFromMessage,
      },
    });

    const result = await callTool(
      threadTools,
      ctx,
      "create_thread_from_message",
      { channelId: PARENT, messageId: MESSAGE, name: "discussion" },
    );

    expect(result.isError).toBe(true);
    expect(startThreadFromMessage.calls).toHaveLength(0);
  });

  test("rejects an archive duration that Discord does not offer", async () => {
    const startThreadFromMessage = recorder(fakeThread());
    const ctx = fakeContext({
      channels: {
        get: async () => ({ id: PARENT, type: ChannelTypes.GUILD_TEXT }),
        startThreadFromMessage,
      },
    });

    const result = await callTool(
      threadTools,
      ctx,
      "create_thread_from_message",
      {
        channelId: PARENT,
        messageId: MESSAGE,
        name: "discussion",
        autoArchiveDuration: 30,
      },
    );

    expect(result.isError).toBe(true);
    expect(startThreadFromMessage.calls).toHaveLength(0);
  });
});
