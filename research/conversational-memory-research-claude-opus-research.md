# Tiered conversational memory architectures for AI assistants

Your proposed HOT/WARM/COLD architecture aligns remarkably well with current academic research and production implementations. The key insight from this survey: **segment-level chunking with time-weighted hybrid retrieval significantly outperforms naive turn-by-turn RAG**, and local-first implementations using nomic-embed-text-v1.5 with LanceDB can match or exceed commercial API performance at zero marginal cost.

The most impactful finding across both academic literature and industry teardowns is that **ChatGPT's memory system does not use traditional RAG at all**—it injects curated facts directly into context, demonstrating that simple architectures often outperform complex retrieval systems for personal assistants. However, for cross-channel continuity and extended time periods, a hybrid approach combining direct context injection (HOT tier) with semantic retrieval (WARM tier) and compressed archival (COLD tier) provides the best balance of accuracy, latency, and cost.

---

## Academic foundations reveal critical design principles

### Memory-augmented architectures have converged on hierarchical designs

The most influential recent work is **MemGPT** (Packer et al., October 2023), which treats LLM context like operating system virtual memory with explicit tiers: Core Memory (always in-context facts), Recall Memory (searchable conversation history), and Archival Memory (long-term vector storage). The key innovation is allowing the LLM to act as its own memory manager through function calls, deciding autonomously what to store, summarize, and retrieve. This achieves **93.4% accuracy** on the Deep Memory Retrieval benchmark.

**LongMem** (Wang et al., NeurIPS 2023) introduced a critical insight: separating the memory encoder from the retriever/reader prevents "memory staleness" where cached representations drift as models update. Their decoupled architecture handles **65k+ tokens** and outperforms GPT-3 (313x larger) on the ChapterBreak benchmark.

For temporal modeling, **MemoryBank** (Zhong et al., May 2023) applies the Ebbinghaus Forgetting Curve to memory salience, using the formula:

```
score(m,q) = sim(ϕ(m),ϕ(q)) × w_time(m) - γ × conflict(m)
```

This approach combines semantic similarity with exponential time decay and a conflict penalty for contradictory information—directly applicable to your proposed architecture.

### RAG for dialogue differs fundamentally from document QA

Recent work distinguishes conversational RAG from standard document retrieval. **RAGate** (Wang et al., July 2024) introduces a binary knowledge gate predicting when a conversational turn actually requires RAG augmentation—not every message needs retrieval, and unnecessary augmentation degrades quality. **Self-RAG** (Asai et al., 2023) extends this by having the LLM generate "reflection" tokens that trigger on-demand retrieval, achieving higher factual accuracy than ChatGPT with RAG-augmented Llama-2.

The temporal dimension presents unique challenges. **TSM: Temporal Semantic Memory** (January 2026) addresses the critical distinction between _dialogue time_ (when a turn occurred) and _event time_ (when the discussed event happened). Most systems incorrectly treat dialogue timeline as the primary temporal signal, leading to retrieval errors for queries like "what did we discuss about my trip to Tokyo?"

### Segment-level chunking outperforms turn-level and session-level approaches

**SeCom** (Pan et al., ICLR 2025, Microsoft Research) provides definitive evidence on chunking strategy. Their findings: turn-level memory is too fine-grained (fragmentary), session-level is too coarse (includes irrelevant content), and summarization loses critical information. **Segment-level memory**—partitioning dialogues into topically coherent segments—outperforms all alternatives on the LoCoMo and Long-MT-Bench+ benchmarks.

**MemGAS** (Xu et al., May 2025) extends this with multi-granularity memory units (turn, session, summary, keyword-level) and an entropy-based router that learns optimal granularity for each query type. Their key finding: temporal reasoning queries favor session-level chunks, knowledge updates favor turn-level, and preference queries favor summary-level. This suggests your WARM tier should store multiple granularities with dynamic selection.

---

## Industry implementations reveal practical architecture patterns

### ChatGPT's surprisingly simple 4-layer memory architecture

Reverse engineering reveals ChatGPT's memory system uses **four layers without traditional RAG**:

1. **Session Metadata** — Ephemeral environment data (location, device)
2. **Saved Memories (Bio Tool)** — Explicit facts with timestamps: `[2025-05-02]. The user likes ice cream`
3. **Conversation Summaries** — Lightweight digests (user messages only, not assistant replies)
4. **Current Session Window** — Sliding window trimmed when space runs low

