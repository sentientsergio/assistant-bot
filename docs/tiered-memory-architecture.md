# Tiered Memory Architecture

_Design doc for persistent conversational memory across channels._

_v3 — Fractal continuity model: COLD is compressed WARM, not separate archive. Daily digests are observability, not memory._

---

## Problem

Token economics make it impractical to keep a full day's conversation in context. But continuity matters—references to things said hours ago, across different channels, should be retrievable without explicit user effort.

**Current state:**

- Conversation history loaded into context (last N messages per channel)
- Cross-channel summaries generated at context load
- Daily memory files written manually during maintenance

**Limitations:**

- Fixed context window means older messages disappear
- Cross-channel awareness is summary-only (lossy)
- No semantic retrieval—can't find "that thing we discussed this morning"

---

## Research Validation

Two independent research surveys (academic literature + industry teardowns) converged on key findings:

1. **Hierarchical memory is the consensus pattern** — MemGPT, MMAG, Convai, Pi, and Mem0 all use tiered approaches. Our HOT/WARM/COLD model aligns with state of the art.

2. **Segment-level chunking outperforms alternatives** — 3-5 turn segments beat single-turn (too noisy) and session-level (too coarse). SeCom (ICLR 2025) provides definitive evidence.

3. **Time-weighted retrieval is essential** — Pure semantic similarity surfaces stale content. Stanford Generative Agents, MemoryBank, and LangChain all use exponential decay.

4. **ChatGPT doesn't use RAG** — It extracts and injects curated facts directly. This reveals a fundamental design choice: algorithmic curation (RAG) vs inferential curation (fact extraction).

5. **Local-first is viable** — nomic-embed-text-v1.5 with LanceDB matches or exceeds commercial API performance at zero marginal cost.

---

## The Curation Question

Two fundamentally different approaches to memory:

### Algorithmic Curation (RAG)

```
Conversation → Embed chunks → Vector store
                                    ↓
Query → Similarity search → Retrieve top-K → Inject into context
```

- Curation happens at **retrieval time**
- Cheap to write, quality depends on retrieval
- Risk: noisy, irrelevant memories surface

### Inferential Curation (Fact Extraction)

```
Conversation → LLM extracts facts → Compare to existing → ADD/UPDATE/DELETE
                                                              ↓
Query → Structured lookup + semantic search → Inject curated facts
```

- Curation happens at **write time**
- Expensive to write, cleaner retrieval
- Mem0 achieves 26% higher accuracy than OpenAI memory with this approach

### Our Approach: Hybrid

The research hedges; we'll build incrementally and measure:

| Phase   | Approach            | Purpose                                 |
| ------- | ------------------- | --------------------------------------- |
| Phase 1 | Vector RAG          | Baseline, validates infrastructure      |
| Phase 2 | Add fact extraction | Structured facts for stable preferences |
| Phase 3 | Measure             | Is LLM cost worth the quality gain?     |

---

## Architecture

### Core Principle: Fractal Continuity

The memory system provides continuity that's **self-similar at every time scale**. The model doesn't distinguish "I remember from 5 minutes ago" vs "I remember from 5 weeks ago" - it's all context surfaced by relevance.

| Tier | Resolution    | Time Scale | Query Mechanism |
| ---- | ------------- | ---------- | --------------- |
| HOT  | Full fidelity | Minutes    | In context      |
| WARM | Chunk-level   | Days       | Vector search   |
| COLD | Summary-level | Weeks+     | Vector search   |

**Key insight**: COLD is not a different kind of memory. It's the same pattern at lower resolution. When WARM exceeds capacity, chunks get compressed into summaries, embedded, and remain searchable. The fractal holds.

### Two Orthogonal Dimensions

**Temporal tiers** (when was it stored):

- HOT: Immediate context, always loaded
- WARM: Recent, chunk-level, vector-searchable
- COLD: Older, summary-level, also vector-searchable

**Storage modalities** (how is it stored):

- Vector: Semantic similarity search
- Key-Value: Structured facts (`user.preferences.food = "sushi"`)
- Graph: Relationships (YAGNI for single-user, noted for future)

These are orthogonal. Both WARM and COLD tiers are vector-searchable; COLD just has coarser resolution.

---

## Tier Design

### HOT: Context Window

**What**: Last 5 messages, full fidelity, from unified conversation log  
**Storage**: `conversations/messages.json` (unified across messaging channels)  
**Cross-channel**: All messaging channels write to same log, naturally mixed by timestamp

