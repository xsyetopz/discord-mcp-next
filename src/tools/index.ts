import type { Tool } from "../tool.ts";
import { messageTools } from "./messages.ts";
import { serverTools } from "./server.ts";
import { threadTools } from "./threads.ts";

/** Every tool of the server, before the allowlist and the denylist apply. */
export const allTools: readonly Tool[] = [
  ...serverTools,
  ...messageTools,
  ...threadTools,
];