Memories are stored in simple timestamped format and injected directly into the prompt context on every message. Memory detection uses pattern matching ("Remember that...") plus classification models. This approach is remarkably effective for high-level preferences, though it struggles with verbatim templates and takes days for deleted memories to stop being referenced.

### Claude's file-based hierarchical memory

Anthropic's recently launched memory system (September 2025) uses **Markdown files (CLAUDE.md)** rather than vector databases. The hierarchy spans four levels: Enterprise Memory → Project Memory → User Memory → Session Memory. Files are loaded directly into context at session start, with import syntax (`@path/to/import`) for modular organization. This contextual retrieval approach—loading entire curated memory documents rather than RAG chunks—prevents the fragmentation issues that plague chunk-based systems.

### Open-source implementations provide production-ready patterns

**Mem0** achieves the strongest benchmark performance with a triple-store architecture: Vector Store (semantic similarity), Graph Store (relationships), and Key-Value Store (structured facts). Their two-phase pipeline extracts candidate memories from the latest exchange plus rolling summary, then compares new facts to existing entries and chooses operations (ADD, UPDATE, DELETE, NOOP). Results: **26% higher accuracy** than OpenAI memory, **91% lower p95 latency**, and **90% fewer tokens**.

**LlamaIndex's Memory class** provides a clean TypeScript-compatible pattern: short-term FIFO queue within token limit, long-term extraction via Memory Blocks (`FactExtractionMemoryBlock`, `VectorMemoryBlock`). Configuration includes `token_limit` (default 30,000), `chat_history_token_ratio` (default 0.7), and `token_flush_size` (default 3,000)—parameters directly applicable to your implementation.

| System       | Memory Approach                | Cross-Session              | Retrieval Method                |
| ------------ | ------------------------------ | -------------------------- | ------------------------------- |
| ChatGPT      | 4-layer, direct injection      | Yes, explicit facts        | No RAG, pattern matching        |
| Claude       | Markdown files, hierarchical   | Yes, file-based            | Contextual retrieval            |
| MemGPT       | OS-style virtual memory        | Yes, archival storage      | Semantic search + LLM routing   |
| Mem0         | Triple store (vector+graph+KV) | Yes, persistent            | Hybrid with conflict resolution |
| Character.ai | Summarization + rolling window | Limited (~15-20 exchanges) | Context window only             |

---

## Embedding strategy: local models match API performance

### Model selection for conversational text

Benchmarking reveals **E5-small achieves 100% Top-5 accuracy** in retrieval while processing in 16ms—outperforming models 70x larger. Critically, **all-MiniLM-L6-v2** (the most downloaded model on HuggingFace) scored only 56% Top-5 accuracy and is **not recommended** for production RAG.

| Model                         | Dimensions | Short Text Performance     | Local | Recommendation           |
| ----------------------------- | ---------- | -------------------------- | ----- | ------------------------ |
| **nomic-embed-text-v1.5**     | 768 (→64)  | Excellent                  | Yes   | **Best balanced choice** |
| **E5-small**                  | 384        | Excellent (100% Top-5)     | Yes   | Best speed               |
| **E5-base**                   | 768        | Excellent                  | Yes   | Great accuracy/speed     |
| **BGE-M3**                    | 1024       | Strong (multi-granularity) | Yes   | Best for hybrid search   |
| OpenAI text-embedding-3-small | 1536       | Good                       | No    | Decent API option        |
| all-MiniLM-L6-v2              | 384        | Moderate (56%)             | Yes   | **Not recommended**      |

**Primary recommendation: nomic-embed-text-v1.5** — Apache 2.0 license, 8192 context length (handles multi-turn chunks without truncation), outperforms OpenAI ada-002 and text-embedding-3-small on MTEB, full local inference via GPT4All, Matryoshka support (768→64 dimensions for storage efficiency), and built-in task prefixes (`search_document`, `search_query`).

### Handling short utterances requires context augmentation

Messages like "ok," "sure," and "thanks" carry minimal semantic content in isolation. The research supports three approaches:

**Context augmentation (recommended)**: Embed with 1-3 preceding turns:

```
Instead of: "ok"
Embed: "[10:30] User: Can you help with travel plans? [10:31] Assistant: Happy to help! [10:32] User: ok"
```

**Elementary Discourse Units (EDUs)**: Transform conversations into self-contained statements:

```
Raw: "User: Tokyo. Assistant: Great choice! User: thanks"
EDU: "User expressed interest in Tokyo as travel destination and acknowledged positively."
```

**Importance filtering**: Don't embed standalone acknowledgments. Only embed turns containing named entities, specific information (dates, numbers, preferences), questions, or meaningful responses.

### Chunking strategy: 3-5 turns with overlap

Research consistently shows multi-turn chunking (3-5 turns) outperforms single-turn embedding. Recommended approach:

- **Minimum chunk size**: 3 conversational turns (provides context)
- **Maximum chunk size**: ~500 tokens (balances precision vs. recall)
- **Overlap**: 1-2 turns between chunks (maintains continuity)
- **Boundaries**: Natural topic shifts, explicit topic changes, or time gaps (>1 hour)

---

## Retrieval tuning: time-weighted hybrid scoring

### Time decay formulas that work

LangChain's `TimeWeightedVectorStoreRetriever` uses an additive formula:

```
score = semantic_similarity + (1.0 - decay_rate)^hours_passed
```

Critical insight: `hours_passed` refers to **last accessed time**, not creation time. Frequently accessed memories remain fresh.

| Decay Rate | Half-life | Use Case                        |
| ---------- | --------- | ------------------------------- |
| 0.01       | ~1 week   | General conversational memory   |
| 0.1        | ~7 hours  | Rapid session context           |
| 0.001      | ~1 month  | Long-term facts and preferences |

For more structured recency, time bucket weights work well:

- Last hour: 1.0
- Last 24 hours: 0.9
- Last 7 days: 0.75
- Last 30 days: 0.5
- Older: 0.3

### Hybrid scoring combines multiple signals

The recommended approach uses weighted combination:

```typescript
function computeMemoryScore(semanticSim: number, memory: Memory): number {
  // Time decay
  const hoursSinceAccess = (Date.now() - memory.lastAccessedAt) / 3600000;
  const recency = Math.pow(1.0 - 0.01, hoursSinceAccess);

  // Importance boost (user-marked or high-signal content)
  const importance = memory.importanceScore * 0.2;

  // Access reinforcement (frequently retrieved = more relevant)
  const reinforcement = Math.min(memory.accessCount * 0.02, 0.1);

  // Channel weight (direct conversation > async channels)
  const channelWeight =
    { telegram: 1.0, ide: 0.9, cli: 0.9 }[memory.channel] ?? 0.8;

  return semanticSim * channelWeight + recency + importance + reinforcement;
}
```

### Vector database recommendation: LanceDB for local-first

For your constraints (TypeScript/Node.js, single user, local-first, budget-conscious), **LanceDB** offers the best fit:

| Database    | Hybrid Search      | Local | TypeScript | Filtering | Verdict                |
| ----------- | ------------------ | ----- | ---------- | --------- | ---------------------- |
| **LanceDB** | Full-text + vector | Yes   | Native     | SQL-like  | **Recommended**        |
| Qdrant      | Sparse + dense     | Yes   | Good       | Advanced  | Strong alternative     |
| Chroma      | Basic              | Yes   | Good       | Limited   | Prototyping only       |
| pgvector    | With extensions    | Yes   | Via pg     | Full SQL  | PostgreSQL familiarity |
| SQLite-vec  | Limited            | Yes   | Native     | Basic     | Simplest option        |

LanceDB advantages: zero-copy reads, SQL-like filtering, native TypeScript SDK, supports hybrid search with BM25, efficient datetime range queries, and single-file storage perfect for personal assistants.

### Optimal retrieval parameters

- **Top-K**: 3-5 chunks for conversational context (more adds noise)
- **Similarity threshold**: 0.65-0.70 (filter low-quality matches)
- **MMR lambda**: 0.7 (favor relevance with moderate diversity)
- **Hybrid alpha**: 0.7 semantic + 0.3 keyword

Implement adaptive retrieval: if the top result scores >0.85, return only top 1-2; if scores are clustered between 0.70-0.80, return full top-5.

---

## Evaluation methods and failure modes

### How to measure memory quality