```typescript
interface Message {
  channel: string;        // "telegram", "web", "sms" (messaging plane only)
  role: "user" | "assistant";
  content: string;
  timestamp: string;      // ISO format
}

interface ConversationLog {
  messages: Message[];
  lastActivity: string;
}
```

**Two-Plane Architecture**:
- **Messaging Plane** (Telegram, web, SMS): Writes to conversation log
- **Development Plane** (Cursor): Does NOT write to conversation log

**Implementation**: Unified `messages.json` with channel tags. Load last N messages for HOT context. Older messages remain in log (up to 100) for cross-channel awareness before being WARM-only.

---

### WARM: Semantic Memory

**What**: Vector-embedded conversation segments + structured facts  
**Retention**: 3-7 days (constraint-based, not arbitrary)  
**Storage**: LanceDB (single `.lance` file)

#### Vector Store (Conversation Chunks)

```typescript
interface WarmChunk {
  id: string;
  embedding: Float32Array; // nomic-embed-text-v1.5, 384 dims
  content: string; // 3-5 turn segment with speaker labels
  channel: string;
  createdAt: Date;
  lastAccessedAt: Date; // For time decay
  turnCount: number;
}
```

**Chunking strategy**:

- 3-5 conversational turns per chunk
- 1-turn overlap between chunks
- Include speaker labels and timestamps in content
- Skip trivial messages ("ok", "thanks") or merge with adjacent

**Retrieval**:

```typescript
function computeScore(semanticSim: number, chunk: WarmChunk): number {
  const hoursSinceAccess = (Date.now() - chunk.lastAccessedAt) / 3600000;
  const recency = Math.pow(0.99, hoursSinceAccess); // ~1 week half-life
  return semanticSim * 0.7 + recency * 0.3;
}
```

- Hybrid: 0.7 semantic + 0.3 recency
- Top-K: 3-5 chunks
- Threshold: 0.65 minimum similarity
- Update `lastAccessedAt` on retrieval (reinforcement)

#### Fact Store (Structured Knowledge)

```typescript
interface Fact {
  id: string;
  category: "preference" | "fact" | "event" | "relationship";
  key: string; // e.g., "food_preference"
  value: string; // e.g., "likes sushi, vegetarian-friendly"
  confidence: number;
  sourceChunkIds: string[]; // Provenance
  createdAt: Date;
  lastValidatedAt: Date;
}
```

**Extraction** (Phase 2):

- After each exchange, Haiku extracts candidate facts
- Compare to existing facts: ADD / UPDATE / DELETE / NOOP
- Store with provenance for auditability

---

### COLD: Compressed Memory

**What**: Summarized chunks from WARM that exceeded capacity  
**Storage**: LanceDB (same store, different granularity flag)  
**Retrieval**: Automatic, searched alongside WARM

COLD is **not** a separate archive you manually dig through. It's WARM at lower resolution—still vector-searchable, still participates in every query.

```typescript
interface ColdSummary {
  id: string;
  embedding: Float32Array; // Embedded summary
  summary: string; // LLM-compressed from multiple chunks
  sourceChunkIds: string[]; // What was compressed
  dateRange: { start: string; end: string };
  channels: string[];
  keyTopics: string[]; // Extracted for filtering
}
```

**Compression trigger**: When WARM exceeds capacity (e.g., >7 days or >N chunks), oldest chunks get:

1. Summarized by LLM (compress multiple chunks into one summary)
2. Key topics extracted
3. Summary embedded and stored in COLD
4. Original detailed chunks deleted from WARM

**Query behavior**: Every query searches both WARM and COLD. Relevance scoring surfaces what matters regardless of tier. User asks about "finances" → hits recent WARM chunks AND older COLD summaries if relevant.

---

## Observability Layer (Not Memory)

Separate from the memory system, we generate human-readable outputs for monitoring and debugging.

### Daily Digests

**What**: Curated summary of what was _memorable_ today  
**Storage**: Markdown files (`memory/YYYY-MM-DD.md`)  
**Purpose**: Human monitoring, debugging, transparency  
**Retention**: Disposable after review (not part of memory system)

```markdown
# Daily Digest: 2026-01-29

## Key Topics

- Extended thinking implementation with show/hide toggle
- Morning heartbeat warmth (cross-channel awareness)
- Tiered memory architecture redesign

## Decisions Made

- COLD is fractal compression, not separate archive
- Daily digests are observability, not memory

## Notable Context

- Weight: 321.5 (down 6.2) — IF working
- John Polito meeting at 5:00 PM
```

**NOT a transcript**. "Ok" and "thanks" are not memorable. Only significant topics, decisions, and context make the digest.

