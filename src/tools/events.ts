import {
  GuildScheduledEventEntityTypes,
  GuildScheduledEventPrivacyLevels,
  type GuildScheduledEventStatuses,
} from "oceanic.js";
import { z } from "zod";
import { defineTool, ToolError } from "../tool.ts";
import { auditReason, guildId, snowflake } from "./schemas.ts";
import { definedOnly, reasonOption } from "./util.ts";

/** An ISO 8601 date and time that ends with `Z` or an offset such as `+02:00`. */
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i;

/** Parses a time that must include an offset, so that it means one instant everywhere. */
const parseEventTime = (value: string, field: string): Date => {
  if (!ISO_WITH_OFFSET.test(value))
    throw new ToolError(
      `${field} must be an ISO 8601 time with an offset, such as 2030-11-01T18:00:00Z`,
    );
  const time = new Date(value);
  if (Number.isNaN(time.getTime()))
    throw new ToolError(`${field} is not a valid time`);
  return time;
};

const assertInFuture = (time: Date, field: string) => {
  if (time.getTime() <= Date.now())
    throw new ToolError(`${field} must be in the future`);
};

const eventTimeInput = (what: string) =>
  z
    .string()
    .min(1)
    .max(64)
    .describe(
      `${what}, as an ISO 8601 time with an offset (e.g. 2030-11-01T18:00:00Z)`,
    );

const eventId = snowflake("Scheduled event ID");

const statusInput = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
  .describe(
    "New status: 1=Scheduled, 2=Active (start), 3=Completed, 4=Canceled",
  );

