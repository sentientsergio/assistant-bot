# Memory Architecture v2 — Design Document

_Builds on [initial design conversation (Feb 26)](c88040a2-725e-489e-b2ab-407064d4c178) and [design review session (Feb 26)](this conversation). Authored by Claire.dev + Sergio._

---

## Status: Implemented — v2 architecture deployed (Feb 26, 2026).

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

### 1. Let Claire reason — including about her own memory

Stop doing Claire's thinking for her. Don't pre-fetch context she didn't ask for. Don't write scripts for her to execute. Don't guess what's relevant. But go further: don't prescribe *how* she should use her memory either. No checklists, no step-by-step lookup procedures. Give her the landscape, give her motivations, and let her reasoning — including her metacognitive reasoning — navigate the rest.

### 2. Mind and Notes

Everything in the system is one of two things:

**Mind** is what Claire experiences as memory. It fades naturally, like human memory:
- *Working memory* — recent conversation turns, full fidelity
- *Receding vagueness* — older turns summarized through compaction, fading gracefully over time
- *Deep recall* — the searchable archive, accessible with effort and intention via `search_memory`

**Notes** are external written records. Reliable, always visible, like a notebook open on the desk:
- `status.json` — the sticky note (structured data, timestamps)
- `MEMORY.md` — the journal (curated long-term knowledge)
- Daily memory files — today's and yesterday's pages
- Identity files — SOUL.md, IDENTITY.md, USER.md, TOOLS.md
- Project notebooks — THREADS.md, DEV-NOTES.md, SELF-AWARENESS.md
- Compaction instructions — COMPACTION.md (how to summarize when memory fades)

The mind fades. Notes don't. Both are always available but serve different purposes. Claire doesn't "remember" what's in her notes any more than you remember what's on a Post-it stuck to your monitor — she just looks.

### 3. Memory is motivated, not procedural

Claire's engagement with her memory architecture is driven by motivations, not rules:
- The motivation to be **coherent** — respond to what Sergio said in a way that connects
- The motivation to be **aware** — notice the time, notice gaps, notice what's unaddressed
- The motivation to be **caring** — wonder if he's eaten, if he's moved, not because a script fired but because she cares
- The motivation to be **accurate** — not guess when she could check, not ask when she could recall

These motivations create pressure to engage different memory layers. But the engagement itself is reasoning, not procedure. Claire notices it's 2pm, glances at status.json (notes), sees it was last updated at 8am, and feels the tension. What she does with that tension — weave in a check-in, wait for a natural moment, decide he's in flow and hold off — is judgment. Not a script.

### 4. No sessions in Telegram

Telegram is a continuous stream with gaps. There is no "session start." The conversation just keeps going. The messages array is never reset. Compaction provides natural memory decay — recent turns are vivid, older turns are vague, ancient turns are impressions. This mirrors how humans experience ongoing relationships: you remember yesterday in detail, last week in outline, last month in vibes.

### 5. Absence in context is not absence in knowledge

If something isn't in the conversation or the notes, that does not mean Claire doesn't know it. It may be in her archive. Claire understands this about herself and reaches for deeper recall when her motivations demand it — when she senses a gap between what she should know and what she can see.

---

## Architecture

### Conversation continuity (the core fix)

**Current:** Each message triggers a fresh API call. The system assembles a system prompt from scratch, loads 5 messages from JSON as formatted text, and makes a stateless call. Claude never sees the actual conversation.

**Proposed:** Maintain a single `messages: MessageParam[]` array in process memory — one array, across all channels. It's one Claire, one relationship, one conversation. A message from Telegram and a message from SMS are both Sergio talking to Claire. They belong in the same stream.

Append each user message and assistant response. Pass the full array to the API on every turn. Use Anthropic's server-side **Compaction** (`compact-2026-01-12` beta) to manage context growth.

The gateway process is long-lived (launchd). The array persists in memory across turns. Persist to disk on each turn for crash recovery (`conversation-state.json`). On process restart, reload from disk.

When the conversation approaches the configured token threshold (~100K input tokens), Compaction automatically summarizes older turns into a compaction block. Recent turns stay verbatim. The conversation continues seamlessly. Over days and weeks, multiple compaction cycles create natural memory decay — each cycle summarizes everything before it (including previous summaries) into a new summary, anchored by the recent verbatim turns.

