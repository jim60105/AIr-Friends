# AI Friend

An AI-powered conversational chatbot using the [Agent Client Protocol (ACP)](https://agentclientprotocol.org/) to connect with external AI agents (GitHub Copilot CLI, Gemini CLI, OpenCode CLI). Operates across multiple platforms (Discord, Misskey) with persistent cross-conversation memory and workspace-based trust boundaries.

## Features

- **Multi-Platform Support**: Discord and Misskey
- **ACP Client Integration**: Spawns external ACP-compliant agents as subprocesses
- **Shell-Based Skills**: Deno TypeScript skill scripts that agents can execute
- **Skill API Server**: HTTP server for skills to call back to main bot (localhost:3001)
- **Workspace Isolation**: Trust boundaries based on `{platform}/{user_id}`
- **Persistent Memory**: Append-only JSONL logs with patch-based updates
- **Access Control & Reply Policy**: Centralized allow/deny filtering by policy and whitelist
- **Single Reply Rule**: Only one reply per interaction, enforced by session management
- **Clean Thought Process**: Internal reasoning stays private; only final reply sent externally
- **Containerized Deployment**: Deno-based with Podman/Docker support

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                   AI Friend (ACP CLIENT)                    │
├─────────────────────────────────────────────────────────────┤
│  Platform Adapters (Discord/Misskey)                        │
│           ↓                                                 │
│  AgentCore → SessionOrchestrator                            │
│           ↓                                                 │
│  AgentConnector → ACP ClientSideConnection                  │
│           ↓ (spawn subprocess, stdio JSON-RPC)              │
├─────────────────────────────────────────────────────────────┤
│           External ACP AGENTS                               │
│  (GitHub Copilot CLI / Gemini CLI / OpenCode CLI)           │
│           ↓ (executes our shell-based skills)               │
├─────────────────────────────────────────────────────────────┤
│  Shell Skills (Deno scripts in skills/ directory)           │
│           ↓ (calls back via HTTP)                           │
│  Skill API Server (HTTP endpoint on localhost:3001)         │
│           ↓                                                 │
│  Skill Handlers (memory, reply, context)                    │
│  Memory Store, Workspace Manager                            │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- [Deno](https://deno.land/) 2.x or higher
- Discord Bot Token (for Discord integration)
- Misskey Access Token (for Misskey integration, optional)
- An ACP-compliant CLI agent (GitHub Copilot CLI, Gemini CLI, or OpenCode CLI)
- For OpenCode CLI: GITHUB_TOKEN and/or GEMINI_API_KEY for provider access

## Quick Start

1. **Clone the repository**

   ```bash
   git clone https://github.com/jim60105/ai-friend.git
   cd ai-friend
   ```

2. **Set up environment variables**

   ```bash
   cp .env.example .env
   # Edit .env with your tokens
   ```

3. **Configure the bot**

   ```bash
   cp config.example.yaml config.yaml
   # Edit config.yaml as needed
   ```

4. **Run in development mode**

   ```bash
   deno task dev
   ```

5. **Run in production mode**

   ```bash
   deno task start
   ```

6. **Run with YOLO mode (auto-approve all permissions)**

   ```bash
   deno run --allow-net --allow-read --allow-write --allow-env --allow-run src/main.ts --yolo
   ```

   > [!WARNING]\
   > YOLO mode auto-approves ALL permission requests from the ACP agent. Only use this in trusted container environments or for testing purposes.

## Development

### Available Tasks

| Task    | Description                      | Command           |
| ------- | -------------------------------- | ----------------- |
| `dev`   | Development mode with hot reload | `deno task dev`   |
| `start` | Production mode                  | `deno task start` |
| `test`  | Run tests                        | `deno task test`  |
| `fmt`   | Format code                      | `deno task fmt`   |
| `lint`  | Lint code                        | `deno task lint`  |
| `check` | Type check                       | `deno task check` |

### Project Structure

```text
ai-friend/
├── src/
│   ├── main.ts              # Entry point
│   ├── bootstrap.ts         # Application bootstrap
│   ├── shutdown.ts          # Graceful shutdown handler
│   ├── healthcheck.ts       # Health check server
│   ├── acp/                 # ACP Client integration
│   │   ├── agent-connector.ts
│   │   ├── agent-factory.ts
│   │   ├── client.ts
│   │   └── types.ts
│   ├── core/                # Core logic (agent, memory, workspace)
│   │   ├── agent-core.ts
│   │   ├── session-orchestrator.ts
│   │   ├── workspace-manager.ts
│   │   ├── memory-store.ts
│   │   ├── context-assembler.ts
│   │   ├── message-handler.ts
│   │   ├── reply-dispatcher.ts
│   │   ├── reply-policy.ts
│   │   └── config-loader.ts
│   ├── platforms/           # Platform adapters (Discord, Misskey)
│   │   ├── platform-adapter.ts
│   │   ├── platform-registry.ts
│   │   ├── discord/
│   │   └── misskey/
│   ├── skills/              # Skill handlers
│   │   ├── registry.ts
│   │   ├── memory-handler.ts
│   │   ├── reply-handler.ts
│   │   ├── context-handler.ts
│   │   └── types.ts
│   ├── skill-api/           # HTTP API for shell skills
│   │   ├── server.ts
│   │   └── session-registry.ts
│   ├── types/               # TypeScript type definitions
│   └── utils/               # Utility functions
├── skills/                  # Shell-based skill scripts
│   ├── memory-save/
│   ├── memory-search/
│   ├── memory-patch/
│   ├── fetch-context/
│   ├── send-reply/
│   └── lib/                 # Shared skill client library
├── prompts/                 # Bot prompt files (template system)
│   ├── system.md            # Main system prompt with {{placeholders}}
│   ├── character_name.md    # Replaces {{character_name}}
│   ├── character_info.md    # Replaces {{character_info}}
│   └── ...                  # Any .md file becomes a placeholder source
├── config/                  # Configuration examples
├── docs/                    # Documentation & BDD features
│   ├── DESIGN.md            # Design document
│   ├── SKILLS_IMPLEMENTATION.md
│   └── features/            # Gherkin feature specs
└── tests/                   # Test files
```

## Configuration

Configuration is loaded from `config.yaml` (YAML format). See [config.example.yaml](config.example.yaml) for a complete example.

### Environment Variables

| Variable             | Description                                      |
| -------------------- | ------------------------------------------------ |
| `DISCORD_ENABLED`    | Enable Discord integration (true/false)          |
| `MISSKEY_ENABLED`    | Enable Misskey integration (true/false)          |
| `DISCORD_TOKEN`      | Discord bot token                                |
| `MISSKEY_HOST`       | Misskey instance host                            |
| `MISSKEY_TOKEN`      | Misskey access token                             |
| `AGENT_MODEL`        | LLM model identifier (e.g., "gpt-5-mini")        |
| `AGENT_DEFAULT_TYPE` | Default ACP agent type (copilot/gemini/opencode) |
| `REPLY_TO`           | Reply policy mode (`all`/`public`/`whitelist`)    |
| `WHITELIST`          | Whitelist entries (comma-separated, replaces config) |
| `LOG_LEVEL`          | Logging level (DEBUG/INFO/WARN/ERROR)            |
| `DENO_ENV`           | Environment name (dev/prod)                      |
| `GITHUB_TOKEN`       | GitHub token for Copilot/OpenCode                |
| `GEMINI_API_KEY`     | Gemini API key for Gemini CLI/OpenCode           |
| `OPENCODE_API_KEY`   | OpenCode API key                                 |
| `OPENROUTER_API_KEY` | OpenRouter API key                               |

### Access Control & Reply Policy

AI Friend can centrally control whether an incoming event is processed by `AgentCore` using `accessControl`:

- `all`: reply to all events in public channels and DMs.
- `public`: always reply in public channels; for DMs, reply only if account/channel is whitelisted.
- `whitelist`: reply only when account/channel is whitelisted (default).

Whitelist entry format:

```text
{platform}/account/{account_ID}
{platform}/channel/{channel_ID}
```

Example configuration:

```yaml
accessControl:
  replyTo: "whitelist"
  whitelist:
    - "discord/account/123456789012345678"
    - "discord/channel/987654321098765432"
    - "misskey/account/abcdef1234567890"
```

Environment variable overrides:

```bash
REPLY_TO=public
WHITELIST=discord/account/123456789,discord/channel/987654321,misskey/account/abcdef123
```

### OpenCode Configuration

The container includes a pre-configured `opencode.json` that automatically sets up OpenCode CLI with:

- **GitHub Provider**: Uses `GITHUB_TOKEN` environment variable
- **Gemini Provider**: Uses `GEMINI_API_KEY` environment variable
- **All Tools Enabled**: bash, edit, write, read, grep, glob, list, patch, skill, webfetch, and more
- **Auto-compaction**: Enabled for better token management
- **Auto-update**: Disabled (container should be rebuilt for updates)

The configuration file is located at `~/.config/opencode/opencode.json` inside the container. OpenCode will automatically use the GitHub and Gemini providers when their respective tokens are available as environment variables.

You can customize OpenCode behavior by mounting your own `opencode.json` configuration file:

```bash
podman run -d --rm \
  -v ./data:/app/data \
  -v ./config.yaml:/app/config.yaml:ro \
  -v ./my-opencode.json:/home/deno/.config/opencode/opencode.json:ro \
  --env-file .env \
  --name ai-friend \
  ghcr.io/jim60105/ai-friend:latest
```

For more information about OpenCode configuration, see the [OpenCode documentation](https://opencode.ai/docs/config/).

## Prompt Template System

The system prompt (`prompts/system.md`) supports a template placeholder system. Any `{{placeholder}}` in the file is automatically replaced with the content of the corresponding `.md` file in the same directory.

For example, if `system.md` contains `{{character_name}}`, the system loads `prompts/character_name.md` and replaces all occurrences of `{{character_name}}` with its trimmed content.

### How It Works

1. On startup, the system reads `prompts/system.md`
2. It scans the `prompts/` directory for other `.md` files (excluding `system.md` itself)
3. For each file, it maps the filename (without `.md` extension) to the file's trimmed content
4. All `{{filename}}` placeholders in `system.md` are replaced with the corresponding content
5. Placeholders without a matching file are left unchanged and a warning is logged

### Example

```text
prompts/
├── system.md                    # Main prompt: "Hello, I am {{character_name}}!"
├── character_name.md            # "Yuna"
├── character_info.md            # Character background details
├── character_personality.md     # Personality description
├── character_speaking_style.md  # Speaking style guide
└── character_reference_terms.md # Reference phrases
```

To customize the bot's character, simply edit the individual fragment files without touching `system.md`.

### Customizing Prompts in Container Deployments

When running AI Friend in a container, you can customize the bot's character by mounting your own prompt files without rebuilding the container image:

1. **Copy the default prompts to your local directory:**

   ```bash
   # The default prompts are included in the repository
   # You can copy them to customize:
   cp -r prompts/ my-custom-prompts/
   ```

2. **Edit the prompt files in your local directory:**

   Edit `my-custom-prompts/character_name.md`, `my-custom-prompts/character_info.md`, etc. to customize your bot's character.

3. **Mount your custom prompts directory when running the container:**

   Using `podman run`:

   ```bash
   podman run -d --rm \
     -v ./data:/app/data \
     -v ./config.yaml:/app/config.yaml:ro \
     -v ./my-custom-prompts:/app/prompts:ro \
     --env-file .env \
     --name ai-friend \
     ghcr.io/jim60105/ai-friend:latest
   ```

   Using `compose.yml` (already configured):

   ```yaml
   volumes:
     - ./prompts:/app/prompts:ro,Z # Mount your custom prompts
   ```

   > [!IMPORTANT]
   > When mounting custom prompts, ensure you provide **all required files**:
   >
   > - `system.md` - Main system prompt template
   > - All fragment files referenced in `system.md` (e.g., `character_name.md`, `character_info.md`, etc.)
   >
   > Missing files will result in unresolved `{{placeholders}}` in the system prompt.

4. **Restart the container** to apply the changes:

   ```bash
   podman-compose down && podman-compose up -d
   ```

The container includes default prompts that will be used if you don't mount a custom prompts directory.

## Container Deployment

### Quick Start with Compose

```bash
# Edit compose.yml to customize volume mounts if needed
podman-compose up -d
```

### Manual Container Run

```bash
# Run with volume mounts
podman run -d --rm \
  -v ./data:/app/data \
  -v ./config.yaml:/app/config.yaml:ro \
  --env-file .env \
  --name ai-friend \
  ghcr.io/jim60105/ai-friend:latest
```

To mount custom prompts:

```bash
podman run -d --rm \
  -v ./data:/app/data \
  -v ./config.yaml:/app/config.yaml:ro \
  -v ./my-custom-prompts:/app/prompts:ro \
  --env-file .env \
  --name ai-friend \
  ghcr.io/jim60105/ai-friend:latest
```

See [Customizing Prompts in Container Deployments](#customizing-prompts-in-container-deployments) for details.

> [!NOTE]\
> The container image runs with the `--yolo` flag by default, which auto-approves all permission requests. This is safe in the isolated container environment.

## Documentation

- [AGENTS.md](AGENTS.md) - Development guide for AI agents working on this project
- [docs/DESIGN.md](docs/DESIGN.md) - Detailed design document
- [docs/features/](docs/features/) - BDD feature specifications (Gherkin)

## License

<img src="https://github.com/user-attachments/assets/c5def3ed-2715-4ef3-9a0c-00bada48b583" alt="gplv3" width="300" />

[GNU GENERAL PUBLIC LICENSE Version 3](LICENSE)

Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program. If not, see [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