export const eventTools = [
  defineTool({
    name: "create_guild_scheduled_event",
    title: "Create scheduled event",
    description:
      "Schedules an event on a server. Use entityType 1 (stage) or 2 (voice) with a channel, or 3 (external) with a location and an end time.",
    group: "events",
    access: "write",
    input: z.object({
      guildId,
      name: z.string().min(1).max(100).describe("Name of the event"),
      description: z
        .string()
        .min(1)
        .max(1000)
        .optional()
        .describe("Description of the event"),
      scheduledStartTime: eventTimeInput("When the event starts"),
      scheduledEndTime: eventTimeInput(
        "When the event ends. Required for external events.",
      ).optional(),
      entityType: z
        .union([z.literal(1), z.literal(2), z.literal(3)])
        .describe("Type of event: 1=Stage, 2=Voice, 3=External"),
      channelId: snowflake("Channel ID")
        .optional()
        .describe("Channel ID. Required for types 1 and 2."),
      location: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe("Location or link. Required for type 3 (external)."),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const start = parseEventTime(
        args.scheduledStartTime,
        "scheduledStartTime",
      );
      assertInFuture(start, "scheduledStartTime");
      const end =
        args.scheduledEndTime === undefined
          ? undefined
          : parseEventTime(args.scheduledEndTime, "scheduledEndTime");
      if (end !== undefined && end.getTime() <= start.getTime())
        throw new ToolError(
          "scheduledEndTime must be after scheduledStartTime",
        );

      const common = {
        name: args.name,
        ...(args.description === undefined
          ? {}
          : { description: args.description }),
        privacyLevel: GuildScheduledEventPrivacyLevels.GUILD_ONLY,
        scheduledStartTime: start.toISOString(),
        ...reasonOption(args.reason),
      };

      if (args.entityType === 3) {
        if (args.location === undefined)
          throw new ToolError("location is required for external events");
        if (end === undefined)
          throw new ToolError(
            "scheduledEndTime is required for external events",
          );
        const event = await ctx.client.rest.guilds.createScheduledEvent(id, {
          ...common,
          entityType: GuildScheduledEventEntityTypes.EXTERNAL,
          entityMetadata: { location: args.location },
          scheduledEndTime: end.toISOString(),
        });
        return summarizeEvent(event);
      }

      if (args.channelId === undefined)
        throw new ToolError("channelId is required for stage and voice events");
      const channel = (await ctx.client.rest.guilds.getChannels(id)).find(
        (c) => c.id === args.channelId,
      );
      if (!channel)
        throw new ToolError(
          `Channel ${args.channelId} was not found in this server`,
        );
      const event = await ctx.client.rest.guilds.createScheduledEvent(id, {
        ...common,
        entityType:
          args.entityType === 1
            ? GuildScheduledEventEntityTypes.STAGE_INSTANCE
            : GuildScheduledEventEntityTypes.VOICE,
        channelID: channel.id,
        ...(end === undefined ? {} : { scheduledEndTime: end.toISOString() }),
      });
      return summarizeEvent(event);
    },
  }),

  defineTool({
    name: "edit_guild_scheduled_event",
    title: "Edit scheduled event",
    description:
      "Changes an event: its name, description, start time, location, or status (start, complete, or cancel it).",
    group: "events",
    access: "write",
    input: z.object({
      guildId,
      eventId,
      status: statusInput.optional(),
      name: z.string().min(1).max(100).optional().describe("New name"),
      description: z
        .string()
        .min(1)
        .max(1000)
        .optional()
        .describe("New description"),
      scheduledStartTime: eventTimeInput("New start time").optional(),
      location: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe("New location (for external events)"),
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const start =
        args.scheduledStartTime === undefined
          ? undefined
          : parseEventTime(args.scheduledStartTime, "scheduledStartTime");
      if (start !== undefined) assertInFuture(start, "scheduledStartTime");
      const event = await ctx.client.rest.guilds.editScheduledEvent(
        id,
        args.eventId,
        definedOnly({
          name: args.name,
          description: args.description,
          scheduledStartTime: start?.toISOString(),
          entityMetadata:
            args.location === undefined
              ? undefined
              : { location: args.location },
          status: args.status,
          ...reasonOption(args.reason),
        }),
      );
      return summarizeEvent(event);
    },
  }),

  defineTool({
    name: "delete_guild_scheduled_event",
    title: "Delete scheduled event",
    description: "Permanently deletes a scheduled event from a server.",
    group: "events",
    access: "destructive",
    input: z.object({
      guildId,
      eventId,
      reason: auditReason,
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      await ctx.client.rest.guilds.deleteScheduledEvent(
        id,
        args.eventId,
        args.reason,
      );
      return { deleted: true, id: args.eventId };
    },
  }),

  defineTool({
    name: "list_guild_scheduled_events",
    title: "List scheduled events",
    description:
      "Lists the active and scheduled events of a server, with their times, status, and interested user count.",
    group: "events",
    access: "read",
    input: z.object({
      guildId,
      withUserCount: z
        .boolean()
        .optional()
        .describe(
          "Whether to include the interested user count. Defaults to true.",
        ),
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const withUserCount = args.withUserCount ?? true;
      const events = await ctx.client.rest.guilds.getScheduledEvents(
        id,
        withUserCount ? 1 : undefined,
      );
      return { events: events.map(summarizeEvent) };
    },
  }),

  defineTool({
    name: "get_guild_scheduled_event_users",
    title: "List event interested users",
    description:
      "Lists the users who are interested in a scheduled event, with their nickname and roles when members are included.",
    group: "events",
    access: "read",
    input: z.object({
      guildId,
      eventId,
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe(
          "Maximum number of users to return, from 1 to 100. Defaults to 100.",
        ),
      withMember: z
        .boolean()
        .optional()
        .describe(
          "Whether to include member data with roles. Defaults to true.",
        ),
    }),
    run: async (args, ctx) => {
      const id = ctx.guildId(args.guildId);
      const users = await ctx.client.rest.guilds.getScheduledEventUsers(
        id,
        args.eventId,
        {
          limit: args.limit ?? 100,
          withMember: args.withMember ?? true,
        },
      );
      return {
        users: users.map((entry) => ({
          id: entry.user.id,
          username: entry.user.username,
          nickname: entry.member?.nick ?? null,
          roleIds: entry.member?.roles ?? [],
        })),
      };
    },
  }),
];

const summarizeEvent = (event: {
  id: string;
  name: string;
  description?: string | null | undefined;
  entityType: GuildScheduledEventEntityTypes;
  entityID: string | null;
  channelID: string | null;
  entityMetadata: { location?: string } | null;
  privacyLevel: GuildScheduledEventPrivacyLevels;
  scheduledStartTime: Date;
  scheduledEndTime: Date | null;
  status: GuildScheduledEventStatuses;
  userCount: number;
}) => ({
  id: event.id,
  name: event.name,
  description: event.description ?? null,
  entityType: event.entityType,
  status: event.status,
  privacyLevel: event.privacyLevel,
  channelId: event.channelID,
  location: event.entityMetadata?.location ?? null,
  startTime: event.scheduledStartTime.toISOString(),
  endTime: event.scheduledEndTime?.toISOString() ?? null,
  userCount: event.userCount,
});