The digest is generated during maintenance from WARM content, but it's a _view_ into memory, not memory itself.

---

## Sizing Model

WARM size is **constraint-based**, not time-based:

```
WARM_SIZE = f(token_budget, relevance_decay, cost_ceiling)
```

### Token Budget

- Allocate ~1500 tokens for RAG context in each response
- Average retrieved chunk: ~200 tokens
- Top-K = 5-7 chunks max

### Relevance Decay

```
time_weight(age_hours) =
  age < 2:   1.0    # Very recent
  age < 8:   0.8    # Same session
  age < 24:  0.5    # Same day
  age < 72:  0.3    # Recent days
  else:      0.1    # Older
```

### Adaptive Retention

- Don't delete based solely on age
- Track retrieval frequency per chunk
- Chunks that keep getting accessed = valuable, retain longer
- Chunks never retrieved after 7 days = archive

---

## Technical Stack

| Component           | Choice                     | Rationale                                      |
| ------------------- | -------------------------- | ---------------------------------------------- |
| **Embedding**       | OpenAI text-embedding-3-small | Practical, ~free at scale, no local setup   |
| **Vector DB**       | LanceDB                    | TypeScript native, file-based, hybrid search   |
| **Dimensions**      | 1536                       | OpenAI default dimensions                      |
| **Hybrid search**   | LanceDB FTS + vector       | Combined semantic + keyword matching           |
| **Fact extraction** | Claude Haiku (future)      | Cost-effective, good at structured output      |
| **Conversation log**| JSON (messages.json)       | Simple, unified across messaging channels      |

**Alternative embedding**: nomic-embed-text-v1.5 via Ollama (local, free) - can switch if cost becomes concern.

**Explicitly NOT recommended**: all-MiniLM-L6-v2 (56% Top-5 accuracy in benchmarks)

---

## Context Assembly

```
┌────────────────────────────────────────────────┐
│ System Prompt                                  │
├────────────────────────────────────────────────┤
│ Identity files (SOUL, IDENTITY, USER, etc.)   │
│ Structured facts from WARM.facts              │
├────────────────────────────────────────────────┤
│ "Earlier context:" (RAG results)              │
│ [Retrieved from WARM + COLD, by relevance]    │
├────────────────────────────────────────────────┤
│ HOT context (last 15-20 messages)             │
├────────────────────────────────────────────────┤
│ Current user message                          │
└────────────────────────────────────────────────┘
```

RAG retrieval searches both WARM (detailed chunks) and COLD (compressed summaries) in a single query. Results are ranked by combined relevance score regardless of tier origin.

---

## Write Path

```
User message received
    │
    ├─► Add to HOT context
    │
    ├─► Embed message (batched or async)
    │
    ├─► Store in WARM vector store
    │
    └─► [Phase 2] Extract facts → compare → ADD/UPDATE/DELETE
```

**Latency consideration**: Embedding adds 50-100ms. Acceptable for Telegram; consider async for real-time channels.

---

## Read Path

```
Before responding:
    │
    ├─► Load HOT context
    │
    ├─► Load structured facts from WARM.facts
    │
    ├─► RAG query WARM + COLD (unified search)
    │   • Query: current message + recent context
    │   • Search: both WARM chunks and COLD summaries
    │   • Score: semantic similarity × time decay × tier weight
    │   • Retrieve: top-K by combined score
    │   • Filter: exclude content already in HOT
    │   • Update: lastAccessedAt for retrieved items
    │
    └─► Assemble context, call Claude
```

The query doesn't distinguish tiers. WARM chunks and COLD summaries compete on relevance. Recent detailed content naturally scores higher; older summarized content surfaces when highly relevant.

---

## Failure Modes & Mitigations

| Failure               | Impact                   | Mitigation                                                  |
| --------------------- | ------------------------ | ----------------------------------------------------------- |
| Embedding API down    | Can't write new memories | Local embedding (nomic via ollama) as fallback              |
| Vector search timeout | Slow response            | 250ms timeout, fall back to HOT-only                        |
| Hallucinated memories | False information        | Ground in explicit retrieved content, confidence thresholds |
| Over-retrieval        | Noise drowns signal      | Aggressive similarity threshold (0.65), MMR diversity       |
| Temporal blindness    | "Last week" queries fail | Extract time references, filter by timestamp ranges         |

**Graceful degradation chain**:

```
Vector search (primary)
    ↓ timeout/error
Lexical search (BM25 fallback)
    ↓ failure
HOT context only
    ↓ if empty
"I don't have memory of that—could you remind me?"
```

---

## Implementation Phases

