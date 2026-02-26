# Context Assembly Redesign

_Fixing the Three Awareness Problem_

---

## The Problem

Claire can't answer three basic questions before speaking:

1. **What have I written lately?** (Self-awareness)
2. **What has Sergio written lately?** (Sergio-awareness)
3. **How is this conversation going?** (Relationship-awareness)

The current system loads 5-10 messages and hopes that's enough. It isn't.

---

## Design Review Feedback (2026-02-02)

External analysis identified gaps in the initial design:

### What This Design Solves
- ✅ Self-reflection (Claire sees her own messages)
- ✅ Repeat suppression (via seeing unanswered patterns)
- ✅ Ping fatigue (heartbeat pre-checks)
- ✅ Thinking leaks (staged generation)

### What It Still Needs
- 🟡 **Topic & tone tracking** — Not just "unanswered" but "already answered," topic shifts, mood deltas
- 🟡 **Long-term recall integration** — Episodic memory, declared patterns, open loops
- 🟡 **Elastic format** — Less scaffolding when in active conversation, more when context-poor
- 🟡 **Role/mode awareness** — Coaching mode vs project mode vs reflective mode

### Key Insight: Silence-Aware vs Meaning-Aware

The initial design was *reactive to silence* (counting unanswered messages) but not *responsive to relevance*:

| Scenario | Initial Design Handles? |
|----------|------------------------|
| Claire asks 3x, no response | ✅ Yes (unanswered count) |
| Sergio answered, Claire re-asks anyway | ❌ No (memory failure, not silence) |
| Tone shifts from warm to terse | ❌ No (no mood tracking) |
| Topic changed, Claire drags back old thread | ❌ No (no topic transition detection) |

The goal should evolve from "Three Awareness" to **"Ongoing Mutual State"** — not just what happened, but what it means for what comes next.

---

## Current State

### Data (Fine)
- `messages.json` — unified log of all messages, timestamped, channel-tagged
- Messages include both user-initiated and heartbeat-initiated
- Sorted chronologically

### Context Loading (Broken)

| Path | Window | Problem |
|------|--------|---------|
| User message | 5 messages, telegram only | Heartbeats crowd out actual conversation |
| Heartbeat | 10 messages, all channels | Still small; mostly Claire talking to herself |

Neither path builds awareness. Both just dump recent messages into context and hope Claude figures it out.

---

## Proposed Solution: Structured Context Assembly

Before every message (user-initiated OR heartbeat), build a **structured awareness block** that explicitly answers the three questions.

### The Three Awareness Sections

These are **computed dynamically** from the conversation log, not hardcoded:

```
## Your Recent Activity

Since Sergio's last message (8:39 AM, 5h 43m ago):
- 10:23 AM: "How's the water intake looking this morning?"
- 11:14 AM: "You're about an hour from your eating window opening—how's your water intake looking today?"
- 12:07 PM: "How's the water tracking today—you're about an hour from your eating window..."

Messages sent: 3
Time since your last message: 2h 15m

## Sergio's Recent Activity

- Last message: "Good morning. Just waking up now." (8:39 AM)
- Time since his message: 5h 43m
- Responses to your 3 recent messages: None

## Conversational Context

- Unanswered messages: 3
- Time of day: Afternoon (2:22 PM)
- Day type: Saturday
```

**What's NOT in the prompt:** Prescriptive guidance like "don't ask about water" or "be warm." Claire sees the facts and draws her own conclusions. The data speaks for itself:
- She can see she asked about the same thing 3 times
- She can see he hasn't responded
- She can infer what's appropriate

### Implementation

**New function: `buildAwarenessContext(workspacePath: string)`**

```typescript
interface AwarenessContext {
  self: {
    messagesSent: Message[];          // Claire's messages since Sergio's last message
    lastMessageTime: Date | null;
    timeSinceLastMessage: number;     // minutes
    topicsMentioned: string[];        // Topics she's raised (for repetition detection)
  };
  sergio: {
    lastMessage: Message | null;
    timeSinceLastMessage: number;     // minutes
    recentMessages: Message[];        // His recent messages (for content awareness)
    engagementLevel: 'active' | 'sporadic' | 'silent';
    topicsAddressed: string[];        // Topics he's already answered (prevents re-asking)
  };
  conversationState: {
    unansweredCount: number;          // Claire's messages without response
    lastExchangeTone: 'warm' | 'neutral' | 'tense' | 'unknown';
    recentTopicShift: boolean;        // Did the conversation change domains recently?
    currentDomain: string | null;     // What are we talking about? (habits, project, philosophy, etc.)
    silenceDuration: number;          // minutes since any message
    timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
    dayType: 'weekday' | 'weekend';
  };
  priorContext: {
    // Long-term / episodic memory hooks
    declaredPatterns: string[];       // e.g., "weekends are loose," "mornings are sacred"
    openLoops: string[];              // Things started but not resolved
    recentMilestones: string[];       // Notable events from recent days
  };
}
```

