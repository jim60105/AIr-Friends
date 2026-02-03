# Agent Chatbot

An AI-powered conversational chatbot using the [Agent Client Protocol (ACP)](https://agentclientprotocol.org/) to connect with external AI agents (GitHub Copilot CLI, Gemini CLI). Operates across multiple platforms (Discord, Misskey) with persistent cross-conversation memory and workspace-based trust boundaries.

## Features

- **Multi-Platform Support**: Discord and Misskey (extensible to other platforms)
- **ACP Client Integration**: Connects to external ACP-compliant agents via subprocess
- **Agent Skills**: Exposes capabilities to external agents through SKILL.md definitions
- **Workspace Isolation**: Trust boundaries based on `{platform}/{user_id}/{channel_id}`
- **Persistent Memory**: Append-only JSONL logs for cross-conversation memory
- **Clean Thought Process**: Internal reasoning stays private; only final replies sent externally
- **Containerized Deployment**: Deno-based with Docker/Podman support

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                 Agent Chatbot (ACP CLIENT)                  │
├─────────────────────────────────────────────────────────────┤
│  Platform Adapters (Discord/Misskey)                        │
│           ↓                                                 │
│  Agent Core (SessionOrchestrator)                           │
│           ↓                                                 │
│  ACP Client SDK (ClientSideConnection)                      │
│           ↓ (spawn subprocess, stdio)                       │
├─────────────────────────────────────────────────────────────┤
│           External ACP AGENTS                               │
│  (GitHub Copilot CLI / Gemini CLI)                          │
│           ↓ (reads our SKILL.md, invokes skills)            │
├─────────────────────────────────────────────────────────────┤
│  Skill Handlers (memory-save, send-reply, etc.)             │
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
   git clone https://github.com/jim60105/agent-chatbot.git
   cd agent-chatbot
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

| Task    | Description                        | Command            |
| ------- | ---------------------------------- | ------------------ |
| `dev`   | Development mode with hot reload   | `deno task dev`    |
| `start` | Production mode                    | `deno task start`  |
| `test`  | Run tests                          | `deno task test`   |
| `fmt`   | Format code                        | `deno task fmt`    |
| `lint`  | Lint code                          | `deno task lint`   |
| `check` | Type check                         | `deno task check`  |

### Project Structure

```text
agent-chatbot/
├── src/
│   ├── main.ts              # Entry point
│   ├── core/                # Core logic (agent, memory, workspace)
│   ├── platforms/           # Platform adapters (Discord, Misskey)
│   ├── skills/              # Agent skill implementations
│   ├── types/               # TypeScript type definitions
│   └── utils/               # Utility functions
├── prompts/                 # Bot prompt files
├── config/                  # Configuration examples
├── docs/                    # Documentation & BDD features
│   ├── DESIGN.md            # Design document
│   └── features/            # Gherkin feature specs
└── tests/                   # Test files
```

## Configuration

Configuration is loaded from `config.yaml` (YAML format). See [config/config.example.yaml](config/config.example.yaml) for a complete example.

### Environment Variables

| Variable         | Description              | Required |
| ---------------- | ------------------------ | -------- |
| `DISCORD_TOKEN`  | Discord bot token        | Yes*     |
| `MISSKEY_TOKEN`  | Misskey access token     | No       |
| `MISSKEY_HOST`   | Misskey instance host    | No       |
| `AGENT_MODEL`    | LLM model identifier     | No       |
| `LOG_LEVEL`      | Logging level            | No       |
| `DENO_ENV`       | Environment name         | No       |

\* Required if Discord platform is enabled.

## Container Deployment

```bash
# Build image
podman build -t agent-chatbot .

# Run with volume mounts
podman run -d --rm \
  -v ./data:/data \
  -v ./config.yaml:/app/config.yaml:ro \
  --env-file .env \
  --name agent-chatbot \
  agent-chatbot
```

## Documentation

- [AGENTS.md](AGENTS.md) - Development guide for AI agents working on this project
- [docs/DESIGN.md](docs/DESIGN.md) - Detailed design document
- [docs/features/](docs/features/) - BDD feature specifications (Gherkin)

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