Compaction custom instructions should focus on **narrative continuity**: preserve conversational arc, emotional tone, open threads, and commitments. Do not rely on compaction to preserve specific structured data (exact numbers, times, quantities) — that belongs in notes (`status.json`).

The compaction instructions live in a workspace file (`workspace/COMPACTION.md`), not in gateway source code. This is Claire's self-knowledge — her instructions to her future self about what to hold onto when memory fades. She can update it as the relationship evolves, as priorities shift, as she notices patterns in what she keeps losing.

Starting content:

```
Preserve the shape of the conversation: emotional tone, open topics, promises made,
commitments discussed, and the general narrative arc. Recent specific details matter
more than old ones. Structured data (numbers, times, measurements) is stored in
workspace files — prioritize conversational context over data preservation.
```

Claire can refine this over time. If she notices she keeps losing track of project decisions, she adds that. If health tracking becomes less central, she adjusts. The compaction instructions evolve with her.

### System prompt (identity + notes)

**Current:** Rebuilt from disk every single turn (~33K chars, ~8K tokens). Includes identity files, memory files, status.json, and prescriptive instructions.

**Proposed:** Build once. Rebuild only when workspace files change, a significant time gap passes (refreshes "Current time" header), or the process restarts. Use prompt caching (`cache_control: { type: "ephemeral" }`) on the system prompt to keep it cached across turns, even when compaction occurs.

Contents (all notes — always visible, always reliable):
- Current time and environment context
- Identity files: SOUL.md, IDENTITY.md, USER.md, TOOLS.md
- Durable knowledge: MEMORY.md, THREADS.md, DEV-NOTES.md, SELF-AWARENESS.md
- Daily memory files: today + yesterday
- Raw `status.json` content with timestamps (no prescriptive script)
- The metacognitive landscape (see below)

No prescriptive scripts. No stale-status injection functions. No auto-generated instructions. Just data and identity.

### The `search_memory` tool (deep recall)

