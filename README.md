<div align="center">
  <img src="assets/img/Discord_MCP_full_logo.svg" width="60%" alt="Discord MCP" />
</div>
<hr>

# discord-mcp-next

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant work with a Discord server through a bot.
It is a TypeScript rewrite of [SaseQ/discord-mcp](https://github.com/SaseQ/discord-mcp), with the same tool names, on [Bun](https://bun.com), [Oceanic.js](https://github.com/OceanicJS/Oceanic), and the MCP TypeScript SDK v2 (spec `2026-07-28`, and 2025-era clients still work).

What is new against the Java version:

- **Tool allowlists**: turn off tools such as `delete_channel`, `kick_member`, or `ban_member`, by name, glob, group, or access level.
- **HTTP hardening**: binds to `127.0.0.1` by default, requires a bearer token on any other address, and checks `Host` and `Origin` against DNS rebinding.
- **Safe file input**: URLs must be public `https` with no redirects, and local files must sit under folders that you list.
- **New tools**: `get_message`, `search_guild_messages`, `send_file`, `send_private_file`, `create_thread_from_message`, `get_member_by_id`, `search_members`, `list_guild_members`, and replies, embeds, and attachments on `send_message`.
- **No gateway**: the server uses the Discord REST API only, so it starts fast and needs no privileged intent, except **Server Members Intent** for `list_guild_members`.

## Create the bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), and create an application.
2. On the **Bot** page, select **Reset Token**, and copy the token.
   This value is `DISCORD_TOKEN`.
   It is not the client ID, the client secret, or the public key.
3. For `list_guild_members`, turn on **Server Members Intent** on the same page.
4. On the **OAuth2** page, under **OAuth2 URL Generator**, select the `bot` scope and the permissions that the tools need, then open the URL to add the bot to your server.
5. Optional: for `DISCORD_GUILD_ID`, turn on **Developer Mode** in Discord (User Settings > Advanced), right-click the server, and select **Copy Server ID**.

## Run it

### With Bun

```bash
git clone https://github.com/xsyetopz/discord-mcp-next.git
cd discord-mcp-next
bun install
```

Add the server to your MCP client, for example in `claude_desktop_config.json` or `.mcp.json`:

```json
{
  "mcpServers": {
    "discord": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/discord-mcp-next/src/main.ts"],
      "env": {
        "DISCORD_TOKEN": "<bot token>",
        "DISCORD_GUILD_ID": "<optional server ID>",
        "DISCORD_MCP_DENY": "@destructive"
      }
    }
  }
}
```

### With Docker (stdio)

```bash
docker build -t discord-mcp-next .
```

Or use the image that CI publishes from `main` and from `v*` tags: replace `discord-mcp-next` below with `ghcr.io/xsyetopz/discord-mcp-next:latest`.

```json
{
  "mcpServers": {
    "discord": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "DISCORD_TOKEN",
        "-e", "DISCORD_GUILD_ID",
        "-e", "DISCORD_MCP_DENY=@destructive",
        "discord-mcp-next"
      ],
      "env": { "DISCORD_TOKEN": "<bot token>", "DISCORD_GUILD_ID": "<optional server ID>" }
    }
  }
}
```

The container runs as the unprivileged `bun` user.

### Over HTTP

The HTTP transport serves MCP at `/mcp` and a health check at `/healthz`.

```bash
cp .env.example .env   # set DISCORD_TOKEN and DISCORD_MCP_HTTP_TOKEN
docker compose up -d
```

`docker-compose.yml` publishes the port on `127.0.0.1:8085` of the host only.
Clients send `Authorization: Bearer <DISCORD_MCP_HTTP_TOKEN>`:

```json
{
  "mcpServers": {
    "discord": {
      "type": "http",
      "url": "http://localhost:8085/mcp",
      "headers": { "Authorization": "Bearer <DISCORD_MCP_HTTP_TOKEN>" }
    }
  }
}
```

Anyone with the token can use every enabled tool with the permissions of the bot.
To reach the server from another machine, put a TLS proxy in front of it, and add its host name to `DISCORD_MCP_HTTP_ALLOWED_HOSTS`.

### Scope and limits

- The bot reaches every server that it is in. `DISCORD_GUILD_ID` is a default for tools that take `guildId`, not a limit, and tools that take a `channelId` or a webhook URL work on any channel that the bot can see.
- URL downloads check each address that the host name resolves to at connect time, so the address that passes the check is the address that the request uses.
- `DISCORD_MCP_MAX_UPLOAD_BYTES` is the total of the files of one message.

## Configuration

Bun loads no `.env` file (see `bunfig.toml`), so set these in the environment of the process or in the `env` of the client config.
`docker compose` reads `.env` itself.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DISCORD_TOKEN` | required | The bot token. |
| `DISCORD_GUILD_ID` | none | The server that tools use when a call gives no `guildId`. |
| `DISCORD_MCP_TRANSPORT` | `stdio` | `stdio` or `http`. |
| `DISCORD_MCP_HTTP_HOST` | `127.0.0.1` | The address that HTTP mode listens on. |
| `DISCORD_MCP_HTTP_PORT` | `8085` | The port that HTTP mode listens on. |
| `DISCORD_MCP_HTTP_TOKEN` | none | The bearer token, of 32 or more characters. Required when the host is not loopback. |
| `DISCORD_MCP_HTTP_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1]` | The `Host` and `Origin` names that HTTP mode answers. |
| `DISCORD_MCP_ALLOW` | every tool | Tool selectors to enable. |
| `DISCORD_MCP_DENY` | none | Tool selectors to disable. Deny wins over allow. |
| `DISCORD_MCP_FILE_ROOTS` | none | Absolute folders that file tools may read. Empty turns off local file reads. |
| `DISCORD_MCP_MAX_UPLOAD_BYTES` | `10485760` | The size limit of the files of one message, in total. |

## Tool allowlists

Each tool has a group and an access level:

- `read` tools only read.
- `write` tools create or change something.
- `destructive` tools delete something or remove a member: every `delete_*` tool, `kick_member`, and `ban_member`.

`DISCORD_MCP_ALLOW` and `DISCORD_MCP_DENY` take a list of selectors, split by commas or spaces:

| Selector | Matches |
| --- | --- |
| `send_message` | That tool. |
| `delete_*` | Tool names that match the glob. |
| `@read`, `@write`, `@destructive` | The tools of that access level. |
| `@messages`, `@moderation`, ... | The tools of that group. |
| `*` | Every tool. |

A tool is enabled when a selector of the allowlist matches it and no selector of the denylist matches it.
A disabled tool is not registered, so the assistant never sees it.
A selector that matches no tool stops the server at start, so a typo cannot leave a tool on.

Examples:

```bash
# Everything except deletes, kicks, and bans.
DISCORD_MCP_DENY=@destructive