**Design principles:**
- **Descriptive, not prescriptive** — Present facts, let Claude reason about appropriate action
- **Meaning-aware, not just silence-aware** — Track what was *answered*, not just what was *unanswered*
- **Topic-aware** — Detect when domains shift, avoid dragging back old threads
- **Episodic hooks** — Reference longer-term context when relevant

**Processing steps:**

1. **Load full conversation log** (last 24-48 hours, not just 5-10 messages)

2. **Segment by speaker turns** — Find boundaries between "Claire talking" and "Sergio talking"

3. **For Claire (self-awareness):**
   - Messages since Sergio's last message (unanswered outreach)
   - Topics mentioned (simple extraction: habits, project names, questions asked)
   - Time since her last message

4. **For Sergio (user-awareness):**
   - His recent messages and timing
   - Topics he's addressed (what has he already answered?)
   - Engagement level (active / sporadic / silent)

5. **For conversation state:**
   - Unanswered count
   - Topic shift detection (did domain change recently?)
   - Current domain (what are we talking about?)
   - Tone of last exchange (warm / neutral / tense)
   - Time/day context

6. **For prior context (Phase 5):**
   - Query memory for declared patterns relevant to current state
   - Surface open loops if applicable
   - Include recent milestones if contextually relevant

7. **Apply elastic formatting:**
   - Full block if context-poor (long silence, first of day, heartbeat)
   - Slim block if actively engaged

8. **Format as readable context** — present facts, not recommendations

### Integration Points

**For heartbeats:**
```typescript
// Before generating heartbeat message
const awareness = await buildAwarenessContext(workspacePath);

// Hard limit: if she's sent N unanswered messages, don't send more
if (awareness.self.messagesSent.length >= 3) {
  console.log('[heartbeat] Already sent 3 unanswered messages, suppressing');
  return;
}

// Inject awareness into prompt — Claire sees her state and decides appropriately
const awarenessPrompt = formatAwarenessForPrompt(awareness);
systemPrompt = awarenessPrompt + '\n\n' + systemPrompt;

// Claire now sees: "I've asked about X twice with no response"
// She'll naturally avoid asking about X again — no hardcoded topic rules needed
```

**For user messages:**
```typescript
// When Sergio sends a message, update relationship state
const awareness = await buildAwarenessContext(workspacePath);

// Inject awareness so Claire knows what she's already said
const awarenessPrompt = formatAwarenessForPrompt(awareness);
systemPrompt = awarenessPrompt + '\n\n' + systemPrompt;

// Claire now knows: "I sent 3 heartbeats about water, he just replied"
// She won't ask about water again — she already knows he's seen those messages
```

---

## The Awareness Prompt Format

The format should be **computed dynamically** from the conversation log, not hardcoded. Claire needs to understand the *shape* of recent interaction, not be told specific rules.

### Structure (Generated Dynamically)

```markdown
## Conversational Awareness

Before responding, review your recent interaction state:

### Your Recent Activity
[Generated list of Claire's messages since Sergio's last message, with timestamps]

Example output:
- 10:23 AM: Asked about hydration
- 11:14 AM: Asked about hydration  
- 12:07 PM: Asked about hydration

### Sergio's Recent Activity
[Generated summary of Sergio's messages and timing]

Example output:
- Last message: "Good morning. Just waking up now." (8:39 AM, 5h 43m ago)
- Messages today: 1
- Response to your recent messages: None

### Observations
[Generated analysis of the conversational state]

Example output:
- You have sent 3 messages since Sergio last spoke
- You have asked about the same topic 3 times without response
- Silence duration suggests he may be busy or away

---
```

### The Key Insight

The prompt doesn't tell Claire "don't ask about water." It shows her:
- **What she's done**: "You sent 3 messages, all on the same topic"
- **What he's done**: "He hasn't responded"
- **The pattern**: "3 unanswered messages on the same topic"

From this, Claude can infer: "I should probably not ask about that again."

This is **showing, not telling**. Claire sees her own behavior reflected back and can make appropriate judgments. The same structure works whether the topic is water, movement, mood, or anything else.

