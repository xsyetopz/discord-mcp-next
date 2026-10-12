import {
  afterEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { moderationTools } from "../src/tools/moderation.ts";
import {
  callTool,
  DEFAULT_GUILD,
  fakeContext,
  fakeMember,
  restError,
} from "./members-harness.ts";

const USER = "100000000000000001";
const DAY = 86400;

afterEach(() => setSystemTime());

describe("timeout_member", () => {
  test("sets the end time to now plus the duration", async () => {
    setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const edit = mock(async () => fakeMember({ id: USER, username: "alex" }));
    const ctx = fakeContext({
      getMember: async () => fakeMember({ id: USER, username: "alex" }),
      editMember: edit,
    });

    const result = await callTool(moderationTools, ctx, "timeout_member", {
      userId: USER,
      durationSeconds: 60,
      reason: "spam",
    });

    expect(result.isError).toBe(false);
    expect(edit).toHaveBeenCalledWith(DEFAULT_GUILD, USER, {
      communicationDisabledUntil: "2030-01-01T00:01:00.000Z",
      reason: "spam",
    });
  });

  test("accepts exactly 28 days", async () => {
    setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const edit = mock(async () => undefined);
    const ctx = fakeContext({
      getMember: async () => fakeMember({ id: USER, username: "alex" }),
      editMember: edit,
    });

    const result = await callTool(moderationTools, ctx, "timeout_member", {
      userId: USER,
      durationSeconds: 28 * DAY,
    });

    expect(result.isError).toBe(false);
    expect(edit).toHaveBeenCalledTimes(1);
  });

  test("rejects a duration over 28 days before calling Discord", async () => {
    const edit = mock(async () => undefined);
    const ctx = fakeContext({
      getMember: async () => fakeMember({ id: USER, username: "alex" }),
      editMember: edit,
    });

    const result = await callTool(moderationTools, ctx, "timeout_member", {
      userId: USER,
      durationSeconds: 28 * DAY + 1,
    });

    expect(result.isError).toBe(true);
    expect(edit).not.toHaveBeenCalled();
  });

  test("rejects a duration below one second", async () => {
    const edit = mock(async () => undefined);
    const ctx = fakeContext({
      getMember: async () => fakeMember({ id: USER, username: "alex" }),
      editMember: edit,
    });

    const result = await callTool(moderationTools, ctx, "timeout_member", {
      userId: USER,
      durationSeconds: 0,
    });

    expect(result.isError).toBe(true);
    expect(edit).not.toHaveBeenCalled();
  });
});

describe("remove_timeout", () => {
  test("clears the end time", async () => {
    const edit = mock(async () => undefined);
    const ctx = fakeContext({
      getMember: async () => fakeMember({ id: USER, username: "alex" }),
      editMember: edit,
    });

    await callTool(moderationTools, ctx, "remove_timeout", { userId: USER });

    expect(edit).toHaveBeenCalledWith(DEFAULT_GUILD, USER, {
      communicationDisabledUntil: null,
    });
  });
});

describe("ban_member", () => {
  test("passes deleteMessageSeconds and the reason to Discord", async () => {
    const ban = mock(async () => undefined);
    const ctx = fakeContext({ createBan: ban });

    await callTool(moderationTools, ctx, "ban_member", {
      userId: USER,
      deleteMessageSeconds: 3600,
      reason: "raid",
    });

    expect(ban).toHaveBeenCalledWith(DEFAULT_GUILD, USER, {
      deleteMessageSeconds: 3600,
      reason: "raid",
    });
  });

  test("deletes no messages when deleteMessageSeconds is omitted", async () => {
    const ban = mock(async () => undefined);
    const ctx = fakeContext({ createBan: ban });

    await callTool(moderationTools, ctx, "ban_member", { userId: USER });

    expect(ban).toHaveBeenCalledWith(DEFAULT_GUILD, USER, {
      deleteMessageSeconds: 0,
    });
  });
});

describe("kick_member", () => {
  test("passes the reason to Discord", async () => {
    const remove = mock(async () => undefined);
    const ctx = fakeContext({
      getMember: async () => fakeMember({ id: USER, username: "alex" }),
      removeMember: remove,
    });

    await callTool(moderationTools, ctx, "kick_member", {
      userId: USER,
      reason: "off topic",
    });

    expect(remove).toHaveBeenCalledWith(DEFAULT_GUILD, USER, "off topic");
  });

  test("turns a missing member into a ToolError, not a raw API error", async () => {
    const ctx = fakeContext({
      getMember: async () => {
        throw restError(404);
      },
      removeMember: async () => undefined,
    });

    const result = await callTool(moderationTools, ctx, "kick_member", {
      userId: USER,
    });

    expect(result.isError).toBe(true);
    expect(String(result.data).startsWith("Discord API error")).toBe(false);
  });
});

describe("set_nickname", () => {
  test("sends the nickname", async () => {
    const edit = mock(async () => undefined);
    const ctx = fakeContext({
      getMember: async () => fakeMember({ id: USER, username: "alex" }),
      editMember: edit,
    });

    await callTool(moderationTools, ctx, "set_nickname", {
      userId: USER,
      nick: "Ali",
    });

    expect(edit).toHaveBeenCalledWith(DEFAULT_GUILD, USER, { nick: "Ali" });
  });

  test("an empty nickname resets it to null", async () => {
    const edit = mock(async () => undefined);
    const ctx = fakeContext({
      getMember: async () => fakeMember({ id: USER, username: "alex" }),
      editMember: edit,
    });

    await callTool(moderationTools, ctx, "set_nickname", {
      userId: USER,
      nick: "  ",
    });

    expect(edit).toHaveBeenCalledWith(DEFAULT_GUILD, USER, { nick: null });
  });
});

describe("get_bans", () => {
  test("passes the limit and maps each ban", async () => {
    const limits: unknown[] = [];
    const ctx = fakeContext({
      getBans: async (_guild: string, options: unknown) => {
        limits.push(options);
        return [
          {
            reason: "spam",
            user: { id: USER, username: "alex", globalName: null },
          },
        ];
      },
    });

    const result = await callTool(moderationTools, ctx, "get_bans", {
      limit: 5,
    });

    expect(limits).toEqual([{ limit: 5 }]);
    expect(result.data).toEqual({
      bans: [
        { userId: USER, username: "alex", globalName: null, reason: "spam" },
      ],
    });
  });
});

describe("access levels", () => {
  test("kick and ban are destructive, and unban is a write", () => {
    const access = Object.fromEntries(
      moderationTools.map((t) => [t.name, t.access]),
    );
    expect(access["kick_member"]).toBe("destructive");
    expect(access["ban_member"]).toBe("destructive");
    expect(access["unban_member"]).toBe("write");
    expect(access["get_bans"]).toBe("read");
  });
});
