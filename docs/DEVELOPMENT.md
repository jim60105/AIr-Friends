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
│   ├── system_reply.md      # Normal message reply system prompt
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
| `GIT_BACKUP_ENABLED` | Enable Git backup (true/false, default: false) |
| `GIT_BACKUP_REMOTE_URL` | Remote Git repository URL (HTTPS) |
| `GIT_BACKUP_INTERVAL_MS` | Backup interval in ms (default: 3600000 = 1 hour) |
| `GIT_BACKUP_AUTHOR_NAME` | Git commit author name |
| `GIT_BACKUP_AUTHOR_EMAIL` | Git commit author email |
| `MODEL_ROUTING_ENABLED` | Enable model routing (true/false, default: false) |
| `MODEL_ROUTING_RULES` | Model routing rules as JSON string |
| `REMINDERS_ENABLED` | Enable scheduled reminders (true/false, default: false) |
| `REMINDERS_MAX_PER_USER` | Max active reminders per user (default: 20) |
| `REMINDERS_MIN_INTERVAL_MS` | Minimum reminder delay from now in ms (default: 60000) |
| `REMINDERS_PERSIST_PATH` | Reminder persistence file name (default: reminders.jsonl) |
| `REMINDERS_CHECK_INTERVAL_MS` | How often to check for due reminders in ms (default: 30000) |

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

### Model Routing

AIr-Friends supports dynamic model selection based on user identity, channel, or session type. This allows operators to fine-tune API costs and response quality per context.

#### How It Works

1. Rules are evaluated in array order (**first-match wins**)
2. The first matching rule determines the model
3. If no rule matches, the system falls back to `agent.model` (or section-specific model for self-research/memory-maintenance)
4. When `modelRouting.enabled` is `false` (default), routing is skipped entirely — backward compatible

#### Configuration

Via `config.yaml`:

```yaml
agent:
  model: "gpt-5-mini"  # default fallback model
  modelRouting:
    enabled: true
    rules:
      # Specific account + research keywords → research model
      - match:
          whitelist: "discord/account/123456789"
          contentKeywords: ["研究", "research"]
        model: "openrouter/google/gemini-2.5-pro"
      # Any message with research keywords → research model
      - match:
          contentKeywords: ["研究", "research", "論文", "paper"]
        model: "openrouter/google/gemini-2.5-pro"
      # Premium model for a specific user (any content)
      - match: { whitelist: "discord/account/123456789" }
        model: "openrouter/deepseek/deepseek-v3.2"
      # Cheaper model for spontaneous posts
      - match: { sessionType: "spontaneous" }
        model: "openrouter/deepseek/deepseek-v3.2"
      # Premium model for self-research
      - match: { sessionType: "self-research" }
        model: "github-copilot/claude-opus-4.6"
```

Via environment variables:

```bash
MODEL_ROUTING_ENABLED=true
MODEL_ROUTING_RULES='[{"match":{"whitelist":"discord/account/123","contentKeywords":["研究","research"]},"model":"openrouter/google/gemini-2.5-pro"},{"match":{"sessionType":"spontaneous"},"model":"openrouter/deepseek/deepseek-v3.2"}]'
```

#### Match Conditions

Each rule's `match` object supports multiple conditions combined with AND logic. All specified conditions must match for the rule to apply:

| Field | Example | Description |
|-------|---------|-------------|
| `whitelist` | `"discord/account/123"` | Match a specific whitelist entry |
| `sessionType` | `"message"` | Match a session type |
| `contentKeywords` | `["研究", "research"]` | Match message content containing any keyword (OR within array, case-insensitive). Only effective for `sessionType: "message"` |

Valid `sessionType` values: `"message"`, `"spontaneous"`, `"self-research"`, `"memory-maintenance"`

#### Fallback Chain

For `self-research` and `memory-maintenance` sessions, the fallback chain is:

```
modelRouting rules (if enabled & matched)
  → section-specific model (selfResearch.model / memoryMaintenance.model)
    → agent.model
```

For `message` and `spontaneous` sessions:

```
modelRouting rules (if enabled & matched)
  → agent.model
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

The system prompt (`prompts/system_reply.md`) uses [Vento](https://vento.js.org/) as its template engine. Vento is a JavaScript-based template engine that uses `{{ }}` syntax for both interpolation and control flow.

#### Key Features

- **Variable interpolation**: `{{ variableName }}` outputs the value of a variable
- **Conditionals**: `{{ if condition }}...{{ else }}...{{ /if }}`
- **Loops**: `{{ for item of collection }}...{{ /for }}`
- **Include**: `{{ include "./filename.md" }}` to include other template files
- **Set**: `{{ set varName }}...{{ /set }}` to assign content to a variable
- **JavaScript expressions**: Any valid JS expression works inside `{{ }}`
- **Comments**: `{{# This is a comment #}}` (not included in output)
- **Trimming**: `{{- ... -}}` removes surrounding whitespace

For complete Vento documentation, visit <https://vento.js.org/>

#### Available Template Variables

The following variables are available in all prompt templates:

| Variable    | Type      | Description                                    | Example                  |
| ----------- | --------- | ---------------------------------------------- | ------------------------ |
| `isDm`      | `boolean` | Whether this is a direct message conversation  | `true`                   |
| `platform`  | `string`  | Platform name                                  | `"discord"`, `"misskey"` |
| `userId`    | `string`  | User's platform ID                             | `"560842157351763989"`   |
| `channelId` | `string`  | Channel/conversation ID                        | `"873618490202931231"`   |
| `guildId`   | `string`  | Server/guild ID (empty string if N/A)          | `""`                     |
| `sessionId` | `string`  | Current skill API session ID                   | `"sess_abc123"`          |

**Special prompt variables** (only available in specific prompt types):

| Variable       | Available In                      | Description                     |
| -------------- | --------------------------------- | ------------------------------- |
| `rssItems`     | `system_self_research.md`         | Formatted RSS feed items        |
| `workspaceKey` | `system_memory_maintenance.md`    | User workspace identifier       |
| `memoriesDump` | `system_memory_maintenance.md`    | JSON dump of enabled memories   |
| `recentMessagesFetched` | `system_spontaneous.md`  | Whether recent messages were fetched |
| `importantMemories` | `system_spontaneous.md`       | Formatted important memories text |
| `recentMessages` | `system_spontaneous.md`          | Formatted recent messages text  |
| `availableEmojis` | `system_spontaneous.md`         | Formatted available emojis text |
| `userContextMessage` | `system_reply.md`          | Pre-formatted user context message |

#### Examples

**DM-specific instructions:**

```markdown
{{ if isDm }}
This is a private conversation. You can discuss personal topics freely.
{{ else }}
This is a public channel. Be mindful of other participants.
{{ /if }}
```

**Platform-specific formatting:**

```markdown
{{ if platform === "discord" }}
Use Discord Markdown for formatting (bold, italic, code blocks).
Message limit: 2000 characters.
{{ else if platform === "misskey" }}
Use MFM (Misskey Flavored Markdown) for formatting.
{{ /if }}
```

**Including fragment files:**

```markdown
{{- set myVariable }}{{ include "./my_fragment.md" }}{{ /set -}}

Hello, I am {{ myVariable }}.
```

**Using JavaScript expressions:**

```markdown
{{ new Date().toLocaleDateString("zh-TW") }}

{{ isDm ? "私訊模式" : "公開頻道模式" }}
```

#### Customizing Prompts

To customize the bot's character, edit individual fragment files (e.g., `character_name.md`, `character_info.md`) without touching `system_reply.md`. You can also override any prompt file by mounting your custom version:

```yaml
# compose.yml
volumes:
  - ./my-prompts/system_reply.md:/app/prompts/system_reply.md:ro,Z
  - ./my-prompts/character_name.md:/app/prompts/character_name.md:ro,Z
```

- Only override the files you need; others keep their container defaults
- Fragment files (e.g., `character_name.md`) can be plain text or use Vento syntax
- Your custom templates have access to all the template variables listed above

#### Migrating from Old Syntax

If you have custom prompt files using the old `{{placeholder}}` syntax, you need to update them:

| Old Syntax              | New Syntax                              |
| ----------------------- | --------------------------------------- |
| `{{character_name}}`    | `{{ include "./character_name.md" }}`   |
| `{{character_info}}`    | `{{ include "./character_info.md" }}`   |

For fragment values used multiple times, use `set` to load once:

```markdown
{{- set charName }}{{ include "./character_name.md" }}{{ /set -}}
Hello, I am {{ charName }}. {{ charName }} is my name.
```

> [!WARNING]
> This is a **breaking change**. The old `{{placeholder}}` syntax is no longer supported. In Vento, `{{placeholder}}` is interpreted as a variable reference, not a fragment include. If the variable is undefined, it will output an empty string or an error depending on the template engine configuration.

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

3. **Mount your custom prompt files when running the container:**

   Using `podman run`:

   ```bash
   podman run -d --rm \
     -v data:/app/data \
     -v ./config.yaml:/app/config.yaml:ro \
     -v ./my-custom-prompts/character_name.md:/app/prompts/character_name.md:ro \
     -v ./my-custom-prompts/character_info.md:/app/prompts/character_info.md:ro \
     --env-file .env \
     --name air-friends \
     ghcr.io/jim60105/air-friends:latest
   ```

   Using `compose.yml`:

   ```yaml
   volumes:
     # Mount only the prompt files you want to override
     - ./prompts/character_name.md:/app/prompts/character_name.md:ro,Z
     - ./prompts/character_info.md:/app/prompts/character_info.md:ro,Z
   ```

> [!TIP]
> Only the files you mount will be overridden. Files you don't mount keep their container defaults,
> so there's no need to provide all prompt files.

4. **Restart the container** to apply the changes:

   ```bash
   podman compose down && podman compose up -d
   ```

The container includes default prompts that will be used if you don't mount any custom prompt files.

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
