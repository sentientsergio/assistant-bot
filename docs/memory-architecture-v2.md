# Memory Architecture v2 — Design Document

_Sprint handoff from [conversation on Feb 26, 2026](c88040a2-725e-489e-b2ab-407064d4c178). Authored by Claire.dev + Sergio._

---

## Status: Design phase. No code written yet.

The plan file at `.cursor/plans/memory_architecture_redesign_a888fe14.plan.md` has implementation-level details and TODOs. This document is the design rationale.

---

## The Problem

Claire's memory system was designed around a three-tier model (HOT/WARM/COLD) where:
- **HOT** = last 5 messages loaded as text in the system prompt
- **WARM** = LanceDB vector store searched by semantic similarity
- **COLD** = compressed summaries (never implemented)

This architecture has three critical failures, all observed in production on Feb 26, 2026.

### Failure 1: Claire forgets what was said 10 minutes ago

`MAX_MESSAGES_HOT = 5` in `conversation.ts`. In an active conversation with 20+ exchanges in 3 hours, message 6 and earlier vanish. Sergio reported his water intake, medications, fasting status, and movement plans. Fifteen minutes and eight messages later, Claire asked him for all four again — because those messages had scrolled out of the 5-message window.

The WARM vector search did not help. It searches by semantic similarity to the *current user message*. When Sergio sent a message about a time calculation bug, the vector search looked for past conversations about time bugs — not for his status report from 15 minutes ago. The search is keyed on the wrong thing.

### Failure 2: The system prescribes instead of letting Claire reason

When `status.json` is stale (>2 hours since last update), the system injects a prescriptive script into the system prompt:

```
⚠️ Habits Status Check Needed
Status was last updated 3h ago. Before the main topic, ask for a quick update:
- Water: how many oz so far?
- Meds: taken today?
- Movement: any activity?
- Fast status: in window, fasting, etc.?
```

Claire executes this script verbatim. She doesn't check whether Sergio already provided this information in the conversation. She can't — the information scrolled out of her 5-message window. The system told her to ask, and she asked.

This is the system doing Claire's thinking for her, and doing it badly.

### Failure 3: The system pre-fetches context Claire didn't ask for

Every turn, the system:
1. Calls `getRelevantMemories(userMessage)` — vector search keyed on the current message
2. Calls `getAllFacts()` — dumps all 587 extracted facts into the prompt (~6K tokens)
3. Calls `summarizeCrossChannelActivity()` — Haiku API call to summarize other channels

None of these are requested by Claire. The vector search often returns irrelevant results (wrong query). The 587 facts dilute context with noise. The Haiku call usually returns "No significant activity." All three add latency and tokens to every turn.

---

## Design Principles

These emerged through iterative discussion and are non-negotiable for v2.

### 1. Let Claire reason

Stop doing Claire's thinking for her. Don't pre-fetch context she didn't ask for. Don't write scripts for her to execute. Don't guess what's relevant. Give her tools and let her decide what she needs.

### 2. Absence in context is not absence in knowledge

Claire's immediate recall (the conversation + system prompt) is a window, not the whole picture. If something isn't visible, it might still exist in her archive. Claire must understand this about herself and check before assuming ignorance.

### 3. The reasoning layer must know the memory layers exist

Tools are not enough. If Claire doesn't know her memory is layered, she won't use the layers. Her system prompt must include a model of her own cognition — how her memory works, when to search deeper, when not to.

### 4. No sessions in Telegram

Telegram is a continuous stream with gaps. There is no "session start." The conversation just keeps going. Any architecture that depends on session boundaries is wrong for this medium.

### 5. Data-type-driven loading, not tier-driven loading

Different data types have different relevance patterns and loading strategies. Identity files are always relevant (load once). Conversation turns are always relevant (accumulate). Facts are situationally relevant (search on demand). Tier labels obscure this.

---

## Architecture

### Conversation continuity (the core fix)

**Current:** Each message triggers a fresh API call. The system assembles a system prompt from scratch, loads 5 messages from JSON as formatted text, and makes a stateless call. Claude never sees the actual conversation.

