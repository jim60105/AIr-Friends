# AI Friend

An AI-powered conversational chatbot using the [Agent Client Protocol (ACP)](https://agentclientprotocol.org/) to connect with external AI agents (GitHub Copilot CLI, Gemini CLI). Operates across multiple platforms (Discord, Misskey) with persistent cross-conversation memory and workspace-based trust boundaries.

## Features

- **Multi-Platform Support**: Discord and Misskey
- **ACP Client Integration**: Spawns external ACP-compliant agents as subprocesses
- **Shell-Based Skills**: Deno TypeScript skill scripts that agents can execute
- **Skill API Server**: HTTP server for skills to call back to main bot (localhost:3001)
- **Workspace Isolation**: Trust boundaries based on `{platform}/{user_id}/{channel_id}`
- **Persistent Memory**: Append-only JSONL logs with patch-based updates
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
│  (GitHub Copilot CLI / Gemini CLI)                          │
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
- An ACP-compliant CLI agent (GitHub Copilot CLI or Gemini CLI)

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
   cp config/config.example.yaml config.yaml
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
├── prompts/                 # Bot prompt files
├── config/                  # Configuration examples
├── docs/                    # Documentation & BDD features
│   ├── DESIGN.md            # Design document
│   ├── SKILLS_IMPLEMENTATION.md
│   └── features/            # Gherkin feature specs
└── tests/                   # Test files
```

## Configuration

Configuration is loaded from `config.yaml` (YAML format). See [config/config.example.yaml](config/config.example.yaml) for a complete example.

### Environment Variables

| Variable          | Description                           | Required |
| ----------------- | ------------------------------------- | -------- |
| `DISCORD_TOKEN`   | Discord bot token                     | Yes*     |
| `GITHUB_TOKEN`    | GitHub token for Copilot CLI          | Yes**    |
| `MISSKEY_TOKEN`   | Misskey access token                  | No       |
| `MISSKEY_HOST`    | Misskey instance host                 | No       |
| `AGENT_MODEL`     | LLM model identifier (e.g., "gpt-4")  | No       |
| `LOG_LEVEL`       | Logging level (DEBUG/INFO/WARN/ERROR) | No       |
| `DENO_ENV`        | Environment name (dev/prod)           | No       |
| `SKILL_API_PORT`  | Skill API server port (default: 3001) | No       |
| `SKILL_API_HOST`  | Skill API server host (localhost)     | No       |

\* Required if Discord platform is enabled.  
\*\* Required for GitHub Copilot CLI agent.

## Container Deployment

```bash
# Run with volume mounts
podman run -d --rm \
  -v ./data:/data \
  -v ./config.yaml:/app/config.yaml:ro \
  --env-file .env \
  --name ai-friend \
  ghcr.io/jim60105/ai-friend:latest
```

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
