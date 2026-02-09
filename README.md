# AIr-Friends

![preview image](./docs/preview.webp)

A smart conversational chatbot with memory that works on Discord and Misskey. Powered by AI agents, it remembers conversations across channels while keeping your data organized in isolated workspaces.

## ✨ Highlights

- 🤖 **Multi-Platform**: Works on Discord and Misskey
- 🧠 **Persistent Memory**: Remembers conversations across different channels
- 🔒 **Privacy First**: Isolated workspaces per user with access control
- 🐳 **Easy Deploy**: One-command container deployment
- 🎨 **Customizable**: Template-based personality system
- 🔌 **Extensible**: Skill-based architecture with HTTP API

## 🚀 Quick Start

The easiest way to run AIr-Friends is using containers:

1. **Prepare configuration files**

   ```bash
   # Download example files
   wget https://raw.githubusercontent.com/jim60105/AIr-Friends/master/config.example.yaml -O config.yaml
   wget https://raw.githubusercontent.com/jim60105/AIr-Friends/master/.env.example -O .env

   # Edit with your credentials
   vim config.yaml
   vim .env
   ```

2. **Run with Podman (or Docker)**

   ```bash
   podman run -d --rm \
     -v data:/app/data \
     -v ./config.yaml:/app/config.yaml:ro \
     --env-file .env \
     --name air-friends \
     ghcr.io/jim60105/air-friends:latest
   ```

3. **Or use Compose**

   ```bash
   wget https://raw.githubusercontent.com/jim60105/AIr-Friends/master/compose.yml
   podman-compose up -d
   ```

That's it! Your bot should now be online.

## 📖 Documentation

- **[Development Guide](docs/DEVELOPMENT.md)** - Setup, configuration, and customization
- **[Design Document](docs/DESIGN.md)** - Architecture and technical details
- **[Agent Guide](AGENTS.md)** - For AI agents working on this codebase

## 🎨 Customizing Your Bot

Want to change your bot's personality? Simply edit the prompt files:

```bash
# Copy default prompts
cp -r prompts/ my-custom-prompts/

# Edit character files
vim my-custom-prompts/character_name.md
vim my-custom-prompts/character_info.md

# Mount when running
podman run -d --rm \
  -v ./data:/app/data \
  -v ./config.yaml:/app/config.yaml:ro \
  -v ./my-custom-prompts:/app/prompts:ro \
  --env-file .env \
  --name air-friends \
  ghcr.io/jim60105/air-friends:latest
```

See [Development Guide](docs/DEVELOPMENT.md#customizing-the-bot) for details.

## 🛠️ Development

For local development with Deno:

```bash
git clone https://github.com/jim60105/AIr-Friends.git
cd AIr-Friends

cp .env.example .env
cp config.example.yaml config.yaml
# Edit .env and config.yaml

deno task dev
```

See [Development Guide](docs/DEVELOPMENT.md) for complete setup instructions.

## 🔐 Access Control

Control who can interact with your bot using the whitelist feature:

```yaml
accessControl:
  replyTo: "whitelist" # Options: all, public, whitelist
  whitelist:
    - "discord/account/123456789012345678"
    - "misskey/account/abcdef1234567890"
```

See [Development Guide](docs/DEVELOPMENT.md#access-control--reply-policy) for details.

## 🏗️ Architecture

AIr-Friends acts as an ACP (Agent Client Protocol) client, delegating AI reasoning to external agents while maintaining persistent memory:

```text
┌─────────────────────────────────────────┐
│  Platform (Discord/Misskey)             │
│            ↓                            │
│  AIr-Friends (ACP Client)               │
│            ↓                            │
│  External AI Agent                      │
│  (Copilot/Gemini/OpenCode)              │
│            ↓                            │
│  Skills & Memory System                 │
└─────────────────────────────────────────┘
```

See [Design Document](docs/DESIGN.md) for detailed architecture.

## 📦 Container Details

The official container image includes:

- Pre-installed AI agent binaries (Copilot CLI, Gemini CLI, OpenCode CLI)
- Auto-approval mode enabled for isolated execution
- Health check endpoint on port 8080
- Default prompts at `/app/prompts` (can be overridden)

See [Development Guide](docs/DEVELOPMENT.md#opencode-configuration) for advanced configuration

## License

<img src="https://github.com/user-attachments/assets/c5def3ed-2715-4ef3-9a0c-00bada48b583" alt="gplv3" width="300" />

[GNU GENERAL PUBLIC LICENSE Version 3](LICENSE)

Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program. If not, see [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
