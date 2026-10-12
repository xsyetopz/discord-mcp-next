import { z } from "zod";

export const snowflake = (what: string) =>
  z
    .string()
    .regex(/^\d{17,20}$/, `${what} must be a Discord ID`)
    .describe(`${what} (a Discord snowflake ID)`);

/** The guild of a tool, which falls back to `DISCORD_GUILD_ID`. */
export const guildId = snowflake("Server ID")
  .optional()
  .describe("Server (guild) ID. Defaults to DISCORD_GUILD_ID when omitted.");

/** The reason that Discord writes to the audit log. */
export const auditReason = z
  .string()
  .max(512)
  .optional()
  .describe("Reason shown in the server audit log");
