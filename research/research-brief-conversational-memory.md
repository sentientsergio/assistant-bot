# Research Brief: Tiered Conversational Memory for AI Assistants

_A brief for deep research into memory architectures for persistent, multi-channel AI assistants._

---

## What We're Building

A personal AI assistant that maintains conversational continuity across:

- Multiple channels (Telegram, IDE, CLI)
- Extended time periods (hours to days)
- Without loading full conversation history into context

The assistant should feel like it "remembers" things said earlier—not through explicit user reminders, but through intelligent retrieval of relevant prior context.

---

## The Core Problem

**Token economics vs continuity trade-off:**

Large language models have finite context windows. A full day of conversation might be 50-100k tokens—expensive and often exceeding limits. But users expect continuity: "remember what I said this morning" should just work.

**Current naive approaches:**

1. **Sliding window**: Keep last N messages. Simple, but loses older context entirely.
2. **Summarization**: Compress old conversations. Lossy—details disappear.
3. **Full context**: Load everything. Expensive, hits limits.

**What we want:**
Semantic access to a day's worth of conversation without loading it all. The right prior context surfaces when relevant, stays hidden when not.

---

## Our Proposed Architecture

### Three-Tier Memory Model

```
HOT (Context Window)
  - Last 10-20 messages, full fidelity
  - Actually in LLM context
  - Immediate conversational continuity

WARM (Vector Short-Term Memory)
  - Recent conversations embedded in vector DB
  - Unified across all channels
  - RAG-retrieved based on semantic relevance
  - 3-7 day retention window

COLD (Archive)
  - Summarized, compressed
  - Long-term storage
  - Queried on demand, not automatically
```

### Key Design Decisions We're Wrestling With

**1. Relevance vs Recency**

Pure semantic similarity might surface old irrelevant messages. We're considering time-weighted scoring:

```
effective_score = semantic_similarity × time_decay(age)
```

But what's the right decay curve? Linear? Exponential? Step function?

**2. Embedding Granularity**

- Individual messages? (Short ones like "ok" embed poorly)
- Conversation turns (user + assistant)?
- Sliding windows with overlap?
- Skip trivial messages entirely?

**3. Retrieval Strategy**

- Fixed top-K vs dynamic threshold?
- How to present retrieved context? ("Earlier today: ..." feels awkward)
- Cross-channel attribution? ("On Telegram this morning: ...")

**4. Warm Window Sizing**

Not time-based (arbitrary) but constraint-based:

- Token budget for RAG results
- Embedding cost ceiling
- Relevance decay empirics

**5. Write Path Latency**

Embedding every message adds latency. Acceptable? Async? Batch?

---

## Research Questions

We'd like comprehensive research on:

### 1. Academic Literature

- Memory-augmented architectures for dialogue systems
- RAG specifically for conversational AI (not just document QA)
- Temporal modeling in retrieval—how do others handle recency vs relevance?
- Chunking strategies for dialogue (vs documents)

### 2. Industry Approaches

- How do products like Character.ai, Replika, Pi handle long-term memory?
- ChatGPT's memory feature—architecture speculation/teardowns
- Google's Bard/Gemini memory approaches
- Any open-source implementations (MemGPT, LangChain memory modules, etc.)

### 3. Embedding Strategies for Dialogue

- Best embedding models for conversational text (vs documents)
- Handling short utterances
- Contextual embeddings (embed with surrounding context?)
- Multi-turn vs single-turn embedding

### 4. Retrieval Tuning

- Time-weighted retrieval in vector DBs
- Hybrid retrieval (semantic + recency + other signals)
- Relevance feedback / adaptive retrieval
- How many retrieved chunks is optimal for dialogue?

### 5. Evaluation

- How do you measure conversational memory quality?
- User studies on perceived continuity
- Proxy metrics (retrieval precision? User satisfaction?)

### 6. Failure Modes & Edge Cases

- What goes wrong with naive RAG for conversation?
- Hallucinated memories / false attribution
- Privacy implications of long-term memory
- Graceful degradation when retrieval fails

---

## Constraints & Context

- **Platform**: TypeScript/Node.js gateway, Anthropic Claude API
- **Channels**: Telegram (primary), IDE integration, CLI
- **Scale**: Personal assistant (1 user), not enterprise
- **Budget-conscious**: Prefer cost-effective solutions (Haiku over Sonnet, efficient embeddings)
- **Local-first option**: Interested in local vector DBs (LanceDB, SQLite-vec) and potentially local embeddings

---

## Desired Output

A comprehensive research report covering:

1. **Literature review**: What's been published on conversational memory, dialogue RAG, temporal retrieval?

2. **Industry survey**: How do existing products solve this? What can we learn?

3. **Technical recommendations**:
   - Embedding model choice
   - Vector DB choice
   - Chunking strategy
   - Retrieval algorithm (including time-weighting)
   - Suggested architecture refinements

4. **Open problems**: What's still unsolved? Where might we contribute?

5. **Implementation roadmap**: Phased approach based on research findings

---

## Why This Matters

Most AI assistants are stateless or have primitive memory (last N messages). Building a system with genuine conversational continuity—where context from hours ago surfaces naturally—would be a meaningful step toward assistants that feel like they actually know you.

We're not trying to solve AGI memory. We're trying to make a personal assistant that doesn't forget what you said this morning.

---

_Prepared for deep research review. Go deep. Come back with citations._