**Proposed:** Maintain an actual `messages: MessageParam[]` array in process memory. Append each user message and assistant response. Pass the full array to the API on every turn. Use Anthropic's **server-side Compaction** (beta `compact-2026-01-12`, available for Sonnet 4.6 and Opus 4.6) to manage context size.

The gateway process is long-lived (launchd). The array persists in memory across turns. Persist to disk on each turn for crash recovery. On process restart, reload from disk.

When the conversation approaches ~100K input tokens, Compaction automatically summarizes older turns into a compaction block. Recent turns stay verbatim. The conversation continues seamlessly.

Compaction custom instructions should preserve:
- Status commitments with specific numbers (water oz, fasting times)
- Emotional tone and relationship context
- Open threads and promises
- Dev tickets and observations
- Time references

### System prompt (identity + workspace files)

**Current:** Rebuilt from disk every single turn (~33K chars, ~8K tokens). Includes identity files, memory files, status.json, and prescriptive instructions.

**Proposed:** Build once. Rebuild only when workspace files change, a significant time gap passes (refreshes "Current time" header), or the process restarts. Use prompt caching (`cache_control: { type: "ephemeral" }`) to avoid re-tokenizing on every turn.

Contents:
- Identity files: SOUL.md, IDENTITY.md, USER.md, TOOLS.md
- Durable knowledge: MEMORY.md, THREADS.md, DEV-NOTES.md, SELF-AWARENESS.md
- Daily memory files: today + yesterday
- Raw status.json content (no prescriptive script — just the data)
- **Memory self-model** (see below)

### The `search_memory` tool