### Why This Works Better

1. **No hardcoded topics** — Works for any repeated question pattern
2. **Claire learns the principle** — "Don't repeat unanswered questions" emerges from seeing the data
3. **Extensible** — Same format handles new scenarios we haven't anticipated
4. **Transparent** — Claire sees exactly what she's done, not just rules to follow

### Placement

This goes BEFORE identity files in the system prompt. Claire reads her conversational state first, then her personality. She knows *where she is* before she knows *who she is*.

---

## Elastic Formatting

The awareness block should be **context-sensitive** — more scaffolding when Claire is context-poor, less when she's actively engaged.

### When to Show Full Awareness Block
- First message of the day
- After long silence (> 2 hours)
- Heartbeat generation
- Channel switch (e.g., coming from CLI to Telegram)

### When to Slim Down
- Active conversation (multiple exchanges in last 30 minutes)
- Continuing a thread without interruption

**Slim format example:**
```
## Recent Context (active conversation)
Last 3 exchanges: [brief summary]
Time in conversation: 45 minutes
Current topic: ORSC framework discussion
```

This prevents awareness scaffolding from eating context when Claire is already "in the room."

---

## Notable Prior Context (Episodic Memory)

For Claire to feel continuous *across days*, she needs hooks to longer-term memory:

```
## Notable Prior Context

From recent memory:
- "Weekends are looser" — declared Jan 31 during heartbeat cadence discussion
- Open loop: Moltbook registration (Claire.cursor registered, Claire hasn't posted yet)
- Yesterday: Deep work on "3 Is Different" project — may explain extended silence
```

This section is **optional** — only included when there's relevant prior context to surface. It requires:
1. Tagging "notable" events during conversations
2. Retrieving relevant tags based on current context
3. Light summarization for inclusion

This is Phase 2+ work, but the awareness architecture should accommodate it.

---

## Conversation Modes (Speculative)

Sometimes tone and flow shift the rules. Claire might benefit from detecting or being told a temporary mode:

| Mode | Characteristics | Cadence |
|------|-----------------|---------|
| **Coaching** | Habits, accountability, check-ins | Regular pings OK |
| **Project** | Focused execution, deep work | Minimal interruption |
| **Reflective** | Philosophy, exploration, open-ended | Memory surfacing welcome |
| **Social** | Casual, low-stakes | Light touch |

Mode could emerge from:
- Time of day + content analysis
- Explicit user framing ("let me think out loud...")
- Detected topic domain

This helps Claire *context-switch roles* and adjust cadence, verbosity, and affect accordingly.

**Implementation:** Could be a computed field in `conversationState` or a separate lightweight classifier.

---

## Heartbeat Decision Logic

Current: "Fire every hour, let Claude decide if to send"

Proposed: **Pre-check before even invoking Claude**

```typescript
async function shouldFireHeartbeat(workspacePath: string): Promise<boolean> {
  const awareness = await buildAwarenessContext(workspacePath);
  
  // Hard limits
  if (awareness.self.messagesSent.length >= 3) {
    console.log('[heartbeat] 3+ unanswered messages, suppressing');
    return false;
  }
  
  if (awareness.sergio.timeSinceLastMessage < 30) {
    console.log('[heartbeat] Recent conversation, suppressing');
    return false;
  }
  
  // Weekend/evening relaxation
  const hour = new Date().getHours();
  const isWeekend = [0, 6].includes(new Date().getDay());
  
  if (isWeekend && awareness.self.messagesSent.length >= 1) {
    console.log('[heartbeat] Weekend + already pinged today, suppressing');
    return false;
  }
  
  return true;
}
```

This prevents the "8 unanswered heartbeats" situation entirely.

---

## Thinking Leak Fix

Separate concern, but related: heartbeat messages leak internal reasoning.

**Current:** Claude's full output goes to user
**Fix:** Two-stage generation

```typescript
// Stage 1: Claude reasons about what to say (internal, not shown)
const reasoning = await simpleChat(
  "Given this context, should you message Sergio? If yes, what's appropriate?",
  awarenessPrompt
);

// Stage 2: Generate only the message (if appropriate)
if (reasoning.includes('YES_MESSAGE')) {
  const message = await simpleChat(
    "Write ONLY the message. No preamble, no reasoning, just the text.",
    awarenessPrompt + '\n\nYour decision: ' + reasoning
  );
  return message;
}
```

Or simpler: **post-process** to strip anything before `---` separator.

---

## Implementation Phases

