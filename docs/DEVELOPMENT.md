# Development Guide

This guide provides comprehensive instructions for developing and customizing AIr-Friends. For architectural details and design decisions, see [DESIGN.md](DESIGN.md).

## Prerequisites

- [Deno](https://deno.land/) 2.x or higher
- [dumb-init](https://github.com/Yelp/dumb-init) - Required for wrapping agent subprocesses with proper signal forwarding and zombie process reaping
- Discord Bot Token (for Discord integration)
- Misskey Access Token (for Misskey integration)
- An ACP-compliant CLI agent (OpenCode CLI, GitHub Copilot CLI, Gemini CLI. The recommended one is OpenCode CLI)
- For OpenCode CLI: GEMINI_API_KEY, OPENCODE_API_KEY, or OPENROUTER_API_KEY for [provider access](https://opencode.ai/docs/providers/)

## Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/jim60105/AIr-Friends.git
   cd AIr-Friends
   ```

2. **Set up environment variables**

   ```bash
   cp .env.example .env
   # Edit .env with your credentials and configuration
   ```

3. **Optional: Configure the bot**

   All the necessary configuration can be done through environment variables. However, if you prefer using a YAML config file, copy the example config:

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

> [!WARNING]  
> YOLO mode auto-approves ALL permission requests from the ACP agent. Only use this in trusted container environments or for testing purposes.

## Available Tasks

| Task    | Description                      | Command           |
| ------- | -------------------------------- | ----------------- |
| `dev`   | Development mode with hot reload | `deno task dev`   |
| `start` | Production mode                  | `deno task start` |
| `test`  | Run tests                        | `deno task test`  |
| `fmt`   | Format code                      | `deno task fmt`   |
| `lint`  | Lint code                        | `deno task lint`  |
| `check` | Type check                       | `deno task check` |

## Project Structure

```text
AIr-Friends/
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
│   ├── DEVELOPMENT.md       # This file
│   ├── SKILLS_IMPLEMENTATION.md
│   └── features/            # Gherkin feature specs
└── tests/                   # Test files
```

For more details on the architecture, see [DESIGN.md](DESIGN.md).

For development guide for AI agents working on this codebase, see [AGENTS.md](../AGENTS.md).

## Configuration

Configuration is loaded from `config.yaml` (YAML format). See [config.example.yaml](../config.example.yaml) for a complete example.

### Environment Variables

| Variable             | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `DISCORD_ENABLED`    | Enable Discord integration (true/false)              |
| `MISSKEY_ENABLED`    | Enable Misskey integration (true/false)              |
| `DISCORD_TOKEN`      | Discord bot token                                    |
| `MISSKEY_HOST`       | Misskey instance host                                |
| `MISSKEY_TOKEN`      | Misskey access token                                 |
| `AGENT_MODEL`        | LLM model identifier (e.g., "gpt-5-mini")            |
| `AGENT_DEFAULT_TYPE` | Default ACP agent type (copilot/gemini/opencode)     |
| `REPLY_TO`           | Reply policy mode (`all`/`public`/`whitelist`)       |
| `WHITELIST`          | Whitelist entries (comma-separated, replaces config) |
| `LOG_LEVEL`          | Logging level (DEBUG/INFO/WARN/ERROR)                |
| `DENO_ENV`           | Environment name (dev/prod)                          |
| `GITHUB_TOKEN`       | GitHub token for Copilot                             |
| `GEMINI_API_KEY`     | Gemini API key for Gemini CLI/OpenCode               |
| `OPENCODE_API_KEY`   | OpenCode API key                                     |
| `OPENROUTER_API_KEY` | OpenRouter API key                                   |
| `GELF_ENABLED`       | Enable GELF log output (true/false, default: false)  |
| `GELF_ENDPOINT`      | GELF HTTP endpoint URL                               |
| `GELF_HOSTNAME`      | Source hostname in GELF messages (default: air-friends) |
| `SELF_RESEARCH_ENABLED` | Enable self-research (true/false, default: false) |
| `SELF_RESEARCH_MODEL` | LLM model for self-research (separate from chat) |
| `SELF_RESEARCH_RSS_FEEDS` | RSS feed sources as JSON string |
| `SELF_RESEARCH_MIN_INTERVAL_MS` | Minimum interval between research sessions (default: 43200000) |
| `SELF_RESEARCH_MAX_INTERVAL_MS` | Maximum interval between research sessions (default: 86400000) |

### Access Control & Reply Policy

AIr-Friends can centrally control whether an incoming event is processed by `AgentCore` using `accessControl`:

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

### GELF Log Output

AIr-Friends supports sending structured log messages to a GELF (Graylog Extended Log Format) compatible server via HTTP. This enables centralized log management using tools like Graylog or Grafana Loki.

#### Configuration

Via `config.yaml`:

```yaml
logging:
  level: "INFO"
  gelf:
    enabled: true
    endpoint: "http://graylog.example.com:12202/gelf"
    hostname: "my-bot-instance"
```

Via environment variables:

```bash
GELF_ENABLED=true
GELF_ENDPOINT=http://graylog.example.com:12202/gelf
GELF_HOSTNAME=my-bot-instance
```

#### How It Works

- Log messages are sent asynchronously via HTTP POST to the configured endpoint
- The GELF transport uses fire-and-forget pattern — log sending never blocks the main execution flow
- Failed sends are logged to stderr and silently discarded
- Each request has a 5-second timeout to prevent hanging connections
- All log levels (DEBUG through FATAL) are mapped to corresponding Syslog severity levels
- Context data from log entries is automatically flattened into GELF additional fields
- Sensitive data is already sanitized before reaching the GELF transport

#### GELF Message Example

```json
{
  "version": "1.1",
  "host": "air-friends",
  "short_message": "Configuration loaded successfully",
  "timestamp": 1735689600.000,
  "level": 6,
  "_module": "ConfigLoader",
  "_log_level": "INFO",
  "_enabledPlatforms": "[\"discord\"]"
}
```

#### Container Deployment

When running in a container, configure GELF via environment variables in your `compose.yml`:

```yaml
services:
  air-friends:
    image: ghcr.io/jim60105/air-friends:latest
    environment:
      - GELF_ENABLED=true
      - GELF_ENDPOINT=http://graylog:12202/gelf
      - GELF_HOSTNAME=air-friends-production
```

### OpenCode Configuration

The container includes a pre-configured `opencode.json` that automatically sets up OpenCode CLI with:

- **Gemini Provider**: Uses `GEMINI_API_KEY` environment variable
- **Only Necessary Tools Enabled**: enable bash, disable edit and write
- **Auto-compaction**: Enabled for better token management
- **Auto-update**: Disabled (container should be rebuilt for updates)

The configuration file is located at `~/.config/opencode/opencode.json` inside the container. OpenCode will automatically use the GitHub and Gemini providers when their respective tokens are available as environment variables.

You can customize OpenCode behavior by mounting your own `opencode.json` configuration file:

```bash
podman run -d --rm \
  -v data:/app/data \
  -v ./config.yaml:/app/config.yaml:ro \
  -v ./my-opencode.json:/home/deno/.config/opencode/opencode.json:ro \
  --env-file .env \
  --name air-friends \
  ghcr.io/jim60105/air-friends:latest
```

For more information about OpenCode configuration, see the [OpenCode documentation](https://opencode.ai/docs/config/).

## Customizing the Bot

I recommend checking out my blog post, ["🤖 AI Can Cosplay Too? A Beginner's Guide to LLM Character Role-Playing"](https://xn--jgy.tw/AI/design-roleplay-llm-prompts), for tips on setting up your character.

### Prompt Template System

The system prompt (`prompts/system.md`) supports a template placeholder system. Any `{{placeholder}}` in the file is automatically replaced with the content of the corresponding `.md` file in the same directory.

For example, if `system.md` contains `{{character_name}}`, the system loads `prompts/character_name.md` and replaces all occurrences of `{{character_name}}` with its trimmed content.

It does not support nesting and will only replace the content within {{ double curly braces }} in system.md.

#### How It Works

1. On startup, the system reads `prompts/system.md`
2. It scans the `prompts/` directory for other `.md` files (excluding `system.md` itself)
3. For each file, it maps the filename (without `.md` extension) to the file's trimmed content
4. All `{{filename}}` placeholders in `system.md` are replaced with the corresponding content
5. Placeholders without a matching file are left unchanged and a warning is logged

#### Example

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

#### Customizing Prompts in Container Deployments

When running AIr-Friends in a container, you can customize the bot's character by mounting your own prompt files without rebuilding the container image:

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
     -v data:/app/data \
     -v ./config.yaml:/app/config.yaml:ro \
     -v ./my-custom-prompts:/app/prompts:ro \
     --env-file .env \
     --name air-friends \
     ghcr.io/jim60105/air-friends:latest
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
   podman compose down && podman compose up -d
   ```

The container includes default prompts that will be used if you don't mount a custom prompts directory.

## Testing

Run the test suite:

```bash
deno task test
```

### Data Directory Structure

During development, data is stored under `./data/` (configurable via `workspace.repoPath`):

```text
data/
├── workspaces/              # Per-user workspaces
│   └── {platform}/{userId}/ # Each user's memory files
└── agent-workspace/         # Agent's global knowledge workspace
    ├── README.md            # Usage guide
    ├── notes/               # Knowledge notes by topic
    │   ├── _index.md        # Notes index
    │   └── {topic}.md       # Individual notes
    └── journal/             # Daily reflections
        └── {YYYY-MM-DD}.md  # Daily entries
```

The agent workspace is automatically created on first use by `WorkspaceManager.getOrCreateAgentWorkspace()`.

For more information about testing practices and guidelines, see [DESIGN.md](DESIGN.md).

## Documentation

- [DESIGN.md](DESIGN.md) - Detailed design document with architecture and data flow
- [SKILLS_IMPLEMENTATION.md](SKILLS_IMPLEMENTATION.md) - Skills implementation guide
- [features/](features/) - BDD feature specifications (Gherkin)
- [misskey/](misskey/) - Misskey integration documentation
- [AGENTS.md](../AGENTS.md) - Development guide for AI agents

## Contributing

Please ensure your code follows the project's coding standards:

1. Run `deno fmt` before committing
2. Run `deno lint` to check for issues
3. Ensure all tests pass with `deno test`
4. Follow the architecture patterns described in [DESIGN.md](DESIGN.md)
