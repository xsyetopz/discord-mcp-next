import { OverwriteTypes, Permissions } from "oceanic.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { defineTool, ToolError } from "../tool.ts";
import { auditReason, guildId, snowflake } from "./schemas.ts";
import { reasonOption } from "./util.ts";

/** The permission flags by their Discord names, as Oceanic defines them. */
const FLAGS = new Map<string, bigint>(Object.entries(Permissions));

interface Bits {
  allow: bigint;
  deny: bigint;
}

interface Target {
  type: "role" | "member";
  id: string;
}

/** Turns permission names into one bitfield, and rejects every name that Discord does not define. */
const namesToBits = (names: string[]): bigint => {
  const unknown = names.filter((name) => !FLAGS.has(name));
  if (unknown.length > 0)
    throw new ToolError(`Unknown permission names: ${unknown.join(", ")}`);
  return names.reduce((bits, name) => bits | (FLAGS.get(name) ?? 0n), 0n);
};

/** The names of the flags that a bitfield sets. */
const bitsToNames = (bits: bigint): string[] =>
  [...FLAGS].filter(([, flag]) => (bits & flag) === flag).map(([name]) => name);

const describeBits = (bits: bigint) => ({
  bits: bits.toString(),
  names: bitsToNames(bits),
});

/** Reads one side of an overwrite from a raw bitfield or a CSV of names, and neither means 0. */
const sideBits = (
  raw: string | undefined,
  csv: string | undefined,
  side: string,
): bigint => {
  const names = (csv ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  if (raw !== undefined && names.length > 0)
    throw new ToolError(
      `Give either the ${side} bitfield or its permission names, not both`,
    );
  if (raw !== undefined) return BigInt(raw);
  return namesToBits(names);
};

/** Reads both sides of an overwrite, and rejects an overwrite that sets nothing or sets a flag on both sides. */
const overwriteBits = (args: {
  allowRaw?: string | undefined;
  allowPermissions?: string | undefined;
  denyRaw?: string | undefined;
  denyPermissions?: string | undefined;
}): Bits => {
  const allow = sideBits(args.allowRaw, args.allowPermissions, "allow");
  const deny = sideBits(args.denyRaw, args.denyPermissions, "deny");
  if (allow === 0n && deny === 0n)
    throw new ToolError("Give at least one allow or deny permission");
  if ((allow & deny) !== 0n)
    throw new ToolError("allow and deny cannot contain the same permission");
  return { allow, deny };
};

/** Fetches a channel of the server, and turns a channel of another server into a ToolError. */
const findChannel = async (ctx: Context, server: string, channelId: string) => {
  const channel = (await ctx.client.rest.guilds.getChannels(server)).find(
    (c) => c.id === channelId,
  );
  if (!channel)
    throw new ToolError("Channel not found in this server by channelId");
  return channel;
};

/** Fetches a role of the server, and turns a missing role into a ToolError. */
const findRole = async (ctx: Context, server: string, roleId: string) => {
  const role = (await ctx.client.rest.guilds.getRoles(server)).find(
    (r) => r.id === roleId,
  );
  if (!role) throw new ToolError("Role not found in this server by roleId");
  return role;
};

/** Sets the overwrite of a target to exactly the given sides, with no merge into the old overwrite. */
const setOverwrite = async (
  ctx: Context,
  channelId: string,
  target: Target,
  bits: Bits,
  reason: string | undefined,
) => {
  await ctx.client.rest.channels.editPermission(channelId, target.id, {
    type: target.type === "role" ? OverwriteTypes.ROLE : OverwriteTypes.MEMBER,
    allow: bits.allow,
    deny: bits.deny,
    ...reasonOption(reason),
  });
  return {
    channelId,
    target,
    allow: describeBits(bits.allow),
    deny: describeBits(bits.deny),
  };
};

const bitfield = (side: "allow" | "deny") =>
  z
    .string()
    .regex(/^\d+$/, `${side}Raw must be a decimal bitfield`)
    .optional()
    .describe(
      `${side === "allow" ? "Allow" : "Deny"} permissions as a decimal bitfield, such as 1024. Use this or the names, not both.`,
    );

const permissionNames = (side: "allow" | "deny") =>
  z
    .string()
    .optional()
    .describe(
      `${side === "allow" ? "Allow" : "Deny"} permissions as a CSV of Discord names, such as VIEW_CHANNEL,CONNECT`,
    );

const overwriteFields = {
  allowRaw: bitfield("allow"),
  denyRaw: bitfield("deny"),
  allowPermissions: permissionNames("allow"),
  denyPermissions: permissionNames("deny"),
};

export const permissionTools = [
  defineTool({
    name: "list_channel_permission_overwrites",
    title: "List channel permission overwrites",
    description:
      "Lists the permission overwrites of a channel, with the type and ID of each target and the allow and deny flags decoded into names.",
    group: "permissions",
    access: "read",
    input: z.object({
      guildId,
      channelId: snowflake("Channel ID"),
    }),
    run: async (args, ctx) => {
      const channel = await findChannel(
        ctx,
        ctx.guildId(args.guildId),
        args.channelId,
      );
      return {
        channelId: channel.id,
        overwrites: [...channel.permissionOverwrites.values()].map((o) => ({
          id: o.id,
          type: o.type === OverwriteTypes.ROLE ? "role" : "member",
          allow: describeBits(o.allow),
          deny: describeBits(o.deny),
        })),
      };
    },
  }),

  defineTool({
    name: "upsert_role_channel_permissions",
    title: "Set role channel permissions",
    description:
      "Creates or replaces the permission overwrite of a role on a channel. The allow and deny sides are set to the given values, and a side that is not given becomes 0.",
    group: "permissions",
    access: "write",
    input: z.object({
      guildId,
      channelId: snowflake("Channel ID"),
      roleId: snowflake("Role ID"),
      ...overwriteFields,
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const bits = overwriteBits(args);
      const server = ctx.guildId(args.guildId);
      await findChannel(ctx, server, args.channelId);
      await findRole(ctx, server, args.roleId);
      return setOverwrite(
        ctx,
        args.channelId,
        { type: "role", id: args.roleId },
        bits,
        args.reason,
      );
    },
  }),

  defineTool({
    name: "upsert_member_channel_permissions",
    title: "Set member channel permissions",
    description:
      "Creates or replaces the permission overwrite of a member on a channel. The allow and deny sides are set to the given values, and a side that is not given becomes 0.",
    group: "permissions",
    access: "write",
    input: z.object({
      guildId,
      channelId: snowflake("Channel ID"),
      userId: snowflake("User ID"),
      ...overwriteFields,
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const bits = overwriteBits(args);
      await findChannel(ctx, ctx.guildId(args.guildId), args.channelId);
      return setOverwrite(
        ctx,
        args.channelId,
        { type: "member", id: args.userId },
        bits,
        args.reason,
      );
    },
  }),

  defineTool({
    name: "delete_channel_permission_overwrite",
    title: "Delete channel permission overwrite",
    description:
      "Deletes the permission overwrite of a role or a member from a channel. The target then falls back to the channel's defaults.",
    group: "permissions",
    access: "destructive",
    input: z.object({
      guildId,
      channelId: snowflake("Channel ID"),
      targetType: z
        .enum(["role", "member"])
        .describe("Type of the overwrite target: role or member"),
      targetId: snowflake("Target role or user ID"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const channel = await findChannel(
        ctx,
        ctx.guildId(args.guildId),
        args.channelId,
      );
      const overwrite = [...channel.permissionOverwrites.values()].find(
        (o) => o.id === args.targetId,
      );
      if (!overwrite)
        throw new ToolError("No permission overwrite found for targetId");
      const actual = overwrite.type === OverwriteTypes.ROLE ? "role" : "member";
      if (actual !== args.targetType)
        throw new ToolError(
          `The overwrite for targetId is a ${actual} overwrite, not a ${args.targetType} one`,
        );
      await ctx.client.rest.channels.deletePermission(
        args.channelId,
        args.targetId,
        args.reason,
      );
      return {
        channelId: args.channelId,
        targetType: args.targetType,
        targetId: args.targetId,
        deleted: true,
      };
    },
  }),
];