The **LongMemEval benchmark** (ICLR 2025) evaluates five core abilities:

1. **Information Extraction** — Recall specific details
2. **Multi-Session Reasoning** — Synthesize across conversations
3. **Knowledge Updates** — Recognize changed information
4. **Temporal Reasoning** — Awareness of time mentions
5. **Abstention** — Refrain from inventing unknown information

For ongoing measurement, track:

- **Retrieval precision@5** — Are the retrieved chunks actually relevant?
- **Memory utilization rate** — How often does retrieved context appear in responses?
- **User correction rate** — How often do users say "no, I meant..." or correct memory errors?
- **Hallucination rate** — Responses containing fabricated memory references

### Critical failure modes to prevent

**Hallucinated memories** are the most dangerous failure. The Air Canada chatbot invented a bereavement refund policy that the airline was legally required to honor. Mitigation: always ground responses in explicit retrieved context, add "if uncertain, say so" instructions, and implement confidence thresholds.

**Context confusion** occurs when memories from different conversations, users, or time periods get mixed. Mitigation: strict metadata filtering (user_id, session_id) before semantic search, never cross-pollinate contexts.

**Over-retrieval** drowns accuracy in noise. When too much context is retrieved, models struggle to identify relevant portions. Mitigation: aggressive similarity thresholds, MMR for diversity, and dynamic top-K based on score distribution.

**Temporal blindness** happens when naive similarity search fails for time-referenced queries like "what did we talk about last week?" Mitigation: extract temporal references from queries before retrieval, filter by timestamp ranges, store dialogue_time and event_time separately.

### Graceful degradation patterns

Implement multi-layer fallback:

```
Vector search (primary, 250ms timeout)
    ↓ (timeout/error)
Lexical search (BM25 fallback)
    ↓ (failure)
Recent context only (last 10 messages)
    ↓ (if no recent context)
Acknowledge uncertainty ("I don't have memory of that, could you remind me?")
```

---

## Refined architecture with implementation specifics

Based on this research, here's your refined three-tier architecture:

### HOT tier: Immediate context window

**What**: Last 10-20 messages, full fidelity, unified across channels
**Storage**: In-memory (Node.js Map or simple array)
**Format**: `[{channel: "telegram", timestamp: Date, speaker: "user"|"assistant", content: string}]`
**Cross-channel**: Merge by timestamp when user switches channels
**Implementation**: Simple FIFO queue, prepend to every Claude API call

### WARM tier: Semantic retrieval layer

**What**: Vector-embedded conversations from last 7 days
**Storage**: LanceDB (single .lance file)
**Embedding**: nomic-embed-text-v1.5 at 384 dimensions (Matryoshka reduction)
**Chunking**: 3-5 turn segments with 1-turn overlap, speaker labels, timestamps
**Retrieval**: Hybrid (0.7 semantic + 0.3 BM25) with time decay (0.01 rate)
**Retrieved**: Top 3-5 chunks based on combined score

```typescript
interface WarmMemoryChunk {
  id: string;
  embedding: Float32Array;
  content: string; // Multi-turn formatted text
  channel: "telegram" | "ide" | "cli";
  userId: string;
  createdAt: Date;
  lastAccessedAt: Date;
  turnCount: number;
  topicHint?: string; // Optional LLM-extracted topic
}
```

### COLD tier: Compressed archive

**What**: Summarized facts, preferences, long-term knowledge
**Storage**: JSON file or SQLite (structured) + optional LanceDB (semantic search)
**Format**: Elementary Discourse Units + extracted facts
**Compression**: LLM summarization when WARM chunks age past 7 days
**Retrieval**: On-demand when WARM retrieval returns low-confidence results

```typescript
interface ColdMemoryFact {
  id: string;
  fact: string; // "User prefers vegetarian restaurants"
  category: "preference" | "fact" | "event" | "relationship";
  confidence: number;
  sourceChunkIds: string[]; // Provenance
  createdAt: Date;
  lastValidatedAt: Date;
}
```

### Cross-channel unification

Store all conversations with channel metadata, retrieve without channel filtering (unless user specifies). The time-weighted scoring naturally prioritizes recent interactions regardless of channel. Implement deduplication via content hashing to avoid storing identical messages that might arrive through multiple channels.

---

## Open problems and contribution opportunities

