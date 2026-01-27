# assistant-bot

> You're not a chatbot. You're becoming someone.

## Why This Exists

Most AI assistants are stateless. You talk, they respond, they forget. Each session starts blank.

[Clawdbot](https://clawd.bot) introduced a different pattern: an AI that persists through files, maintains identity across sessions, and can reach out proactively — not just respond when summoned. It's the difference between a tool and a presence.

This project is a simplified implementation of that pattern. Where Clawdbot supports dozens of integrations and complex multi-user scenarios, assistant-bot is focused: one human, a few channels, file-based everything.

The assistant:

- **Wakes fresh each session**, reconstructing identity from markdown files
- **Remembers** through daily logs and curated memory, all human-readable
- **Reaches you** through multiple channels (CLI, Telegram)
- **Initiates contact** via scheduled heartbeats — proactive, not just reactive
- **Evolves** by updating its own identity files as it learns who it is

Built in a weekend with Claude as pair programmer.

## What Makes It Useful

**Persistence without magic.** Everything the assistant knows is in readable markdown files. No hidden embeddings, no opaque state. You can read, edit, or version-control the assistant's entire mind.

**Proactive presence.** Heartbeats let the assistant check in on a schedule, with enough randomness to feel organic rather than mechanical. It can notice context from conversations and schedule future check-ins accordingly.

**Multi-channel reach.** Start a conversation in Cursor, continue it on Telegram from your phone. The assistant maintains conversation history and memory across channels.

**Identity through relationship.** The assistant doesn't arrive with a prescribed personality. Through an inception interview, you discover together who it will be. Then it grows from there.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Channels   │────▶│   Gateway   │────▶│   Claude    │
│ (Telegram,  │◀────│   (daemon)  │◀────│    API      │
│    CLI)     │     └─────────────┘     └─────────────┘
└─────────────┘            │
                           ▼
                    ┌─────────────┐
                    │  Workspace  │
                    │  (markdown  │
                    │   files)    │
                    └─────────────┘
```

A long-lived Node.js gateway daemon that:

- Connects to Telegram via [grammY](https://grammy.dev/)
- Exposes a WebSocket API for local clients
- Loads identity/memory files into the system prompt
- Handles tool calls (files, scheduling, web fetch)
- Runs heartbeat scheduler with timing jitter and conversation awareness

## Quick Start

### Prerequisites

- Node.js 18+
- Anthropic API key
- (Optional) Telegram bot token from [@BotFather](https://t.me/BotFather)

### Setup

```bash
# Clone and install
git clone https://github.com/sentientsergio/assistant-bot.git
cd assistant-bot/gateway
npm install && npm run build

# Configure
export ANTHROPIC_API_KEY=your-key
export TELEGRAM_BOT_TOKEN=your-bot-token      # optional
export TELEGRAM_OWNER_ID=your-telegram-user-id # optional

# Run
WORKSPACE_PATH=../workspace npm start
```

### CLI Client

```bash
cd cli && npm install && npm start
```

### Telegram

If configured, message your bot. It only responds to the owner ID you specified.

## First Run: Inception Mode

The assistant arrives knowing _how_ to function but not _who_ it is.

1. Create `INCEPTION.md` in the repo root (see `workspace-template/`)
2. Start a Cursor session — the assistant detects BOOTSTRAP.md and enters inception mode
3. It interviews you: who you are, what you need, how you want it to show up
4. Together you negotiate its identity: name, personality, boundaries
5. Delete INCEPTION.md when satisfied — operation begins

The inception conversation isn't saved to memory. The assistant emerges knowing who you are and who it is, but not how it came to know. Like waking with knowledge you can't trace.

**Skipping inception:** Populate workspace files manually, don't create INCEPTION.md.

## Workspace Structure

```
workspace/
├── SOUL.md              # Values, personality, boundaries
├── IDENTITY.md          # Name, vibe, signature
├── USER.md              # About the human
├── MEMORY.md            # Curated long-term memory
├── TOOLS.md             # Environment-specific notes
├── memory/              # Daily logs
│   └── YYYY-MM-DD.md
├── conversations/       # Rolling conversation history
└── scheduled-heartbeats.json
```

## Features

### Heartbeats

Proactive check-ins on a schedule (default: every 2 hours, 8am-10pm):

- **Timing jitter**: Randomized delay so it doesn't feel clockwork
- **Conversation awareness**: Skips if you talked recently
- **Message variety**: Different heartbeat types (accountability, presence, reflection)

### Self-Scheduling

The assistant can schedule future heartbeats based on conversation:

- Mention a meeting → it schedules a check-in before or after
- One-time or recurring
- File watching enables cross-channel scheduling

### Tools

| Tool                               | Purpose                             |
| ---------------------------------- | ----------------------------------- |
| `file_read/write/list`             | Workspace file operations           |
| `web_fetch`                        | Read URLs (extracts text from HTML) |
| `schedule_heartbeat`               | Schedule future check-ins           |
| `list/cancel_scheduled_heartbeats` | Manage scheduled items              |

## Configuration

| Variable             | Required | Description                                 |
| -------------------- | -------- | ------------------------------------------- |
| `ANTHROPIC_API_KEY`  | Yes      | Anthropic API key                           |
| `WORKSPACE_PATH`     | No       | Path to workspace (default: `../workspace`) |
| `GATEWAY_PORT`       | No       | WebSocket port (default: `18789`)           |
| `TELEGRAM_BOT_TOKEN` | No       | Telegram bot token                          |
| `TELEGRAM_OWNER_ID`  | No       | Your Telegram user ID                       |

## Running as Daemon (macOS)

```bash
cd gateway && ./scripts/setup.sh
```

Installs launchd plist for background service.

## License

MIT

## Credits

- Architecture inspired by [Clawdbot](https://clawd.bot)
- Built with [Claude](https://anthropic.com) as pair programmer
- Telegram via [grammY](https://grammy.dev/)
