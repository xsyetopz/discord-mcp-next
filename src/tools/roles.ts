import type { Role } from "oceanic.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { defineTool, ToolError } from "../tool.ts";
import { auditReason, guildId, snowflake } from "./schemas.ts";
import { hasStatus, reasonOption } from "./util.ts";

/** The @everyone role has the same ID as its server, and Discord does not let a bot edit or assign it. */
const isEveryoneRole = (server: string, roleId: string) => server === roleId;

const summarize = (role: Role) => ({
  id: role.id,
  name: role.name,
  color: role.colors.primaryColor,
  position: role.position,
  hoist: role.hoist,
  mentionable: role.mentionable,
  permissions: role.permissions.allow.toString(),
});

/** Fetches a role of the server, and turns a missing role into a ToolError. */
const findRole = async (
  ctx: Context,
  server: string,
  roleId: string,
): Promise<Role> => {
  const role = (await ctx.client.rest.guilds.getRoles(server)).find(
    (r) => r.id === roleId,
  );
  if (!role) throw new ToolError("Role not found by roleId");
  return role;
};

/** Fetches a member, and turns a missing member into a ToolError. */
const fetchMember = async (ctx: Context, server: string, userId: string) =>
  ctx.client.rest.guilds.getMember(server, userId).catch((error: unknown) => {
    if (hasStatus(error, 404))
      throw new ToolError("User not found in this server by userId");
    throw error;
  });

/** The reason option of a positional Oceanic call, which omits it when unset. */

const permissionsSchema = z
  .string()
  .regex(/^\d+$/, "permissions must be a permission bitfield as a string")
  .describe("Permissions bitfield as a string of digits");

export const roleTools = [
  defineTool({
    name: "list_roles",
    title: "List roles",
    description:
      "Lists the roles of a server with their ID, name, color, position, hoist and mentionable flags, and permissions bitfield.",
    group: "roles",
    access: "read",
    input: z.object({ guildId }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const roles = await ctx.client.rest.guilds.getRoles(id);
      return { roles: roles.map(summarize) };
    },
  }),

  defineTool({
    name: "create_role",
    title: "Create role",
    description:
      "Creates a role on the server. Color is an RGB integer, and permissions is a bitfield string.",
    group: "roles",
    access: "write",
    input: z.object({
      guildId,
      name: z.string().min(1).max(100).describe("Name of the new role"),
      color: z
        .number()
        .int()
        .min(0)
        .max(0xffffff)
        .optional()
        .describe(
          "RGB color as an integer, such as 16711680 for red. 0 means no color.",
        ),
      hoist: z
        .boolean()
        .optional()
        .describe(
          "Whether members with this role are shown separately. Defaults to false.",
        ),
      mentionable: z
        .boolean()
        .optional()
        .describe("Whether anyone can mention this role. Defaults to false."),
      permissions: permissionsSchema.optional(),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const role = await ctx.client.rest.guilds.createRole(id, {
        name: args.name,
        color: args.color ?? 0,
        hoist: args.hoist ?? false,
        mentionable: args.mentionable ?? false,
        permissions: args.permissions ?? "0",
        ...reasonOption(args.reason),
      });
      return summarize(role);
    },
  }),

  defineTool({
    name: "edit_role",
    title: "Edit role",
    description:
      "Updates a role. Only the fields that are given change. The @everyone role cannot be edited.",
    group: "roles",
    access: "write",
    input: z.object({
      guildId,
      roleId: snowflake("Role ID"),
      name: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe("New name for the role"),
      color: z
        .number()
        .int()
        .min(0)
        .max(0xffffff)
        .optional()
        .describe("New RGB color as an integer. 0 means no color."),
      hoist: z.boolean().optional().describe("New hoist setting"),
      mentionable: z.boolean().optional().describe("New mentionable setting"),
      permissions: permissionsSchema.optional(),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      if (isEveryoneRole(id, args.roleId))
        throw new ToolError("The @everyone role cannot be edited");
      const role = await ctx.client.rest.guilds.editRole(id, args.roleId, {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.color !== undefined ? { color: args.color } : {}),
        ...(args.hoist !== undefined ? { hoist: args.hoist } : {}),
        ...(args.mentionable !== undefined
          ? { mentionable: args.mentionable }
          : {}),
        ...(args.permissions !== undefined
          ? { permissions: args.permissions }
          : {}),
        ...reasonOption(args.reason),
      });
      return summarize(role);
    },
  }),

  defineTool({
    name: "delete_role",
    title: "Delete role",
    description:
      "Permanently deletes a role from the server. The @everyone role cannot be deleted.",
    group: "roles",
    access: "destructive",
    input: z.object({
      guildId,
      roleId: snowflake("Role ID"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      if (isEveryoneRole(id, args.roleId))
        throw new ToolError("The @everyone role cannot be deleted");
      const role = await findRole(ctx, id, args.roleId);
      await ctx.client.rest.guilds.deleteRole(id, args.roleId, args.reason);
      return { id: role.id, name: role.name };
    },
  }),

  defineTool({
    name: "assign_role",
    title: "Assign role",
    description:
      "Gives a role to a server member. The @everyone role cannot be assigned, because every member already has it.",
    group: "roles",
    access: "write",
    input: z.object({
      guildId,
      userId: snowflake("User ID"),
      roleId: snowflake("Role ID"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      if (isEveryoneRole(id, args.roleId))
        throw new ToolError(
          "The @everyone role cannot be assigned, because every member already has it",
        );
      const member = await fetchMember(ctx, id, args.userId);
      const role = await findRole(ctx, id, args.roleId);
      await ctx.client.rest.guilds.addMemberRole(
        id,
        args.userId,
        args.roleId,
        args.reason,
      );
      return {
        userId: args.userId,
        username: member.user.username,
        roleId: role.id,
        roleName: role.name,
      };
    },
  }),

  defineTool({
    name: "remove_role",
    title: "Remove role",
    description:
      "Removes a role from a server member. The @everyone role cannot be removed.",
    group: "roles",
    access: "write",
    input: z.object({
      guildId,
      userId: snowflake("User ID"),
      roleId: snowflake("Role ID"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      if (isEveryoneRole(id, args.roleId))
        throw new ToolError("The @everyone role cannot be removed");
      const member = await fetchMember(ctx, id, args.userId);
      const role = await findRole(ctx, id, args.roleId);
      await ctx.client.rest.guilds.removeMemberRole(
        id,
        args.userId,
        args.roleId,
        args.reason,
      );
      return {
        userId: args.userId,
        username: member.user.username,
        roleId: role.id,
        roleName: role.name,
      };
    },
  }),
];