# Read-only.
DISCORD_MCP_ALLOW=@read

# Read, plus sending messages, but no DMs.
DISCORD_MCP_ALLOW="@read send_message send_file"
DISCORD_MCP_DENY=@dms
```

The access levels follow one rule, so that a deny of `@destructive` blocks exactly what it says.
Tools that change who can do what are `write` tools in the `@roles` and `@permissions` groups: `create_role` and `edit_role` set role permissions, `assign_role` and `remove_role` change the roles of a member, and the `upsert_*_channel_permissions` tools replace a whole overwrite.
For least privilege, deny those groups too:

```bash
DISCORD_MCP_DENY="@destructive @roles @permissions @moderation"
```

`bun run tools` prints each tool with its group and access level, and whether the current `DISCORD_MCP_ALLOW` and `DISCORD_MCP_DENY` enable it.

## Tools

<!-- tools:start -->
83 tools.

| Group | Read | Write | Destructive |
| --- | --- | --- | --- |
| `@server` | `get_server_info` | - | - |
| `@dms` | `read_private_messages` | `send_private_message`, `send_private_file`, `edit_private_message` | `delete_private_message` |
| `@members` | `get_user_id_by_name`, `get_member_by_id`, `search_members`, `list_guild_members` | - | - |
| `@messages` | `read_messages`, `get_message`, `search_guild_messages`, `get_attachment` | `send_message`, `send_file`, `edit_message`, `add_reaction`, `remove_reaction` | `delete_message` |
| `@channels` | `find_channel`, `list_channels`, `get_channel_info` | `create_text_channel`, `edit_text_channel`, `move_channel` | `delete_channel` |
| `@categories` | `find_category`, `list_channels_in_category` | `create_category`, `edit_category` | `delete_category` |
| `@permissions` | `list_channel_permission_overwrites` | `upsert_role_channel_permissions`, `upsert_member_channel_permissions` | `delete_channel_permission_overwrite` |
| `@roles` | `list_roles` | `create_role`, `edit_role`, `assign_role`, `remove_role` | `delete_role` |
| `@moderation` | `get_bans` | `unban_member`, `timeout_member`, `remove_timeout`, `set_nickname` | `kick_member`, `ban_member` |
| `@voice` | - | `create_voice_channel`, `create_stage_channel`, `edit_voice_channel`, `move_member`, `disconnect_member`, `modify_voice_state` | - |
| `@threads` | `list_active_threads` | `create_thread_from_message` | - |
| `@forums` | `list_forum_channels`, `get_forum_channel_info`, `list_forum_tags`, `list_forum_posts` | `create_forum_channel`, `edit_forum_channel`, `create_forum_post`, `modify_forum_post` | - |
| `@webhooks` | `list_webhooks` | `create_webhook`, `send_webhook_message` | `delete_webhook` |
| `@invites` | `list_invites`, `get_invite_details` | `create_invite` | `delete_invite` |
| `@emojis` | `list_emojis`, `get_emoji_details` | `create_emoji`, `edit_emoji` | `delete_emoji` |
| `@events` | `list_guild_scheduled_events`, `get_guild_scheduled_event_users` | `create_guild_scheduled_event`, `edit_guild_scheduled_event` | `delete_guild_scheduled_event` |
<!-- tools:end -->

## Development

```bash
bun install
bun run ci       # bun check, biome ci, markdownlint, bun test
bun run dev      # restarts on change
```

`bun check` is the TypeScript 7 type checker that Bun 1.4.3 ships.

## License

MIT.
See [LICENSE](LICENSE).