### Phase 1: Foundation (Vector RAG) ✅

- [x] Set up LanceDB (using OpenAI text-embedding-3-small instead of nomic)
- [x] Implement chunking (user-assistant pairs per exchange)
- [x] Basic semantic retrieval with time-weighting
- [x] Integrate into Telegram channel context assembly
- [x] Test: Phone number stored, cleared from HOT, retrieved from vector ✓

**Validation**: System remembers information purely from vector retrieval (2026-01-29)

**Implementation notes**:
- Using OpenAI embeddings (practical, ~free at our scale) vs nomic (requires Ollama)
- Simple 2-turn chunking per exchange (can expand to 3-5 turn windows later)
- Migration script ready: `gateway/scripts/migrate-markdown-to-vector.ts`

### Phase 2: Retrieval Optimization ✅

- [x] Implement hybrid search (semantic + FTS via LanceDB)
- [x] Basic time-weighted scoring (recency weight in retrieval)
- [x] Unified conversation log (messages.json for all messaging channels)
- [x] Implement lastAccessedAt tracking (touchChunks)
- [x] Add adaptive top-K based on score distribution

**Validation**: Hybrid search working (2026-01-29). Phone number retrieved via keyword + semantic match.

**Implementation notes (2026-01-29)**:
- touchChunks uses LanceDB update() to refresh lastAccessedAt on retrieved chunks
- adaptiveTopK analyzes score gaps: cuts off when score drops >0.15 between results
- MIN_TOP_K=2, MAX_TOP_K=10, DEFAULT_TOP_K=5

### Phase 3: Fact Extraction (Inferential Curation)

- [ ] Haiku-based fact extraction after each exchange
- [ ] Fact comparison logic (ADD/UPDATE/DELETE/NOOP)
- [ ] Structured fact store alongside vectors
- [ ] Measure: quality improvement vs cost

**Validation**: Stable facts persist cleanly; contradictions resolved

### Phase 4: Compression & Lifecycle

- [ ] Compression job: summarize WARM chunks exceeding capacity
- [ ] Embed summaries into COLD (same LanceDB, different granularity)
- [ ] Unified query across WARM + COLD
- [ ] Daily digest generation (observability, not memory)
- [ ] Memory management (view, edit, delete)
- [ ] Privacy controls (disable, export)

**Validation**: Old topics still retrievable at summary level; digests useful for monitoring

### Phase 5: Evaluation

- [ ] Build test scenarios (info given, changed, referenced later)
- [ ] Measure retrieval precision, hallucination rate, user correction rate
- [ ] Tune parameters based on empirical results
- [ ] A/B test RAG-only vs RAG+facts

**Validation**: Quantified quality metrics; informed parameter choices

---

## Open Questions

1. **Fact extraction ROI**: Is Haiku cost per exchange worth the quality gain? Need Phase 3 data.

2. **Cross-channel presentation**: When RAG surfaces Telegram content in Cursor, how to present? "Earlier on Telegram: ..." or seamless?

3. **Graph store**: Relationships matter for some use cases. YAGNI now, but worth revisiting if assistant manages contacts/projects.

4. **Proactive memory**: Could surface relevant memories without being asked. Useful or creepy?

5. **Temporal query parsing**: "What did we talk about last week?" requires extracting time reference and filtering. Worth building explicitly?

---

## Success Criteria

- [ ] Can reference something said 6+ hours ago without it being in HOT
- [ ] Can reference something said 3+ weeks ago via COLD summaries
- [ ] Cross-channel continuity: Telegram informs Cursor, and vice versa
- [ ] Token usage stays bounded regardless of conversation length
- [ ] Retrieval feels natural, not jarring or over-eager
- [ ] User can say "forget that" and it's forgotten
- [ ] System degrades gracefully when components fail
- [ ] Daily digests are useful for monitoring (not empty, not noisy)

---

## References

- MemGPT (Packer et al., 2023) — OS-style virtual memory for LLMs
- SeCom (Pan et al., ICLR 2025) — Segment-level chunking
- MemoryBank (Zhong et al., 2023) — Ebbinghaus forgetting curve
- Stanford Generative Agents (Park et al., 2023) — Recency + importance + relevance scoring
- Mem0 — Triple-store architecture, fact extraction pipeline
- LongMemEval (ICLR 2025) — Evaluation benchmark for long-term memory
- RAGate (Wang et al., NAACL 2025) — Gating mechanism for retrieval decisions

---

_This architecture provides semantic access to a day's context without burning tokens on full history. The phased approach lets us validate each component and make informed decisions about the curation strategy._
