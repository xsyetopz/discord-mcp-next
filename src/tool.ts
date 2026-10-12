import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { DiscordRESTError } from "oceanic.js";
import type { z } from "zod";
import type { Context } from "./context.ts";
import type { Access, ToolGroup, ToolTraits } from "./policy.ts";

export interface ToolSpec<S extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  group: ToolGroup;
  access: Access;
  input: S;
  /** Returns the result, which the server sends as JSON text, or a string that it sends as it is. */
  run: (args: z.output<S>, ctx: Context) => Promise<unknown>;
}

export interface Tool extends ToolTraits {
  register: (server: McpServer, ctx: Context) => void;
}

/** A failure that the caller can fix, such as a bad argument or a missing resource. */
export class ToolError extends Error {
  override name = "ToolError";
}

export const defineTool = <S extends z.ZodObject>(spec: ToolSpec<S>): Tool => ({
  name: spec.name,
  group: spec.group,
  access: spec.access,
  register: (server, ctx) => {
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.input as z.ZodObject,
        annotations: {
          title: spec.title,
          readOnlyHint: spec.access === "read",
          destructiveHint: spec.access === "destructive",
          openWorldHint: true,
        },
      },
      async (args): Promise<CallToolResult> => {
        try {
          return textResult(await spec.run(args as z.output<S>, ctx));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  },
});

const textResult = (value: unknown): CallToolResult => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

export const errorResult = (error: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: describeError(error) }],
});

export const describeError = (error: unknown): string => {
  if (error instanceof DiscordRESTError) {
    return `Discord API error ${error.status} on ${error.method} ${error.path}: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
};