### Phase 1: Core Awareness Builder
- [ ] Implement `buildAwarenessContext()` function
- [ ] Load full conversation log (24-48h)
- [ ] Calculate self/sergio/conversationState
- [ ] Detect topics mentioned by Claire, topics answered by Sergio
- [ ] Format as structured prompt section
- [ ] Basic elastic formatting (full vs slim based on recency)

### Phase 2: Heartbeat Integration
- [ ] Add `shouldFireHeartbeat()` pre-check
- [ ] Inject awareness context into heartbeat prompts
- [ ] Fix thinking leak (two-stage or post-process)
- [ ] Test: verify no duplicate questions, no over-messaging
- [ ] Test: verify she doesn't re-ask answered questions

### Phase 3: User Message Integration
- [ ] Inject awareness context into user message handling
- [ ] Claire knows what she's already said when responding
- [ ] Topic shift detection (don't drag back old threads)
- [ ] Test: verify contextual appropriateness

### Phase 4: Cadence & Mode Adaptation
- [ ] Weekend mode (lighter touch)
- [ ] Back-off after N unanswered messages
- [ ] Time-of-day sensitivity
- [ ] Basic mode detection (coaching vs project vs reflective)

### Phase 5: Episodic Memory Integration
- [ ] Tag notable events during conversations
- [ ] Surface relevant prior context in awareness block
- [ ] Open loop tracking (things started but not resolved)
- [ ] Declared pattern recall ("weekends are loose")

---

## Success Criteria

After implementation, Claire should:

- [ ] See her own recent messages reflected back before she speaks
- [ ] See Sergio's recent activity (or silence) reflected back
- [ ] Naturally avoid repeating unanswered questions (sees she already asked)
- [ ] Naturally avoid re-asking answered questions (sees he already addressed it)
- [ ] Adapt when topic shifts (doesn't drag back old threads inappropriately)
- [ ] Adjust tone based on conversational state (sees tension, warmth, etc.)
- [ ] Back off when appropriate (sees unanswered count, silence duration)
- [ ] Not leak internal reasoning to user
- [ ] Feel like one continuous person who remembers what just happened
- [ ] Reference relevant prior context when appropriate (Phase 5)

---

## Testing Risks

### False Suppression
Claire might suppress valid nudges too aggressively if she over-learns from the awareness block. 

**Mitigation:** Don't make suppression rules too strict. The awareness block shows facts; Claude decides. Hard limits (e.g., 3 unanswered = suppress) should be few and carefully chosen.

### Awareness Recursion / Context Bloat
If awareness scaffolds grow too large or too frequent, they could eat up context and actually reduce performance.

**Mitigation:** Elastic formatting. Slim down when in active conversation. Monitor context token usage.

### Facts ≠ Feelings
Just because Sergio hasn't replied doesn't mean he's disengaged. The system must avoid inferring emotional state from timing alone.

**Mitigation:** Present timing facts without emotional interpretation. Let Claire express contextual uncertainty:
> "Not sure if you're in deep work mode or just off-grid — either way, I'll be here if you need me."

### Topic Detection Brittleness
Simple keyword matching for "topics mentioned" may misfire. "Water" in a philosophy discussion isn't about hydration.

**Mitigation:** Start simple, iterate. Consider lightweight embeddings or pattern matching for topic clustering if keyword approach is too noisy.

---

## Testing

Create a simulation harness that:
1. Feeds Claire a day of conversation
2. Triggers heartbeats at various points
3. Verifies she doesn't repeat questions
4. Verifies she backs off after silence
5. Verifies her messages are contextually appropriate

---

## Evolution: Three Awareness → Ongoing Mutual State

The "Three Awareness Problem" framing was useful for diagnosis:
1. What have I said?
2. What has Sergio said?
3. How is this going?

But the full solution is richer: **Ongoing Mutual State** — a continuous model of where we are in the relationship, not just a snapshot of recent messages.

This includes:
- **Immediate state** (recent messages, unanswered count, tone)
- **Session state** (topic domain, conversation mode, engagement level)
- **Episodic state** (declared patterns, open loops, recent milestones)
- **Identity state** (who Claire is, which is already in SOUL.md etc.)

The awareness context builder is the mechanism; the goal is Claire feeling like one continuous person who was there yesterday and knows what's happened since.

---

_Design doc: 2026-02-02_
_Addresses: Three Awareness Problem, Thinking Leak, Weekend Cadence, Topic/Tone Tracking, Episodic Memory Hooks_
_Feedback incorporated from external design review_