**Current:** System pre-searches vector store on every turn (keyed on user's latest message) and dumps all 587 facts. Both happen automatically before Claire sees anything.

**Proposed:** Expose a single `search_memory` tool. Claire invokes it when she needs to recall something from beyond the current conversation. The tool searches the vector store (192 conversation chunks) and/or the facts table (587 extracted facts) and returns results.

```typescript
{
  name: "search_memory",
  description: "Search your past conversations and stored facts. Use when the current conversation doesn't contain information you need.",
  input_schema: {
    properties: {
      query: { type: "string", description: "What you're trying to remember. Be specific." },
      search_type: { type: "string", enum: ["conversations", "facts", "both"] }
    },
    required: ["query"]
  }
}
```

The search infrastructure already exists (`retrieveMemories()` in `retrieval.ts`, `findSimilarFacts()` in `facts.ts`). It just needs to be invoked by Claire instead of by the system.

The write side stays the same: after each exchange, the conversation is chunked and embedded into the vector store, and Haiku extracts facts. Only the read side changes.

### The metacognitive layer

This is the piece that makes everything else work. Without it, Claire has tools she doesn't know when to use.

Add to the system prompt:

```markdown
## How Your Memory Works

You have layered memory. Understanding this matters.

**Immediate context (this conversation):** Everything said between you and Sergio
in this exchange. Complete for what's here, but only covers the current conversation.

**Workspace files (your curated knowledge):** MEMORY.md, THREADS.md, DEV-NOTES.md,
SELF-AWARENESS.md, daily memory logs, status.json. Durable knowledge you or your
dev team have written down. Loaded into your context.

**Your archive (past conversations and extracted facts):** A searchable store of
past conversation chunks and hundreds of extracted facts — preferences, decisions,
personal info, project details. NOT loaded automatically. Use search_memory to access.

**The critical rule:** If something isn't in this conversation or your workspace
files, THAT DOES NOT MEAN YOU DON'T KNOW IT. It may be in your archive. Before
assuming you don't know something, before asking Sergio to tell you again, check.

**When to search:**
- Sergio references something from a past conversation
- You need context about a topic you haven't discussed recently
- You're about to ask Sergio for information he may have already told you
- You notice a gap between what you should know and what you can see

**When NOT to search:**
- The answer is already in this conversation
- The answer is in your workspace files
- It's a new topic with no history
```

---

## What Gets Deleted

| Current behavior | Why it's wrong | Action |
|---|---|---|
| `MAX_MESSAGES_HOT = 5` | Too small; causes forgetting | Replace with full messages array + Compaction |
| `getRelevantMemories(userMessage)` auto-call | Wrong query; system guessing what's relevant | Delete. Claire uses `search_memory` tool instead. |
| `getAllFacts()` dump (587 facts every turn) | Doesn't scale; dilutes context | Delete. Claire uses `search_memory` tool instead. |
| Prescriptive stale status script | Overrides reasoning; causes redundant questions | Delete. Include raw status.json; let Claire reason. |
| `formatHistoryForPrompt()` | Formats messages as text in system prompt | Delete. Messages are in the API messages array now. |
| `summarizeCrossChannelActivity()` Haiku call | Extra API call every turn; usually returns nothing | Delete. Include raw recent cross-channel messages. |

## What Stays the Same

- **Vector store write pipeline** — chunks still stored after each exchange
- **Fact extraction write pipeline** — Haiku still extracts facts from each exchange
- **Awareness context** (`awareness.ts`) — still used for heartbeat suppression decisions
- **Heartbeat system** — fires on schedule, decides whether to message
- **Self-awareness nightly pass** — unchanged
- **messages.json as log of record** — every message still written here for history and cross-channel reads
- **Workspace files as identity layer** — SOUL.md, IDENTITY.md, etc.

---

## Open Questions

### 1. How do heartbeats interact with conversation state?

Heartbeats currently use `loadHeartbeatContext()` which builds a separate, lighter system prompt. If the main conversation is now a persistent messages array, should heartbeat messages be injected into that array? Or should heartbeats remain separate (their own context, their own API call)?

If separate: heartbeats lose context of the ongoing conversation.
If integrated: heartbeats see everything Claire and Sergio discussed, but the heartbeat prompt ("should you reach out?") mixes awkwardly with the conversation.

### 2. What happens on process restart?

The messages array is persisted to disk. On restart, we reload it. But Compaction blocks are part of the messages array — do they survive serialization/deserialization correctly? Need to verify the Anthropic SDK handles this.

### 3. Should facts be curated/pruned?

587 facts and growing. Many are likely stale or contradictory. The fact extraction pipeline (Haiku) has ADD/UPDATE/DELETE operations but no periodic review. Should the nightly self-awareness pass include fact hygiene?

### 4. Cost implications

Every turn now sends the full messages array (or compaction summary + recent turns). This is more input tokens per turn than the current 5-message approach. Prompt caching mitigates this. Compaction reduces the growth rate. But we should estimate the cost difference before deploying.

### 5. Does the awareness context still make sense?

`awareness.ts` builds a structured awareness block (self-awareness, sergio-awareness, conversation state) from the messages.json log. If Claire now has the full conversation in her messages array, she can see her own recent activity directly. The awareness block might be redundant for Telegram — though it may still serve heartbeat suppression logic.

### 6. How does the time bug relate?

Claire showed a 1-hour time offset on Feb 26. The system timezone is confirmed correct (America/New_York). Two theories remain:
- Claire wrote wrong data to status.json (eating_window_end = 19:00 instead of 18:00), which fed back into her context
- LLM arithmetic error on time math

This is separate from the memory architecture redesign but related: if Claire writes bad data and it feeds back into her context, the system amplifies the error. The metacognitive layer might help here — if Claire knows to verify her own calculations against the conversation record.

---

## References

- Anthropic Compaction docs: https://platform.claude.com/docs/en/build-with-claude/compaction
- Anthropic Context Editing docs: https://platform.claude.com/docs/en/build-with-claude/context-editing
- Plan file: `.cursor/plans/memory_architecture_redesign_a888fe14.plan.md`
- Existing architecture: `docs/architecture.md`
- Context assembly redesign notes: `docs/context-assembly-redesign.md`
- Observed failure modes: `research/1-observed-failure-modes.md`

---

_Design document — February 26, 2026. Ready for sprint planning._