### Temporal reasoning remains unsolved

Current systems achieve only **27% of human performance** on temporal reasoning tasks (LoCoMo benchmark). The distinction between dialogue_time and event_time is poorly handled. Contribution opportunity: build a temporal query parser that extracts time references and translates them to retrieval filters.

### Memory conflict resolution lacks standards

When a user says "I now prefer coffee" after previously storing "user prefers tea," most systems either keep both (causing confusion) or naively overwrite (losing context). Contribution opportunity: implement Mem0-style explicit conflict resolution with LLM-driven merge decisions.

### Proactive memory curation is missing

All surveyed systems passively accumulate memories. None proactively identify outdated information, contradictions, or gaps. Contribution opportunity: background consolidation process that periodically reviews WARM tier, merges related chunks, and surfaces potential inconsistencies for user verification.

### Evaluation for single-user personal assistants is underexplored

Benchmarks like LongMemEval and LoCoMo focus on multi-user or simulated scenarios. Real-world single-user evaluation requires different metrics: personal preference accuracy, subjective continuity satisfaction, correction rate over time. Contribution opportunity: develop a personal assistant memory benchmark with real longitudinal data.

---

## Phased implementation roadmap

### Phase 1: Foundation (Week 1-2)

**Goal**: Working HOT + basic WARM tier

1. Implement HOT tier as FIFO queue with channel unification
2. Set up LanceDB with nomic-embed-text-v1.5 (local inference)
3. Implement basic turn-by-turn embedding (not optimal, but simple)
4. Build simple semantic retrieval without time-weighting
5. Integrate with Claude API: HOT context + WARM retrieved chunks

**Validation**: System remembers information from previous sessions

### Phase 2: Retrieval optimization (Week 3-4)

**Goal**: Time-weighted hybrid retrieval

1. Implement 3-5 turn chunking with overlap
2. Add time decay scoring (last_accessed_at tracking)
3. Implement hybrid search (semantic + BM25)
4. Add metadata filtering (channel, timestamp ranges)
5. Implement adaptive top-K based on score distribution

**Validation**: Recent conversations rank higher; temporal queries work

### Phase 3: COLD tier and compression (Week 5-6)

**Goal**: Long-term fact storage

1. Implement fact extraction (LLM-based EDU conversion)
2. Build COLD storage (JSON or SQLite)
3. Implement WARM→COLD migration (age-based trigger)
4. Add COLD retrieval fallback when WARM confidence is low
5. Implement memory consolidation (merge related facts)

**Validation**: Facts persist beyond 7-day WARM window

### Phase 4: Robustness and UX (Week 7-8)

**Goal**: Production-ready system

1. Add graceful degradation (fallback chain)
2. Implement memory management UI (view, edit, delete)
3. Add conflict detection and resolution
4. Implement privacy controls (disable memory, export/import)
5. Add observability (retrieval metrics, fallback tracking)

**Validation**: System handles failures gracefully; user can manage memories

### Phase 5: Advanced features (Ongoing)

- Multi-hop retrieval for complex queries
- Proactive memory curation
- Temporal query parsing
- Cross-channel deduplication
- A/B testing framework for retrieval parameters

---

## Technical stack summary

| Component                | Recommendation                   | Alternative            |
| ------------------------ | -------------------------------- | ---------------------- |
| **Embedding model**      | nomic-embed-text-v1.5 (local)    | E5-small (faster)      |
| **Vector database**      | LanceDB                          | Qdrant (more features) |
| **Embedding dimensions** | 384 (Matryoshka)                 | 768 (full quality)     |
| **Chunking**             | 3-5 turns, 1-turn overlap        | Semantic segmentation  |
| **Retrieval**            | Hybrid (0.7 semantic + 0.3 BM25) | Pure semantic          |
| **Time decay**           | Exponential, rate=0.01           | Time buckets           |
| **Top-K**                | 3-5 with 0.65 threshold          | Adaptive-K             |
| **COLD storage**         | SQLite + JSON                    | LanceDB (unified)      |
| **LLM for extraction**   | Claude Haiku                     | Local Llama            |

This architecture provides excellent memory continuity across channels while remaining cost-effective (zero embedding costs, efficient Haiku usage for extraction) and privacy-preserving (all data stays local). The phased approach lets you validate each component before adding complexity.