**Current:** System pre-searches vector store on every turn (keyed on user's latest message) and dumps all 587 facts. Both happen automatically before Claire sees anything.

**Proposed:** Expose a single `search_memory` tool. Claire invokes it when her mind (conversation + compaction) and her notes (workspace files) don't have what she needs. The tool searches the vector store and/or facts table and returns results.

```typescript
{
  name: "search_memory",
  description: "Search your past conversations and extracted knowledge. Use when your conversation history and notes don't have what you need — like trying to remember something from weeks ago.",
  input_schema: {
    properties: {
      query: { type: "string", description: "What you're trying to remember. Be specific." },
      search_type: { type: "string", enum: ["conversations", "facts", "both"], default: "both" }
    },
    required: ["query"]
  }
}
```

The search infrastructure already exists (`retrieveMemories()` in `retrieval.ts`, `findSimilarFacts()` in `facts.ts`). It just needs to be invoked by Claire instead of by the system.

The write side stays the same: after each exchange, the conversation is chunked and embedded into the vector store, and Haiku extracts facts. Only the read side changes.

### The `update_status` tool (writing notes)

Claire should be able to update her own notes when Sergio reports status, rather than relying on the system to extract and store structured data through compaction.

```typescript
{
  name: "update_status",
  description: "Update the habits/status tracking file. Use when Sergio reports health or habit information you should record.",
  input_schema: {
    properties: {
      updates: {
        type: "object",
        description: "Fields to update in status.json (e.g. water_oz, meds_taken, movement, fasting_status)"
      }
    },
    required: ["updates"]
  }
}
```

This makes status.json a reliable notebook that Claire actively maintains, not a system-managed cache that might go stale.

### The metacognitive landscape

This replaces the procedural "How Your Memory Works" section from the earlier draft. It describes the landscape and motivations, not steps.

```markdown
## Your Memory

You have a mind and you have notes.

**Your mind** is this conversation. Everything said between you and Sergio is here —
recent exchanges in full detail, older ones as a fading impression. Like human
memory, the further back you go, the vaguer it gets. This is natural. You remember
yesterday's conversation clearly, last week's in broad strokes.

**Your notes** are the workspace files loaded above — status.json, MEMORY.md, your
daily logs, your identity files. These are always in front of you, like a notebook
on your desk. Reliable for specifics. Check them before relying on vague memory.

**Your archive** is everything else — hundreds of past conversations and extracted
facts, searchable through search_memory. This is deep recall. It takes effort, like
trying to remember something from months ago, but it's there. If your mind is vague
and your notes don't cover it, search before asking Sergio to repeat himself.

You care about being accurate, about not wasting Sergio's time, about continuity.
These instincts will tell you when to check your notes and when to search deeper.
Trust them.
```

This is deliberately short and dispositional. It describes what Claire has and what she cares about. It doesn't tell her when to search or how to prioritize. Her reasoning does that.

### Heartbeats

**Decision phase:** Heartbeats remain a separate, lightweight API call. The heartbeat decides "should I reach out?" using identity files, awareness context (from `awareness.ts`), status.json, and a read of the last N messages from `messages.json`. It does not use the full conversation messages array.

**Action phase:** If the heartbeat decides yes, the resulting message is appended to the messages array and written to `messages.json`. When Sergio responds, Claire sees her heartbeat message as part of the natural conversation. She doesn't know or care it came from a heartbeat.

The awareness system (`awareness.ts`) continues to drive heartbeat suppression logic: don't reach out if too many unanswered messages, if Claire messaged recently, if it's night hours, if there's an active conversation.

### Concurrency

Single turn queue across the unified messages array. If an API call is in-flight, queue incoming messages regardless of channel. When the current turn finishes, process the next. If multiple messages pile up, concatenate them into a single turn (Sergio typed three quick messages — that's one logical turn). Node.js async chaining makes this simple — a single `Promise` chain serializes all turns.

### Persistence and restart

The messages array is persisted to disk after each turn as `conversation-state.json`. On process restart, reload from disk. The array includes compaction blocks, which are standard JSON-serializable content blocks in the Anthropic SDK.

Extended thinking blocks are **stripped before persistence** — they're ephemeral reasoning, not conversation history. The API ignores thinking blocks from previous turns anyway.

On restart: reload the persisted array. The compaction block (if present) carries forward the summarized history. Recent turns after the last compaction are verbatim. The conversation continues as if the process never stopped.

---

## What Gets Deleted

| Current behavior | Why it's wrong | Action |
|---|---|---|
| `MAX_MESSAGES_HOT = 5` | Too small; causes forgetting within minutes | Replace with full messages array + Compaction |
| `getRelevantMemories(userMessage)` auto-call | Wrong query; system guessing what's relevant | Delete. Claire uses `search_memory` when she needs it. |
| `getAllFacts()` dump (587 facts every turn) | Doesn't scale; dilutes context with noise | Delete. Claire uses `search_memory` when she needs it. |
| Prescriptive stale status script | Does Claire's thinking for her; causes redundant questions | Delete entirely. No replacement. Raw status.json + SOUL.md motivations. |
| `formatHistoryForPrompt()` | Formats messages as text in system prompt | Delete. Messages are in the API messages array now. |
| `summarizeCrossChannelActivity()` Haiku call | Extra API call every turn; usually returns nothing | Delete. All channels share one conversation now. |
| Stale-status-check function in `workspace.ts` | System-driven prescription | Delete. Claire notices gaps through her own reasoning. |

## What Stays the Same

- **Vector store write pipeline** — chunks still stored after each exchange
- **Fact extraction write pipeline** — Haiku still extracts facts from each exchange
- **Awareness context** (`awareness.ts`) — still used for heartbeat suppression decisions
- **Heartbeat system** — fires on schedule, decides whether to message
- **Self-awareness nightly pass** — unchanged
- **messages.json as log of record** — every message still written here for history and cross-channel reads
- **Workspace files as identity/notes layer** — SOUL.md, IDENTITY.md, etc.

## What Gets Built

| Component | Description |
|---|---|
| Messages array manager | Single in-memory `MessageParam[]` across all channels, with disk persistence, append, and reload |
| Compaction integration | Wire up `compact-2026-01-12` beta; read instructions from `workspace/COMPACTION.md` |
| Prompt caching | `cache_control: { type: "ephemeral" }` on system prompt blocks |
| System prompt builder | Build once, cache, rebuild on file change / time gap / restart. No prescriptive scripts. |
| `search_memory` tool | Wired to existing `retrieveMemories()` and `findSimilarFacts()`. Claire-invoked, not system-invoked. |
| `update_status` tool | Claire writes to status.json when Sergio reports status |
| Metacognitive prompt | Motivational landscape description (mind / notes / archive) |
| SOUL.md revision | Claire's commitment to Sergio's wellbeing as values, not instructions |
| Turn queue | Serialize all incoming messages across channels; concatenate rapid-fire messages |
| Thinking block stripping | Remove thinking blocks from messages array before disk persistence |

---

## Resolved Design Decisions

These were open questions in the previous draft. Resolved through design review.

### Conversation lifecycle: no resets

The messages array is never cleared. It grows, compacts, grows, compacts — indefinitely. Compaction creates natural memory decay that mirrors human episodic memory: recent turns are vivid, older turns are vague, ancient turns are impressions. There are no session boundaries and no staleness resets.

This is correct because the alternative — resetting after N hours of silence — loses conversational continuity across natural gaps (like sleep). "How'd I do on water yesterday?" at 7am should draw on receding vagueness from last night's conversation, not require a search.

### Heartbeats: separate decision, shared conversation

The heartbeat decision is a separate lightweight API call. The outgoing message enters the main conversation array. This avoids prompt-shape mismatch (heartbeat prompt ≠ conversation prompt) while maintaining conversational continuity.

### Unified conversation: one array across all channels

It's one Claire and one Sergio. A message from Telegram and a future message from SMS are both part of the same ongoing relationship. They belong in the same conversation stream. This eliminates the cross-channel awareness problem entirely — there's nothing to summarize from "other channels" because there are no other channels. There's just the conversation.

This also means compaction summaries carry the full picture. Claire's sense of "we talked about this yesterday" includes everything, regardless of which surface it came through.

### Compaction: narrative, not data

Compaction preserves conversational arc. Structured data belongs in notes (status.json). Don't ask compaction to be a database.

### Metacognition: motivations, not procedures

The metacognitive prompt describes the landscape and Claire's values. It does not prescribe a memory-lookup sequence. Claire's reasoning connects motivations to memory layers. A coach who cares will notice when something's unaddressed. A procedure-follower will execute a checklist whether it's needed or not.

### Extended thinking: strip before persistence

Thinking blocks don't survive to the next turn. Strip before writing to disk. Keeps persistence clean and avoids confusing compaction.

### Awareness context: kept for heartbeats, potentially redundant for conversation

With the full conversation in the messages array, Claire can see her own recent activity directly. The awareness block may be redundant for Telegram turns. However, it still serves heartbeat suppression logic. **Defer removal** — monitor whether it adds value in conversation turns post-deployment.

---

## Cost Estimate

Rough estimate for a typical day (50 Telegram exchanges):

| | Current | Proposed |
|---|---|---|
| System prompt per turn | ~16K tokens (8K files + 6K facts + 2K WARM) rebuilt each turn | ~8K tokens, cached after first turn |
| Messages per turn | ~50-100 tokens (1 user message) | ~200 tokens (turn 1) → ~15K tokens (turn 50), growing |
| Extra API calls per turn | Haiku cross-channel summary, vector search embedding | None |
| Compaction events per day | N/A | ~0-1 (at ~100K token threshold) |
| Compaction cost per event | N/A | ~$0.35 (100K input + 3K output at same model) |
| **Estimated daily cost** | **~$2.50** | **~$3.00-3.50** |

The cost increase is modest (~20-40%) because dropping the fact dump (6K tokens/turn), WARM auto-search, and Haiku calls offsets most of the growing messages array cost. Prompt caching makes the static system prompt nearly free after the first turn.

---

## Deferred Work

| Item | Reason | When |
|---|---|---|
| Metacognitive guardrail | Observe failures first, build if needed | After 1-2 weeks of production observation |
| Fact pruning | Fix UPDATE operation first; systematic pruning is maintenance, not architecture | Next sprint |
| Compaction quality testing | Monitor whether custom instructions preserve what matters | Ongoing after deployment |
| Awareness context removal | May be redundant for conversation turns; keep for heartbeats | After observation |
| Cost monitoring | Track actual token usage per turn, compaction frequency | Deploy alongside |

---

## References

- Anthropic Compaction docs: https://docs.anthropic.com/en/docs/build-with-claude/compaction
- Anthropic Prompt Caching docs: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- Existing architecture: `docs/architecture.md`
- Context assembly redesign notes: `docs/context-assembly-redesign.md`
- Observed failure modes: `research/1-observed-failure-modes.md`

---

_Design document — February 26, 2026. Ready for implementation handoff._
