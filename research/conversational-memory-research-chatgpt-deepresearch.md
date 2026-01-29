# Tiered Conversational Memory for AI Assistants

## Introduction

Maintaining conversational continuity over long interactions and across
multiple channels is a major challenge for AI assistants. Humans
naturally recall past discussions, personal details, and context from
earlier in the day, but large language models (LLMs) have a finite
context window. A full day's chat logs (potentially 50k+ tokens) far
exceed typical LLM context limits, and naively feeding all history into
each prompt is both expensive and often impossible. Yet users expect the
assistant to "remember what I said this morning" without needing to
repeat it. This creates a **token economics vs. continuity** trade-off:
how do we give the assistant a persistent memory of prior conversations
without constantly loading huge transcripts into the prompt?

Current simple approaches each fall short. A sliding context window of
the last N messages retains only recent exchanges, so anything said more
than a few turns ago is forgotten. Summarizing older messages can keep a
gist of past topics, but it's lossy -- key details can disappear. Using
the full conversation history preserves fidelity but quickly hits token
limits and cost constraints. We need a smarter memory system that
semantically **retrieves only the relevant pieces** of past
conversations on demand. The goal is for the assistant to feel like it
has a long-term memory -- *surfacing the right past details at the right
time* -- without permanently keeping everything in context.

**Our proposed solution:** a **three-tier memory architecture** (Hot,
Warm, Cold) for a multi-channel personal assistant. The *Hot* memory is
the immediate context window (e.g. the last 10--20 messages) included
fully in the LLM prompt for continuity. The *Warm* memory is a
vector-database of recent conversation snippets (from all channels) that
can be retrieved by semantic similarity (Retrieval-Augmented Generation,
RAG) to bring up relevant older context (on the order of
days)[\[1\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Patterns%20such%20as%20Mixed%20Memory,structure%20memory%20hierarchically%20with)[\[2\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=integrating%20non,continual%20learning%2C%20and%20personalized%20interactions).
The *Cold* memory is an archive of older interactions, stored in
compressed form (summaries or distilled facts) for long-term reference
if needed. This brief will delve into research and industry insights
relevant to designing such a system, and provide recommendations on
embedding strategies, retrieval algorithms (e.g. balancing recency vs
relevance), and practical considerations like latency and evaluation.
The aim is an assistant that "actually remembers" past interactions in a
natural way, within budget and technical constraints.

## Literature Review: Memory-Augmented Dialogue Systems

**Memory architectures for LLMs:** Researchers have been actively
exploring how to augment LLMs with external memory to go beyond the
fixed context
window[\[3\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Memory,continual%20learning%2C%20and%20personalized%20interactions).
A key trend is treating memory as a structured, multi-component system
rather than a flat
buffer[\[4\]](https://arxiv.org/html/2512.01710v1#:~:text=Recent%20work%20has%20begun%20to,richer%20and%20more%20adaptive%20interactions)[\[5\]](https://arxiv.org/html/2512.01710v1#:~:text=LLMs%20beyond%20short,episodic%20recall%2C%20and%20contextual%20awareness).
For example, *MemGPT* proposes an OS-like scheduling of contexts into
long-term and working memory to keep relevant information accessible
without bloating the
prompt[\[6\]](https://arxiv.org/html/2512.01710v1#:~:text=MemGPT%20,isn%E2%80%99t%20just%20about%20scaling%20up).
*Retentive Networks* introduce architectural changes to transformers to
improve long-range retention
natively[\[6\]](https://arxiv.org/html/2512.01710v1#:~:text=MemGPT%20,isn%E2%80%99t%20just%20about%20scaling%20up).
In general, these works show that simply increasing context size is not
the only solution -- organizing and retrieving memories intelligently is
equally
important[\[7\]](https://arxiv.org/html/2512.01710v1#:~:text=information%20across%20conversations%20without%20bloating,memory%20is%20organized%20and%20accessed).

One comprehensive framework, **Mixed Memory-Augmented Generation
(MMAG)**, draws inspiration from human
cognition[\[8\]](https://arxiv.org/html/2512.01710v1#:~:text=across%20extended%20interactions,its%20implementation%20in%20the%20Heero)[\[9\]](https://arxiv.org/html/2512.01710v1#:~:text=To%20address%20this%20need%2C%20we,environmental%20context%20without%20overwhelming%20users).
MMAG proposes multiple memory types or "layers" working in concert:
**conversational memory** (recent dialogue context), **long-term user
memory** (facts about the user), **episodic/event memory** (logs of
specific events or sessions), **contextual/sensory memory** (environment
or time-based context), and **short-term working memory** (a scratchpad
for immediate
reasoning)[\[1\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Patterns%20such%20as%20Mixed%20Memory,structure%20memory%20hierarchically%20with)[\[10\]](https://arxiv.org/html/2512.01710v1#:~:text=Memory%20Type%20Cognitive%20Psychology%20Analogy,Memory%20Sensory%20integration%2C%20situational%20awareness).
This mirrors psychological distinctions between short-term recall,
semantic memory, episodic recall, etc. The system implemented in the
*Heero* agent showed that even partially adopting this layered memory
(e.g. keeping conversation history + a long-term user "bio") improved
user engagement and session
length[\[11\]](https://arxiv.org/html/2512.01710v1#:~:text=We%20focused%20on%20perceived%20helpfulness%2C,more%20engaging%20and%20sustained%20without)[\[12\]](https://arxiv.org/html/2512.01710v1#:~:text=conversations%20in%20Heero%2C%20we%20observed,sustained%20without%20reducing%20user%20comfort).
The lesson is that **hierarchical memory design** can yield more
coherent and personalized interactions than a one-size-fits-all context
dump.

**Retrieval-Augmented Generation for conversations:** Retrieval-based
memory is a natural fit for dialogues. Instead of storing full chats,
the idea is to index chunks of past dialogues in a vector store and pull
them in as needed based on similarity to the current
query[\[2\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=integrating%20non,continual%20learning%2C%20and%20personalized%20interactions)[\[13\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=,manages%20insertion%20of%20new%20vectors).
This approach is common in open-domain QA and knowledge-base chat, but
for *conversational* memory the content is prior user-assistant
exchanges rather than encyclopedic facts. Academic studies have looked
at using RAG for dialogue: for instance, Li et al. (2022) and others
retrieved wiki or knowledge snippets to ground task-oriented
dialogues[\[14\]](https://aclanthology.org/2025.findings-naacl.30.pdf#:~:text=Knowledge%20Retrieval%3A%20Several%20studies%20have,relevant%20knowl%02edge%20but%20first%20transformed),
and more recent work focuses on retrieving **prior conversation turns**
to maintain consistency. An important observation is that not every turn
requires retrieval -- injecting irrelevant "memories" can derail the
conversation[\[15\]](https://aclanthology.org/2025.findings-naacl.30.pdf#:~:text=and%20Gabriel%2C%202023%3B%20Miehling%20et,In%20contrast%2C%20without)[\[16\]](https://aclanthology.org/2025.findings-naacl.30.pdf#:~:text=stage%20of%20a%20conversation,propose%20a%20binary%20knowledge%20gate).
A 2025 study (Wang et al., NAACL Findings) introduced *RAGate*, a gating
mechanism that uses a classifier/LLM to decide if a given user query
actually needs external knowledge or memory
retrieval[\[17\]](https://aclanthology.org/2025.findings-naacl.30.pdf#:~:text=retrieval,de%02velop%20RAGate%20by%20exploring%20the)[\[18\]](https://aclanthology.org/2025.findings-naacl.30.pdf#:~:text=conversation%20turns%2C%20producing%20high,In%20addition).
This prevents unnecessary augmentation on trivial turns, reducing the
risk of awkward or overly specific responses. For our design, a
light-weight gating heuristic could be employed -- e.g. if the user's
message is a simple greeting or a completely new topic, perhaps skip
vector retrieval; whereas if it references earlier events ("Can you
recall what I told you about X?") then trigger memory recall.

**Temporal retrieval & recency vs relevance:** A core research question
is how to balance semantic similarity with recency when retrieving past
dialogue. Pure similarity can surface very old but topically similar
snippets that might no longer be relevant to the current context (e.g.
an identical joke told weeks ago). On the other hand, a pure recency
bias would just retrieve the most recent entries, which duplicates the
sliding window approach. The literature suggests combining multiple
signals. In the Stanford **Generative Agents** project (Park et al.,
2023), which gave AI agents long-term memory, the retrieval score was a
linear combination of relevance, recency, and
importance[\[19\]](https://www.lukew.com/ff/entry.asp?2030#:~:text=situation%20as%20input%20and%20returns,level).
Specifically, they compute a composite score:

$$\text{score}(i) = \alpha_{\text{recency}} \cdot \text{Recency}(i) + \alpha_{\text{importance}} \cdot \text{Importance}(i) + \alpha_{\text{relevance}} \cdot \text{SemanticSimilarity}(i)$$

with tunable
weights[\[20\]](https://www.emergentmind.com/topics/generative-agents#:~:text=observations%2C%20plans%2C%20reflections%2C%20and%20high,recursively%20abstracts%20over%20reflections%20for)[\[21\]](https://www.emergentmind.com/topics/generative-agents#:~:text=,over%20reflections%20for%20hierarchical%20reasoning).
In their implementation, **recency was modeled as an exponential decay**
over time since the memory was last accessed, with a decay factor around
0.99 per
hour[\[22\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=,99).
This means a memory from this morning (few hours ago) still has \~95% of
its recency weight, whereas one from days ago decays substantially -- an
intuitive forgetting curve. They also had the LLM assign an **importance
score** (1--10) to each memory based on how "poignant" or significant it
was[\[23\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=,fill%20in%3E%E2%80%9D).
This helped key memories stick around longer (analogous to human memory
prioritizing emotional or notable events). Only memories that scored
high on the combined metric were retrieved for use in the agent's
prompt[\[19\]](https://www.lukew.com/ff/entry.asp?2030#:~:text=situation%20as%20input%20and%20returns,level).

Another relevant work, **MemoryBank** (Zhong et al. 2023), explicitly
incorporates the psychological *Ebbinghaus Forgetting Curve* for
time-based decay of stored
memories[\[24\]](https://arxiv.org/abs/2305.10250#:~:text=memories%2C%20continually%20evolve%20through%20continuous,based%20chatbot%20named)[\[25\]](https://arxiv.org/abs/2305.10250#:~:text=To%20mimic%20anthropomorphic%20behaviors%20and,displays%20heightened%20empathy%20in%20its).
The system continuously "updates" memory strengths over time,
reinforcing those that get revisited and letting others weaken -- a form
of scheduled forgetting and consolidation. In short, academia suggests
**an exponential time decay** (recency) is effective, especially if
combined with occasional reinforcement when a memory is reused. A linear
decay or hard cut-off might be too blunt, whereas an exponential decay
naturally tapers off older items unless they prove relevant again.

**Chunking and embedding dialogue history:** How we segment
conversations for storage can dramatically impact retrieval quality.
Research on long-term chat benchmarks (*LongMemEval 2025*) indicates
that indexing at the granularity of dialogue *turns* (or even individual
facts) yields better retrieval than indexing whole
sessions[\[26\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=LongMemEval%20formalizes%20a%20modular%20architecture,memory%2C%20partitioned%20into%20three%20stages)[\[27\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=,5).
If you store entire long sessions as one chunk, the vector similarity
may need to match on a lot of unrelated text. Finer granularity (per
exchange) improves the chance that a specific past detail can be
retrieved
accurately[\[27\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=,5).
However, extremely fine granularity (e.g. every single utterance
including "OK" or "thanks") can introduce noise -- very short utterances
have embeddings that are not very informative. Academic approaches often
encode a **dialogue turn as a pair: (user query + assistant response)**
as one memory
vector[\[13\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=,manages%20insertion%20of%20new%20vectors)[\[28\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Each%20memory%20slot%20stores%20a,27%20Mar%202025).
This provides some surrounding context for each piece in the vector
store. trivial messages (acknowledgements, "yes/no") are either skipped
or merged with adjacent content to give them context. For example, a
system might ignore messages below a certain length or importance
threshold, or tag them with low importance so they are rarely retrieved.
**Skipping trivial utterances** is suggested in practice because a
standalone "Okay." or laughter emoji, when embedded, can fetch spurious
results -- it's better to let those fall out of memory unless
specifically relevant.

Several research prototypes have also experimented with **sliding window
chunking with overlap** -- e.g. embedding every N messages as a chunk to
capture context transitions -- but in dialogue settings this can lead to
a lot of redundancy. The consensus leans towards semantically meaningful
chunks: each representing a self-contained conversational exchange or a
salient event. Indeed, LongMemEval found that extracting structured
*facts* from dialogues and indexing those as keys improved retrieval of
specific information by
\~5%[\[27\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=,5).
As a design consideration, we might extract key factual assertions or
user preferences from the conversation (via an LLM) and store them as
meta-data to aid search. But initially, keeping things simple with
turn-level chunks is a good start.

**Summary of academic insights:** To support long-term conversational
memory, an agent should combine multiple memory stores and retrieval
cues. The system can treat recent conversation as a *short-term working
memory* directly in context, while relying on a *semantic vector memory*
for the mid-term and an *episodic archive* for older
interactions[\[1\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Patterns%20such%20as%20Mixed%20Memory,structure%20memory%20hierarchically%20with)[\[29\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=%2A%20Sensory%2Fcontext%20memory%20%28real,step%20reasoning).
Retrieval algorithms should account for **temporal recency** (using a
decay or time-weight) so that recent relevant content is
preferred[\[22\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=,99).
Important personal facts or memorable events may be given higher weight
or even stored in a structured form for quick access. By chunking the
dialogue history into meaningful pieces (e.g. one Q&A turn each) and
embedding those, we can achieve high recall of needed information
without dragging in entire transcripts. The memory-augmented LLM
literature consistently reports improved coherence and personalization
when using such techniques. For example, adding a vector-memory module
to a baseline chat model significantly boosted dialogue consistency
scores on benchmarks like Persona-Chat and
DailyDialog[\[30\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=coherence%2C%20task%20accuracy%2C%20and%20user,engagement)[\[31\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=,27%20Wang).
This gives us confidence that implementing a tiered memory will
measurably improve our assistant's continuity.

## Industry Approaches to Long-Term Conversational Memory

Beyond the research papers, it's illuminating to see how existing
conversational AI products handle memory (to whatever extent they do):

-   **Character.ai and similar chatbots:** Many current chat services
    (character simulators, role-play bots, etc.) rely primarily on the
    model's context window, often with some heuristic pruning. For
    instance, Character.AI reportedly uses roughly a 3000-token context
    window[\[32\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=Resume%20for%20the%20people%20that,didn%27t%20understand%20it).
    It will include as much recent dialogue as fits in \~3k tokens; once
    that limit is hit, older messages drop off. Users of these platforms
    notice the bots "forgetting" details relatively quickly, and even
    looping or repeating themselves as older context falls
    out[\[33\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=Forward)[\[34\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=messages%20are%20pushed%20out%20of,about%20refers%20to%20two%20things).
    There is little evidence of sophisticated long-term storage in these
    systems yet -- the emphasis has been on making the context window
    larger (some newer models advertise 16k, 32k, even 100k context
    lengths). Indeed, one commenter noted how a character bot lost track
    of a detail after \~2800 tokens of conversation and started
    hallucinating, confirming the \~3k limit and the "sliding window"
    memory loss beyond
    that[\[35\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=I%20then%20proceeded%20to%20have,the%20start%20of%20the%20conversation)[\[36\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=I%20asked%20the%20AI%20at,roughly%202800%20or%203000%20tokens).
    The takeaway is that *context window alone* is insufficient for
    sustained memory; these bots would benefit from an external memory
    to retain key facts beyond the hard limit.

-   **Replika and companion bots:** Replika (an AI friend app)
    historically maintained a profile of the user -- things like the
    user's name, favorite color, relationship status, etc. -- in a
    database separate from the conversation. This is essentially a
    **long-term user memory** store (semantic facts about the user) that
    the bot can pull from to personalize responses. However, day-to-day
    conversational memory in Replika has been limited; earlier versions
    used GPT-3 with a sliding window of recent messages and some
    heuristic prompts. Recent updates likely incorporate summarization
    of past chats to simulate continuity. The key point is that industry
    systems often maintain a *user profile vector* or knowledge graph
    for stable facts, while using text summarization for past dialogues.
    This aligns with our tiered approach: persistent facts in cold
    memory, recent dialogues in warm memory.

-   **Inflection Pi (personal AI by Inflection AI):** Pi is explicitly
    marketed as a personal companion that remembers you over time. Users
    have observed that Pi can recall details from much earlier
    conversations, indicating it uses a long-term memory mechanism. In
    an Inflection AI discussion, the Pi assistant described *its own
    memory system*: it said it uses *"episodic memory to retrieve
    information from my long-term memory... allowing access to
    information from any point in time"* and that it also maintains *"a
    short-term memory buffer of about 10 minutes of conversation"* for
    immediate
    context[\[37\]](https://news.ycombinator.com/item?id=35798744#:~:text=On%20memory%20Wow%3A%20,term).
    Essentially, Pi admitted it keeps the last \~10 minutes in active
    working memory and relies on an episodic memory system for anything
    older, which is exactly the kind of two-tier approach we're
    considering (hot context + long-term store). This suggests Pi likely
    indexes past conversations (perhaps by vector embeddings or some
    database keyed by time/topic) and pulls relevant old info when
    needed. Pi's ability to retrieve facts from "any point in time"
    (assuming the user talked about it before) is a strong validation of
    using semantic search over an extended dialogue history. It's likely
    Inflection engineered Pi's retrieval with careful controls to avoid
    non-sequiturs -- e.g. time-based filters or only bringing in memory
    when clearly relevant to the user's prompt.

-   **OpenAI ChatGPT & Anthropic Claude:** Until recently, ChatGPT had
    no persistent memory across sessions -- each conversation was
    independent. OpenAI has since added **Custom Instructions** (a place
    where users can put persistent info about themselves), which acts as
    a kind of long-term user memory (the model will always see those
    instructions). They also introduced retrieval plugins and an
    enterprise "ChatGPT with your data" feature, which essentially bolt
    on a vector database for company documents. However, for general
    conversational continuity, ChatGPT still relies on its context
    window (which for GPT-4 can be up to 128k tokens in specialized
    versions). That large context can fit a long conversation from
    earlier in the day, but it's not cost-effective to always stuff it
    with old content. We can infer that OpenAI is exploring memory
    options -- for example, their 2023 developer demo hinted at an
    "Analysis" mode where the assistant could summarize and recall notes
    from previous uploads. Anthropic's Claude has offered 100k-token
    context versions, again focusing on *extending context* rather than
    sophisticated retrieval. In short, the big LLM providers have mostly
    tackled continuity by brute-force context length increases and
    allowing user-provided background info. Our approach aims to be
    *more efficient*, leveraging retrieval so we only pay for what's
    relevant.

-   **Google Bard / Gemini:** As of early 2024, Google's Bard did not
    persist conversational history beyond a single session (each new
    chat was stateless). However, there is speculation that Google's
    upcoming Gemini model might incorporate longer-term memory or at
    least greatly extended context. They have the advantage of
    integrating with Google's knowledge graph and user data (for
    instance, the new Google Assistant with Bard can access your
    calendar, email, etc., effectively giving it a fact bank about the
    user's life). It's possible they will implement a form of long-term
    memory by storing dialogue context in the user's account and
    retrieving it when a new session starts ("Last time we talked you
    were preparing for a trip. How did it go?"). But details are scant;
    likely they are prototyping RAG approaches internally. We can glean
    ideas from their research -- e.g. Google researchers published
    "Memory-Driven Dialogue" concepts where the assistant pulls in
    records of past interactions.

-   **Emerging platforms (Convai, etc.):** The Convai platform (for AI
    NPCs/characters) recently introduced a **Long Term Memory (LTM)**
    feature[\[38\]](https://convai.com/blog/long-term-memeory#:~:text=A%20key%20aspect%20of%20building,their%20own%20personalities%20over%20time).
    Their approach is a hybrid of vector RAG and custom ranking: they
    store interactions in a *memory tree* per user (to isolate memories
    by user for privacy) and retrieve across three tiers -- "recent,
    long-term, and latent" memories -- which are then ranked by
    relevance, recency and *emotional
    significance*[\[39\]](https://convai.com/blog/long-term-memeory#:~:text=request%20,in%20a%20more%20personalized%20manner)[\[40\]](https://convai.com/blog/long-term-memeory#:~:text=the%20factors%20that%20make%20a,different%20from%20just%20information%20are).
    Notably, Convai highlights *recency bias* ("newer interactions
    remembered more vividly") and *emotional impact* as key factors in
    their memory
    system[\[40\]](https://convai.com/blog/long-term-memeory#:~:text=the%20factors%20that%20make%20a,different%20from%20just%20information%20are)[\[41\]](https://convai.com/blog/long-term-memeory#:~:text=,influencing%20the%20character%27s%20personality%20development).
    After retrieval, selected memories are injected into the prompt
    (prefaced by a system message indicating these are prior
    interactions) to personalize the
    response[\[42\]](https://convai.com/blog/long-term-memeory#:~:text=the%20RAG%20processor%20accesses%20the,in%20a%20more%20personalized%20manner)[\[43\]](https://convai.com/blog/long-term-memeory#:~:text=on%20their%20relevance.%20,in%20a%20more%20personalized%20manner).
    This is very aligned with our warm/cold approach -- effectively
    Convai has a short-term memory, a long-term vector memory, and even
    a notion of latent "learned behaviors" from repeated
    interactions[\[44\]](https://convai.com/blog/long-term-memeory#:~:text=prioritized%2C%20influencing%20the%20character%27s%20personality,development).
    They also address **privacy** by using a memory tree keyed by
    speaker/user ID so that one character won't accidentally share info
    from another user's
    session[\[45\]](https://convai.com/blog/long-term-memeory#:~:text=To%20safeguard%20user%20privacy%20while,controls%20to%20their%20end%20users).
    For us, with a single user assistant, privacy control is more about
    the user being able to delete or export their conversation memory,
    but if we ever expanded to multiple users, segregating memory per
    user is essential.

-   **Open-source tools:** Developers building memory into LLM apps
    often use libraries like **LangChain**, which provides memory
    modules. For example, LangChain's `ConversationBufferMemory` just
    keeps a running log (sliding window), `ConversationSummaryMemory`
    periodically summarizes old messages, and
    `VectorStoreRetrieverMemory` uses a vector DB to fetch relevant past
    messages. These are building blocks that mirror our tiers: one could
    combine a short buffer + a summarizer + a vector store in
    LangChain's framework. There are also community projects like
    *MemoGPT* (noted in research) and *MemoRAG*. MemoRAG (2024) is an
    open-source project that pairs a "super-long memory model" with RAG,
    aiming to handle millions of tokens via a memory
    mechanism[\[46\]](https://github.com/qhjqhj00/MemoRAG#:~:text=MemoRAG%20is%20an%20innovative%20RAG,is%20accepted%20by%20theWebConf%202025).
    While cutting-edge, MemoRAG requires specialized model training. We
    can take inspiration without that level of complexity: our assistant
    can remain using Claude via API, and implement memory on the
    application side (storing and retrieving text to include in
    prompts). In general, the industry trend is moving toward
    **hierarchical memory architectures** -- whether proprietary (as Pi
    and Convai have done) or via frameworks -- as opposed to hoping an
    LLM will magically not forget after 100 turns.

**Key takeaways from industry:** The most advanced systems (Inflection's
Pi, Convai) validate the need for a multi-tier memory: a short-term
buffer for immediate coherence and a longer-term semantic store for true
recall of earlier conversations. They incorporate *recency bias and
importance weighting* in retrieval, confirming that a pure similarity
search is not
enough[\[40\]](https://convai.com/blog/long-term-memeory#:~:text=the%20factors%20that%20make%20a,different%20from%20just%20information%20are)[\[41\]](https://convai.com/blog/long-term-memeory#:~:text=,influencing%20the%20character%27s%20personality%20development).
They also emphasize user privacy and controllability (e.g. memory tied
to user identity, and the ability to clear
it)[\[45\]](https://convai.com/blog/long-term-memeory#:~:text=To%20safeguard%20user%20privacy%20while,controls%20to%20their%20end%20users).
Meanwhile, mainstream chatbots show the limitations of no memory
(forgetful behavior, repeated questions, user
frustration)[\[47\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=window)[\[48\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=With%20such%20a%20tiny%20context,already%20rock%20bottom%29%20expectations).
This all strengthens the case for our tiered memory model. Our assistant
could even outperform current big-name bots in continuity, by combining
these state-of-the-art ideas in a lean personal system.

## Embedding Strategies for Dialogue Memory

At the heart of our warm memory tier is a vector database of embedded
conversation snippets. Designing how to produce and use those embeddings
is critical for good recall and minimal noise.

**Choosing embedding model:** The embedding model should capture
semantic meaning of conversational text. Many implementations use
general-purpose models like OpenAI's `text-embedding-ada-002` (which is
1536-dimensional and trained on a broad corpus). Ada is a strong choice
for English dialogue; it can capture paraphrases and context fairly
well, and it's relatively cheap. However, for a local/offline solution,
there are open-source sentence embedding models (Sentence-BERT
derivatives, etc.). Research indicates that **higher-capacity embedding
models yield better recall** -- one survey found that upgrading from a
smaller model to a larger one improved retrieval precision and dialogue
coherence
notably[\[49\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Ablations%20show%20that%3A)[\[50\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=,recall%20access%20%28%2018).
For example, using an instructor-large model vs. a tiny MiniLM might
boost the chance of finding the right memory when needed. Since cost is
a concern, a compromise might be using a moderate-sized model like
`all-MiniLM-L12` (384-dim) or `E5-base` (768-dim) which can run on CPU
reasonably fast, or using OpenAI's API which at \$0.0004 / 1K tokens is
still quite affordable for personal use (embedding an entire day's convo
might cost only pennies). We should also consider domain: conversational
text has lots of first-person, informality, and context dependence, so
an embedding model tuned for dialogue or Q&A may outperform one tuned
for long documents. If available, a model like Cohere's embeddings or
Llama-2's embedding (if fine-tuned for chat) could be tested. In
summary, **use the best embedding model you can within budget** -- it
directly affects how well past utterances will be retrieved when
relevant[\[49\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Ablations%20show%20that%3A).

**Granularity of embedding units:** We should embed **at the level of a
conversation turn or small exchange**, rather than every sentence. A
common approach (as noted) is to concatenate each user statement with
the assistant's reply and embed that as one
vector[\[13\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=,manages%20insertion%20of%20new%20vectors)[\[28\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Each%20memory%20slot%20stores%20a,27%20Mar%202025).
This provides context to each piece -- the user's question and the
assistant's answer together form a meaningful unit of information. If
the user later asks something related, the embedding of that whole Q&A
turn is likely to surface. In contrast, embedding each message in
isolation can be problematic: a one-line user question out of context,
or an assistant answer without the question, might not on its own
represent the content well. It's also inefficient to retrieve an answer
without the question that prompted it (the model might not know how that
answer relates to a new query).

That said, not every single turn needs to be stored. We can **skip
trivial turns** or compress them. For example, back-and-forth like:\
User: "Are you there?"\
Assistant: "Yes, I'm here."\
User: "Great."\
These can likely be omitted from memory -- they carry almost no semantic
content about the user or topics. Including them would just add noise
(they might be semantically similar to many generic greetings and
therefore might erroneously get retrieved). We can implement a simple
rule: do not embed messages under a certain length (say \<5 tokens) or
that match a set of stop-words ("yes/okay/thanks"). Or we can embed them
but attach a very low importance score, so they would rarely be chosen
unless the user specifically says something like "you said 'yes' earlier
-- what did you mean?". This aligns with human memory: we don't remember
every "hello" and "okay" in a day-long conversation, we remember the
salient points.

Another tactic to improve embedding of short utterances is **to include
preceding context in the embedding**. For example, if the user says
"Great." as above, it could be concatenated with the previous assistant
message ("Yes, I'm here.") to form "Assistant: Yes, I'm here.\\nUser:
Great." as one chunk to embed. This way the vector might capture that
the user was acknowledging the assistant's presence -- albeit still not
very important info. Generally, combining a user utterance with some of
the preceding turn provides context that can disambiguate short replies.

We should also **embed any important system or meta-information** that
could be relevant. In a multi-channel scenario, it might help to tag the
source: e.g. "(Telegram, 9:00 AM) User: \[message\] \| Assistant:
\[message\]". The channel and timestamp could be stored as metadata in
the vector DB rather than included in the embedding text (most vector
DBs let you store metadata alongside each vector). Then we can filter or
prioritize by channel/time if needed (for instance, if the user is now
on the CLI asking about code, one might prioritize memories from the IDE
channel). However, including channel labels in the text could also
slightly influence retrieval -- it might cluster similar contexts. On
balance, it's better to store that as metadata and not muddle the
semantic vector with it. We can always decide at query time if we want
to filter by channel or date.

**Size of the warm memory store:** We anticipate retaining a few days'
worth of conversations in the vector index -- perhaps on the order of
thousands of messages. This is not huge by modern standards; even 5,000
embedded chunks with 1536 dimensions is manageable in-memory for a local
DB (and easily handled by approximate nearest neighbor libraries like
FAISS). However, to keep things efficient, we might periodically purge
or archive older entries. A strategy could be: as new interactions come
in, if the vector store exceeds X entries or if entries older than Y
days exist, move them to cold storage (and possibly replace them with a
summary). This bounding prevents unbounded growth. It also implicitly
sets the *time horizon* of the warm memory -- maybe the last 7 days of
active conversation. That said, if an older memory is very relevant, a
good semantic search could still find it even if it's older than a week
*if it remains in the index*. Time decay will reduce its score, but not
eliminate it. We might tune the decay factor so that beyond, say, 3-7
days it's almost zero unless the similarity is extremely high.

**Multi-turn embeddings:** One might ask if we should embed larger
blocks (like a summary of an entire past session). Summaries are more
suited for the cold tier -- they can be stored and perhaps also embedded
for high-level recall ("what were the main things discussed last
week?"). For warm memory, sticking to raw, un-summarized turns is better
to avoid missing details. However, there is the concept of **overlap**
-- e.g. to avoid losing context between turns, some approaches embed
overlapping windows (turns 1-3 as one vector, turns 3-5 as another,
etc.). This helps if an important detail spans turn boundaries. But
overlapping will increase storage and retrieval complexity (and might
surface duplicate info multiple times). Given our single-user scenario
where conversations are typically linear, we can likely embed
turn-by-turn without overlap. If a key detail spanned multiple turns,
the similarity search should retrieve both relevant chunks independently
anyway.

**Bottom line:** We will treat each **conversation turn (user query +
assistant answer)** as the fundamental memory chunk to embed and
store[\[13\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=,manages%20insertion%20of%20new%20vectors)[\[28\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Each%20memory%20slot%20stores%20a,27%20Mar%202025).
We will **skip or merge extremely short/glue turns** to keep the memory
store focused on meaningful content. The embeddings will be computed
using a strong sentence-level model that captures conversational
semantics (like OpenAI's Ada or a comparable model). These embeddings
will populate a **local vector database** (for example, we can use
**LanceDB or an SQLite extension for vectors**, since the user expressed
interest in local-first solutions). LanceDB would allow us to keep
everything local and simple -- it's essentially an Arrow/Parquet-based
vector store with fast ANN search, quite suitable for a few thousand
entries. Alternatively, an in-memory FAISS index or a lightweight Qdrant
instance could be used. The advantage of SQLite with a vector extension
is zero additional moving parts: we could embed vectors and store them
in an encrypted SQLite database file, which addresses persistence and
privacy (easy to backup, lock with a passphrase, etc.). The choice can
be finalized based on what integrates best with our Node.js environment
(we might end up calling a Python process for embedding and retrieval,
or use a Node vector DB library if available). In any case, the approach
stays the same: **each chunk of dialogue → embedding → store with
metadata**.

Before moving on, it's worth noting that **embedding quality** can also
be improved by fine-tuning or few-shot prompting. Some practitioners
prepend special prompts to user messages before embedding to emphasize
important aspects. For example, one could prepend "This is something the
user said about their preferences:" to a user's statement to nudge the
embedding space to cluster those kind of statements. This is an advanced
tweak and likely unnecessary if we choose a decent model. But if we find
certain types of memories aren't being retrieved well, we could explore
augmenting the text or using multiple embeddings (e.g. an embedding of
the raw text plus an embedding of a short summary of it). However, that
complexity is probably overkill for now -- the straightforward approach
is usually sufficient.

## Retrieval Strategies and Temporal Memory Tuning

With our vectors in place, the next question is how to retrieve and
inject memories into the conversation effectively.

**Similarity search and hybrid scoring:** By default, given the current
user query (and perhaps the recent conversation for context), we'll
embed the query and do a nearest-neighbor search in the vector DB to get
the top *k* most similar memory chunks. We likely will retrieve a small
number (e.g. top 3-5) to avoid overloading the prompt with too much old
content. However, as discussed, we don't want to rank purely by cosine
similarity. We plan to implement a **time-weighted relevance
score**[\[22\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=,99).
Concretely, if the vector DB or retrieval layer allows a custom score,
we can multiply the cosine similarity by a time-decay factor. For
example:

\\text{effective_score} = s\_{\\cos} \\times \\lambda\^{\\Delta t}

where \$s\_{\\cos}\$ is the cosine similarity between the query and
memory embedding, \$\\Delta t\$ is the age of the memory (e.g. in hours
or days), and \$\\lambda\$ is a decay constant (0 \< λ \< 1). If we use
hours and want to roughly halve relevance every 24 hours, we might set
\$\\lambda\^{24\\text{h}} = 0.5\$, which gives \$\\lambda \\approx
0.971\$ per hour. The Generative Agents example used 0.99 per
hour[\[22\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=,99),
a slightly slower decay (which meant after \~100 hours, weight \~0.366).
We can experiment with the factor; it might be beneficial to decay
faster over days since user context can shift daily. A possibly better
approach is *piecewise*: no decay within same day, moderate decay after
24h, heavy decay after a week, etc. But an exponential covers this
smoothly.

If our chosen vector DB doesn't support custom scoring easily, an
alternative is to fetch a larger pool (say top 10 by pure similarity)
and then re-rank in our code applying time decay. This might actually be
easier: get top 10 by semantic similarity, multiply each of their
similarity scores by a decay factor based on timestamp, then take the
top 3 of that list. This ensures very old items have to be extremely
semantically relevant to still rise to the top. Conversely, something
from an hour ago can be retrieved even if the semantic match is a bit
weaker, which aligns with a user's expectation that recent context is
more likely to be relevant.

**Threshold vs fixed K retrieval:** We should decide whether to always
retrieve a fixed number of memories or use a similarity cutoff. A
dynamic threshold approach would be: "retrieve any memory chunk with
cosine similarity above X (adjusted for decay)." This means if the user
suddenly goes to a brand-new topic that has no semantic match with past
conversations, nothing would be retrieved (which might be fine). If we
always force top-3, we risk pulling in irrelevant info on a new topic,
which could confuse the model into a tangent. On the other hand, if the
threshold is too high, we might miss subtle callbacks (maybe the query
is phrased differently and similarity is slightly below threshold but it
really is referring to an earlier thing). In practice, a hybrid works
well: e.g. retrieve up to 3 results **if** their similarity score
exceeds a certain value; if none exceed it, retrieve nothing (or perhaps
just the single highest one if it's moderately close). We might start
with a simple approach: always retrieve the top 2, but if their raw
similarity is below, say, 0.3, then assume nothing relevant and don't
include any memory. We can tune this with testing.

The RAGate idea from earlier suggests an even more cautious approach: an
LLM could classify whether the user's query is about something from the
past or
not[\[17\]](https://aclanthology.org/2025.findings-naacl.30.pdf#:~:text=retrieval,de%02velop%20RAGate%20by%20exploring%20the)[\[18\]](https://aclanthology.org/2025.findings-naacl.30.pdf#:~:text=conversation%20turns%2C%20producing%20high,In%20addition).
We could cheaply implement a heuristic version: check for phrases like
"earlier", "you said", "remember" in the user message. If present, that
strongly indicates we should fetch memory (and perhaps be more liberal
in retrieving multiple pieces). If absent, and the similarity scores are
low, we might skip adding memory to avoid non-sequiturs. Essentially,
**be selective about injecting memories** -- the user shouldn't feel the
assistant is obsessed with bringing up irrelevant old stuff ("By the
way, 3 days ago you mentioned coffee, do you want coffee?" out of
context would feel strange). The retrieved context should *always* have
clear relevance to the current conversation turn.

**How to incorporate retrieved context into the prompt:** This is a
subtle but important design point. We have to feed the retrieved memory
chunks into the LLM's input in a way that it utilizes them effectively
**without breaking the conversational flow**. One straightforward method
is to include a system or assistant message like:

"*(Recall from earlier conversations: User said \[XYZ\] on Telegram this
morning.)*"

However, the user explicitly noted that phrasing like "Earlier today you
said..." can feel awkward if overused. Another approach is to integrate
the information more fluidly: for example, when constructing the prompt
for the LLM, we can prepend a system instruction: *"The assistant has
access to memory of past conversations. Relevant memory entries will be
provided below, marked as \[Memory\]. Use them to inform your answer if
appropriate, but do so naturally."* Then list memory entries as needed,
e.g.:

**System:** *"Memory: Today 9:00 -- User was anxious about the project
deadline."*\
**System:** *"Memory: Yesterday -- User mentioned their favorite color
is blue."*

Followed by the actual conversation turns (user's latest query, etc.).
This way, the model sees the memory context but it's delineated as such.
The assistant model (Claude in our case) is usually good at
incorporating such context -- it might respond like, "I know you're a
bit anxious about the project deadline, so let's break down the
tasks..." which uses the memory appropriately. We should **avoid the
assistant directly parroting memory text** with an explicit attribution
unless stylistically needed. If a memory is highly relevant, it might
naturally say "As you mentioned, blue is your favorite color, so how
about a blue theme?" -- which is actually desirable, it shows it
remembered. The key is to not insert a huge block of past dialogue
verbatim; rather, insert concise facts or paraphrased snippets. We can
control that by **storing concise memory chunks** in the first place. If
a past turn was long, we might store a slightly abridged version or note
the key point (this starts to blur with summarization, but done at the
chunk level manually or via an importance heuristic).

**Cross-channel attribution:** Our assistant will operate across
multiple channels (Telegram chat, IDE, CLI, etc.). We need to ensure
that using memory from one channel in another doesn't confuse context.
Ideally, the user experiences it as one unified assistant that just
remembers what happened, regardless of channel. In most cases, we may
not need to explicitly mention the channel. For example, if the user
pasted code in the IDE and later on Telegram asks "Did you review that
code?", the assistant can recall it and answer. It could say, "Yes, I
looked at the code snippet for the function and it appears to...". It
doesn't necessarily have to say "the code from the IDE" unless the user
might be confused. However, in some situations mentioning the source
might add clarity, e.g. "(From your CLI session earlier)". We should
handle this on a case-by-case basis. We can include the channel info in
memory metadata and have the assistant decide whether it's relevant to
mention. For instance, if the user is actively switching contexts ("I
sent you something on Slack earlier, did you get it?"), the assistant
might clarify "Yes, I saw the message on Slack about ...". But if
channel isn't important, it can be omitted. The focus is on content
continuity, not channel.

Practically, we can include the channel name in the memory entry heading
(for our internal prompt) but instruct the assistant to incorporate or
ignore it as needed. E.g.: *"Memory: \[IDE, today 14:00\] -- User ran
into an error 'NullPointerException' in module X."* The model might then
respond on Telegram, "I recall you encountered a NullPointerException in
module X earlier. We can try to debug that by ...". It naturally left
out the "\[IDE\]" because it's not needed in the response, but it used
the content. Anthropically's Claude is generally good at this sort of
masked context usage, especially if we clarify in the prompt how to
handle it.

**Warm vs cold memory retrieval:** By default, our automated retrieval
will hit the **warm vector store** (recent semantic memory). What about
the cold archive of older summaries? We don't necessarily want to
automatically pull those in unless specifically needed, because a
high-level summary of last month's chats might not answer a detailed
question. A likely strategy: if the user explicitly asks something like
"What have we discussed about \$X over the last month?" or "Remind me of
my progress last week," then we could query the cold archive (which
might be an indexed set of summaries or even just a text file of notes).
Otherwise, the assistant won't routinely use the cold memory. Cold
storage might also be searched when warm memory has nothing (e.g. no
vector hits because it was \>7 days ago). In such a case, perhaps the
assistant can do a secondary search on the cold data. This could be
implemented by first searching the vector DB; if no results above
threshold, then search an archive (maybe using keyword or a smaller
vector index of summaries). This two-tier retrieval ensures we don't
miss important info that fell out of the warm window. But since cold
summaries are lossy, the assistant should be cautious -- maybe present
it like "I found a note from our older conversations: \[X\]." In any
event, the *automatic* surfacing is mainly for warm memory. Cold memory
might be a manual or special action triggered by certain queries (like a
user asking for a recap).

**Memory injection limit and formatting:** It's recommended not to
overload the LLM with too many retrieved chunks at once. Empirical
evidence in RAG suggests diminishing returns after a few pieces; too
much can confuse the model or lead to it just summarizing the memory
instead of answering the question. We will likely limit to, say, 2 or 3
memory items per turn. If there are more relevant ones, perhaps the
assistant can mention them briefly or consolidate them. Also, if the
memory text is long (our chunks ideally are not long, maybe a couple
sentences each), we should consider trimming them. The memory entries
can be lightly edited before injection: remove irrelevant parts, or
excerpt the key sentence from that turn that matches the query. In an
advanced implementation, we could have a second LLM pass that "extracts
the most relevant snippet" from the retrieved memory. But that might be
over-engineering at this stage; given our chunking, the chunk itself is
already the relevant snippet in theory.

**Example retrieval flow:** Suppose the user on Telegram at 5 PM asks:
"I'm feeling a bit anxious about the project... we talked about this
earlier, what was that technique you suggested I try?" Our system would
embed this query. The vector search finds a memory from 9 AM in Telegram
where the user had said they were anxious and the assistant suggested a
breathing exercise. The memory chunk (from 9 AM) might be: *"User: I'm
stressed about my project deadline. Assistant: I understand, maybe try a
short breathing exercise or a walk to clear your head."* This chunk has
high similarity and is from \~8 hours ago (which is within retention
with slight decay). We retrieve it. Now we construct the prompt to
Claude with something like:

**System role:** "Memory: (Today 9:00 AM) *Assistant suggested a
breathing exercise when user was stressed about a deadline.*"\
**User role:** "I'm feeling a bit anxious about the project again...
what was that technique you suggested I try?"\
**Assistant role:** (to be generated...)

Claude will see that memory line and likely respond: "Earlier I
recommended you do a short breathing exercise to help with anxiety. We
can do that now -- let's take a deep breath together..." etc. The result
is the assistant "remembered" the technique exactly as expected. The
user's experience is that it naturally recalled the prior suggestion
without them explicitly repeating it.

Finally, we must mention **latency considerations** in retrieval.
Querying a local vector DB for a few nearest vectors is extremely fast
(a few milliseconds typically), so that's negligible. The main latency
add is computing the embedding for the user's current query in order to
do the search. If using an API (OpenAI), that's maybe 50-100ms overhead.
If using a local model, depending on size, it could be similar or faster
(some smaller models embed in \~10ms on CPU). This is much shorter than
the LLM generation time (which for Claude might be 1-2 seconds or more
for a response). So retrieval won't be a bottleneck. *Inserting* the
retrieved text into the prompt does make the prompt longer, which can
slightly increase generation time and cost, but we're talking a
difference of maybe a hundred tokens more, which is negligible in cost
and only marginally impacts speed.

**Asynchronous embedding pipeline:** One idea to reduce latency further
is to embed and store messages asynchronously at time of sending, rather
than on retrieval. For example, when a user message comes in,
immediately send it (and the assistant's eventual reply) for embedding
and add to the store, in parallel to generating the response. This way,
by the time the next user query arrives, the memory is already up to
date. We will likely implement that: the assistant's backend can embed
each message (user and assistant) right after they are processed,
perhaps on a background thread or a separate process. This ensures the
memory index is always current without making the user wait after each
message. If some backlog occurs (say user sends many rapid messages), we
can batch embed them. But usually, it will keep up easily in real-time.

In summary, our retrieval strategy will use a **semantic search with a
recency boost** to fetch a handful of highly relevant memories, only
when relevant, and integrate them as auxiliary context for the LLM. This
should provide the needed continuity: the assistant will organically
recall prior context when it matters, and stay silent about the past
when it's not applicable.

## Evaluation: Measuring Conversational Memory Quality

Implementing long-term memory is one thing -- we also need to know if
it's working as intended. Evaluating conversational memory is tricky,
but research and some emerging benchmarks give guidance on both
**user-facing metrics** and **technical
metrics**[\[51\]](https://arxiv.org/html/2512.01710v1#:~:text=6)[\[52\]](https://arxiv.org/html/2512.01710v1#:~:text=).

**User-centric evaluation:** Ultimately, the user's perception of the
assistant's continuity and helpfulness is paramount. Some qualitative
metrics to gauge: Does the user feel the assistant remembers important
details about them? Do they have to repeat themselves less often? Are
the assistant's callbacks to prior conversation correct and contextually
appropriate? In user studies, this is often measured by surveys or
retention metrics. For example, the Heero agent with memory saw a **20%
increase in user retention and 30% longer conversations** after adding
memory
features[\[11\]](https://arxiv.org/html/2512.01710v1#:~:text=We%20focused%20on%20perceived%20helpfulness%2C,more%20engaging%20and%20sustained%20without).
Users found it more engaging when the agent could bring up earlier
context, which improved the "flow" of conversation. We can simulate a
smaller scale test: have a few sessions where certain facts are
mentioned early on, then later ask related questions -- see if the
assistant uses the memory. Also pay attention to
**non-intrusiveness**[\[11\]](https://arxiv.org/html/2512.01710v1#:~:text=We%20focused%20on%20perceived%20helpfulness%2C,more%20engaging%20and%20sustained%20without)[\[53\]](https://arxiv.org/html/2512.01710v1#:~:text=better%20continuity%2C%20personalized%20prompts%29.%20Non,sustained%20without%20reducing%20user%20comfort):
the assistant should not make the user uncomfortable by, say,
over-emphasizing that it remembers everything. Good memory usage feels
natural ("invisible" until needed). If a user is surprised or creeped
out by a reference, that's a bad sign -- maybe the memory retrieval was
too aggressive or personal. So in any user feedback loop, we'd ask if
the assistant's references to past chats were appropriate or if they
felt "too much."

**Technical metrics:** On the system side, we can measure things like
**retrieval accuracy** -- when a question about past context is asked,
do we retrieve the correct relevant memory chunk? This can be tested by
constructing some known Q&A pairs: e.g., tell the assistant a fact ("My
favorite movie is The Matrix."), then much later ask "What's my favorite
movie?" and see if it answers correctly. If it fails, either the
retrieval didn't bring that fact or the model ignored it. We can count
success rate over a set of such recall prompts. Another measurable
aspect is **latency
overhead**[\[52\]](https://arxiv.org/html/2512.01710v1#:~:text=): we
should confirm that adding memory lookup doesn't significantly slow down
responses. With our asynchronous plan, it should be fine, but we can log
response times before/after integrating memory.

**Memory leakage or errors:** One specific metric mentioned in MMAG is
**memory
leakage**[\[52\]](https://arxiv.org/html/2512.01710v1#:~:text=)[\[54\]](https://arxiv.org/html/2512.01710v1#:~:text=From%20a%20system%20perspective%2C%20we,that%20average%20response%20latency%20remained)
-- cases where information persists beyond its intended scope or
surfaces incorrectly. In other words, does the assistant ever mistakenly
use information from one context where it shouldn't? For example,
mentioning something that was supposed to be forgotten or confusing two
users' data (not an issue for us with one user). Leakage might also
refer to private info showing up when it wasn't relevant (like blurting
out "You told me your password yesterday" without being asked --
definitely undesirable!). We will have to rely on careful design to
prevent that (the model generally won't volunteer information from
memory unless prompted, especially if we instruct it not to unless
relevant).

**Benchmark tests:** The emerging **MemBench** and **LongMemEval**
benchmarks provide structured ways to test memory. *MemBench (Tan et
al., 2025)* evaluates memory along dimensions of **effectiveness** (can
the agent recall needed info), **efficiency** (cost/latency), and
**consistency**[\[55\]](https://aclanthology.org/2025.findings-acl.989/#:~:text=,including%20their%20effectiveness%2C%20efficiency%2C).
For instance, MemBench might test whether an agent given a long
conversation can answer questions about it without contradiction.
*LongMemEval (Wu et al., 2025)* goes further by simulating multi-session
dialogues with certain questions that require retrieving info from
earlier
sessions[\[56\]\[57\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=,answer%20synthesis%20in%20extended%20interactions).
It defines abilities like **Information Extraction** (remember explicit
facts), **Temporal Reasoning** (understand timeline of events),
**Multi-session Reasoning** (connect info from separate sessions),
**Knowledge Updates** (handle when facts change), and **Abstention**
(know when to say "I don't know" if something wasn't
provided)[\[58\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=Ability%20Description%20Information%20Extraction%20,when%20necessary%20evidence%20is%20absent).
We can borrow these concepts informally. For example, test temporal
reasoning: if the user said "I will go to Paris next Tuesday" and later
asks "Where am I going in 5 days?", does the assistant correctly infer
Paris (if 5 days aligns to that Tuesday)? This requires memory plus
basic date calculation. Knowledge update: if the user first says "My
laptop is a Mac." and later says "Actually I switched to Windows PC,"
does the assistant update its memory? (It should not later say "on your
Mac" erroneously.) We can simulate such flows to ensure older info is
superseded by newer statements -- perhaps by having the system mark
previous entries as outdated in cold memory when a contradiction is
observed.

**Precision of retrieval:** We might measure how often the retrieved
memory chunks are actually relevant. If our system retrieves 3 chunks
each time, but only 1 is truly related and the others are tangential,
that could confuse the model. Ideally, a high precision (the majority of
retrieved memories used are correct/helpful) is desired, even at expense
of recall (missing a memory occasionally is better than injecting wrong
ones frequently). We can review a log of interactions: whenever memory
was fetched, check if it contributed to the answer or if it was
unnecessary. In cases where it was unnecessary or harmful, adjust
thresholds or logic.

**User satisfaction:** Though hard to quantify, one proxy is to monitor
if the user explicitly corrects the assistant less often with memory in
place. For instance, without memory the user might say "I already told
you this!" or re-give information. With memory, those occurrences should
drop. Another proxy is conversation length or engagement (as seen in
Heero's trial): users tend to converse longer if the assistant is
coherent and remembers context, because it's less frustrating. We could
compare our own usage of the assistant before and after adding memory.

Finally, an interesting aspect is to test **edge cases** for evaluation:
*hallucinated memories*. Does the assistant ever claim the user said
something which in reality they didn't? This could happen if the model's
own priors fill gaps. To test, we might ask things like "What did I tell
you about my mother?" when the user never discussed that. The correct
answer is an apology or a clarification that it wasn't discussed. If the
assistant fabricates a memory ("You told me she lives in Canada" when no
such info was given), that's a serious error. We need to ensure the
system is careful: the retrieval would find nothing, so ideally the
assistant says "I don't recall you mentioning that." This ties into the
**abstention** ability from
LongMemEval[\[59\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=across%20several%20distinct%20sessions%20Temporal,posed)[\[60\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=including%20timestamps%20and%20inferred%20times,when%20necessary%20evidence%20is%20absent)
-- the assistant should gracefully say it doesn't know, rather than make
something up from its training data or imagination. We will encode that
in the prompt instructions to discourage guessing about user-specific
info not in memory.

In summary, evaluation will combine automated checks (for correctness of
recalls and latency) and human judgment (does the conversation
subjectively feel more coherent and personal?). We now have some
reference points and even datasets that outline what good long-term
memory looks like. Over time, as we gather transcripts, we can analyze:
Did the assistant appropriately carry over relevant info? Are there
instances of forgetting that should not have happened? This continuous
evaluation will guide fine-tuning things like the decay rate, threshold,
or embedding model choice.

## Failure Modes and Mitigations

Even with a solid design, things can go wrong. Anticipating failure
modes helps us implement safeguards:

-   **False memory (hallucinated recall):** The assistant might state
    something from "memory" that is incorrect -- either because it
    retrieved the wrong snippet or because the LLM confabulated a
    detail. This is dangerous since it undermines user trust ("I never
    said that!"). To mitigate this, we rely on explicit memory
    retrieval: the assistant should primarily recall facts that are
    present in stored conversation logs, not just from its parametric
    memory. By injecting the actual past utterances, we give the model
    less room to make things up. We should also include a system
    instruction that if the model is unsure about a memory, it should
    ask or apologize rather than invent. For instance, instruct it: *"If
    you do not find a relevant memory of the user saying X, do not
    assume it; respond that you don't recall or ask the user to
    clarify."* This discourages the model's tendency to "fill in blanks"
    with plausible but fake info. Additionally, our memory retrieval can
    use strict filtering: if no memory is above the similarity
    threshold, supply nothing and let the model say it doesn't remember
    being told that. We essentially prefer a **miss (not recalling
    something the user said)** over a **false positive (claiming a
    memory that doesn't exist)**. False positives are worse. We can
    double-check memory outputs by cross-referencing the conversation
    logs if needed (for example, for critical facts, ensure they were
    indeed said before). In the long run, an automated test could scan
    the model's outputs for statements like "You told me X" and verify X
    appears in the log -- catching hallucinations.

-   **Retrieving irrelevant or sensitive info:** If our similarity
    search isn't precise enough, the system might retrieve a memory that
    is only tangentially related to the query, and the assistant might
    bring it up awkwardly. For example, user asks about work, and it
    retrieves an old memory about their hobby just because of a common
    word. The mitigation here is tuning the similarity threshold and
    including context (the recent conversation acts as context too in
    the embedding). Also, we can implement a second filter: once we
    retrieve candidate memories, we could run a quick relevance check
    using the LLM itself. E.g., ask the model (in a background call) "Is
    this memory about \[topic of user query\]?" If not, skip it. That
    might be overkill for now, but it's an idea if we see irrelevant
    injections. Regarding sensitive info: because this is a personal
    assistant, it will inevitably store private details. We must ensure
    those aren't exposed in the wrong context. For single-user, the main
    risk is if someone else gained access to the memory store or if the
    assistant mistakenly shares data with an unauthorized party. In a
    multi-user scenario, you'd *strictly separate memories by user
    identity*[\[45\]](https://convai.com/blog/long-term-memeory#:~:text=To%20safeguard%20user%20privacy%20while,controls%20to%20their%20end%20users).
    For us, perhaps the user might interface on different platforms (but
    it's still them), so it's fine. If the user invites a guest into a
    conversation (not typical here), the assistant should maybe not
    blurt out personal history in front of them without permission. We
    might not need to handle that now, but it's worth noting for future
    multi-user interactions or if the assistant is used in a group chat.
    As a baseline, we'll keep the memory storage **encrypted or local**
    to prevent data leaks, and clearly document to the user what is
    being stored.

-   **Outdated information and consistency:** Long-term memory is only
    useful if it updates with the user's changes. A failure mode is when
    the assistant clings to an old fact that the user has corrected. For
    example: user says in week1 "I love cats," in week3 says "Actually,
    I'm more of a dog person now." If the assistant in week4 says "Since
    you love cats...", that's a failure. Our system should handle
    **knowledge updates**. How? When such a change happens, we should
    mark the old info as obsolete. If using a vector DB, we can delete
    or down-weight the "I love cats" memory after the user updates it.
    Alternatively, store a new memory "User now says they prefer dogs"
    with a timestamp. The time-decay will naturally make the old one
    less relevant, but if "cats" comes up as a keyword, both might
    surface. Perhaps we can tag the old memory as "replaced" in
    metadata. At least, the assistant's logic should prefer the most
    recent statement about a fact -- recency weighting already helps
    here. Another tool is to incorporate a bit of symbolic logic: e.g.,
    if the user says "I no longer X", you could search memory for "X"
    and flag those entries. This can get complicated, but starting
    simple: trust recency and maybe proactively remove contradictory
    facts from the vector store. In evaluation, we should test a few
    such changes.

-   **Memory overflow & latency spikes:** If the conversation is
    extremely active (say hundreds of messages in a day), embedding all
    of them could become a bottleneck or memory store could bloat. We
    have to ensure the memory management (pruning) keeps performance
    steady. As noted, we'll prune or summarize older entries regularly.
    Also, batch operations: if embedding each message individually can't
    keep up, we could batch a few. However, since typically you get a
    user message then assistant message, which is at most a few per
    minute, an embedding call per message is fine. Should we skip
    embedding assistant messages? Some designs only embed user
    utterances, on the theory that user's words are the important ones
    to remember (since the assistant can regenerate its part if needed,
    and what the assistant said is implicitly a function of the user
    prompt). But often the *assistant's reply contains the information
    or advice given*. For example, if earlier the user asked for a
    technique and the assistant answered with a breathing exercise, it's
    the assistant's answer that we need to recall later. So we must
    embed assistant turns as well. Otherwise we'd remember questions but
    not the answers given, which is not helpful. So we'll embed both
    sides. This doubles the volume, but still fine.

-   **Multi-turn context mismatch:** There could be issues if the
    conversation context at retrieval time doesn't perfectly align with
    the memory. E.g., the user's current query is slightly vague and the
    retrieval pulls a memory from a different context that uses similar
    words. The assistant might then respond in a way that assumes the
    old context, which could confuse the user. For instance, user says
    "What about the design issues we discussed?" meaning *today*, but
    the assistant pulls a memory from a week ago about a design issue --
    answering that might be off-base if the user actually meant a new
    design discussion from an hour ago (which maybe was still in the
    direct context anyway). This scenario emphasizes that the assistant
    should possibly clarify if uncertain: "Do you mean the design issues
    we talked about this morning, or an earlier discussion?" Instead of
    jumping to use a possibly wrong memory. It might be rare but keeping
    the dialogue unambiguous is important. Our retrieval being
    restricted to last few days reduces the chance of pulling something
    too far afield, but still.

-   **Privacy and user control:** From an ethical standpoint, a failure
    mode is if the user wants the assistant to "forget" something and it
    does not. We should allow deletion of memory on request. For
    instance, if the user says "Please forget that I said X" (maybe a
    sensitive piece of info), we need to honor that -- which means
    purging that vector from the DB and any summaries. We can implement
    a command or at least do it manually for now if such a request
    comes. Additionally, transparency: some users might ask "What do you
    remember about me?" and the assistant should be able to summarize or
    list known facts. This is a nice feature and also a way for the user
    to verify the stored info. It might not be explicitly asked for in
    our project, but it aligns with giving users agency over their data
    (highlighted in
    MMAG[\[61\]](https://arxiv.org/html/2512.01710v1#:~:text=balancing%20proactivity%20with%20user%20autonomy,as%20supportive%20rather%20than%20prescriptive)[\[62\]](https://arxiv.org/html/2512.01710v1#:~:text=contexts%20such%20as%20education%2C%20healthcare%2C,edit%20or%20erase%20their%20data)).
    We might incorporate a hidden command or a channel (like a CLI
    command to dump memory).

-   **Bias or over-personalization:** One subtle issue: if the assistant
    remembers everything, it might overuse that info and not generalize.
    For example, if the user once expressed a political opinion, the
    assistant might keep bringing it up or tailoring answers to that
    bias, when maybe the user doesn't want that every time. It's a
    balancing act -- memory should enhance the experience, not
    pigeonhole the user. We should watch out for the assistant being too
    **"Yes, you always say that you hate X, so..."** -- people change
    and contexts differ. The design should allow the assistant to use
    memory as a guide, not a hard constraint. Techniques like time-decay
    naturally allow older attitudes to fade unless reaffirmed. Also, the
    assistant's style should not assume consistency if the user is
    inconsistent (humans are!). If conflicting memories exist (user
    loved cats then loved dogs), the assistant can either ask for
    clarification or just go with the latest and not mention the
    conflict unless needed.

In conclusion, while our tiered memory should greatly improve
continuity, we remain vigilant about these edge cases. By combining
careful retrieval logic, instructions to the model, and giving the user
control (to correct or erase memory), we can mitigate most failure
modes. It's an evolving process: we'll likely discover new quirks once
it's in use and refine accordingly. The key is to ensure the system's
mistakes, if any, fail gracefully (e.g. forgetting benignly) rather than
catastrophically (inventing false personal details).

## Technical Recommendations and Architecture Refinements

Bringing it all together, here are the concrete technical
recommendations for building the tiered memory system, based on the
research and analysis:

-   **Embedding model choice:** Use a high-quality text embedding model
    specialized for sentence or paragraph similarity. OpenAI's `ada-002`
    is a strong candidate for hosted
    usage[\[50\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=,recall%20access%20%28%2018),
    but if local is needed, consider a SentenceTransformer model like
    `all-MiniLM-L12-v2` (fast, moderate accuracy) or a larger one like
    `multi-qa-MiniLM-L6` for better semantic nuance. If budget allows
    and privacy is not a concern, using the OpenAI API for embeddings
    might give the best results out-of-the-box (and it's very fast).
    Monitor embedding performance on conversational data; if short
    utterances aren't embedding well, explore adding context or
    switching to a model known to handle dialogue (there are some
    finetuned dialogue embedding models). Ensure the embedding dimension
    is supported by the vector DB and that we normalize embeddings (many
    libraries do this by default).

-   **Vector database:** For a local-first approach, **LanceDB** is an
    excellent option -- it's simple, embeddable in a Python or Node
    workflow (via Python bindings for Node or calling a Python service),
    and optimized for local use cases. It stores vectors in an Arrow
    format on disk, which is efficient and can be memory-mapped for
    performance. Another lightweight choice is to use **SQLite with a
    vector extension** (like `sqlite3_vec` or the pgvector extension via
    DuckDB). This would let us keep memory in a single file database. If
    going that route, using cosine similarity search via an approximate
    index (HNSW or IVF) is important for speed as it grows. Tools like
    Chroma or Weaviate are more heavy-duty but also viable; however,
    they might be overkill for a single-user personal DB. Qdrant is a
    middle ground -- it's an easy-to-run Rust service (or even
    in-browser via WASM) and has a Python client. Given the user's
    interest in LanceDB/SQLite, we lean towards those. Ultimately, the
    vector DB should support **metadata filtering and custom scoring**.
    Metadata filtering will allow queries like "only consider last 7
    days" or "channel == telegram" if needed. Custom scoring (or at
    least post-filtering results by time) will enable our time-decay
    integration.

-   **Memory indexing strategy:** Index each **user+assistant turn** as
    one entry. Store the text of that turn in the DB along with
    metadata: `timestamp`, `channel`, maybe an `importance` score. To
    generate an importance score, we could use a simple heuristic or an
    LLM. Possibly, after each assistant response, ask the model "Rate
    the importance of this user query and answer on a scale of 1-10 for
    future reference." But that's extra overhead and may not be needed
    initially. Instead, perhaps tag obvious trivial messages with
    importance 1, and the rest default to 5. The vector similarity will
    handle relevance, and recency will handle time -- importance might
    only be needed if we plan to do selective forgetting beyond time
    decay (MemoryBank did something like that with Ebbinghaus, but we
    can approximate by time decay alone for now). We can always add an
    importance field later if we see the need (for example, if too many
    trivial facts stick around, we could retroactively lower their
    importance or filter them out).

-   **Hot/warm/cold integration:** Keep the **Hot context** simply as
    the recent N messages (for example, last 10 messages or last \~2k
    tokens) included in the prompt directly. This ensures immediate
    coherence. The **Warm vector memory** will cover, say, the last few
    days or few thousand turns. We do not strictly expire by time, but
    we monitor size and time. A guideline: if more than (say) 5 days
    old, move to cold storage (unless flagged important). Cold storage
    can be a separate SQLite table or even just a log file of dated
    conversations. Cold storage should ideally have summaries: e.g., a
    daily summary or weekly summary generated by the assistant at
    off-peak times. We could implement a nightly job where the assistant
    reads that day's convo and produces a summary for the record (this
    summary can then be embedded into a "cold vector store" with lower
    priority). This helps if the user asks something like "What were the
    main things we talked about last week?" -- the assistant can
    retrieve from cold summaries. For immediate continuity though, cold
    is not automatically queried. It's more for explicit user queries or
    manual search.

-   **Time-decay scoring:** Implement a function to adjust similarity by
    time as discussed. In LanceDB or others, we may have to do it
    client-side. That's fine. For example, fetch top 5 by cosine
    similarity, then compute `score = cos_sim * exp(-(now - t_i)/T)`,
    where T is a decay constant (we can set T such that one day age
    multiplies by \~0.5, or whatever feels right). Select top K by that.
    This requires storing timestamps in a way we can easily get (we will
    have them). Another approach is to incorporate time as part of the
    query vector. Some research has tried adding a time dimension to
    vectors (like appending time as a feature), but that's hacky and
    less controllable. We prefer an explicit re-rank.

-   **Retrieval algorithm:** Pseudocode:

```{=html}
<!-- -->
```
-   def retrieve_relevant_memories(query_text):
            q_vec = embed(query_text)
            candidates = vectorDB.search(q_vec, top_n=10)  # initial ANN search
            # Re-rank with time decay
            now = current_timestamp
            for cand in candidates:
                age_hours = (now - cand.timestamp) / 3600
                cand.score = cand.cosine_sim * (0.99 ** age_hours)  # example decay
            sorted_cands = sorted(candidates, key=lambda c: c.score, reverse=True)
            # Filter by threshold
            results = []
            for cand in sorted_cands:
                if cand.score < THRESHOLD:
                    break
                results.append(cand)
                if len(results) >= MAX_MEMO:
                    break
            return results

    We might set `MAX_MEMO = 3` and adjust `THRESHOLD` through testing
    (maybe start with 0.3 or 0.4 on the 0-1 cosine scale after decay).
    The 0.99\^hours factor is just an initial guess; we can tune if we
    find the assistant overly ignoring older context or conversely
    dredging up old stuff too often.

```{=html}
<!-- -->
```
-   **Memory injection into prompt:** Format memory entries clearly to
    separate from current dialogue. One recommended format (for LLMs
    like Claude) is a system message enumerating memory facts. E.g.:

*System:*\
`"Relevant past context:\n- [Yesterday 10:15, Telegram] User was worried about project deadline and we discussed coping strategies.\n- [Today 9:00, IDE] User encountered NullPointerException in Module X.\n"`

Then follow with the conversation. Using a bulleted list or some
delimiter helps the model parse it. The assistant will then have these
available to use. We should experiment with phrasing -- sometimes
prefixing with `"Recall:"` or `"Note:"` helps. The Convai example cited
they prompt with memories and then the model naturally uses
them[\[39\]](https://convai.com/blog/long-term-memeory#:~:text=request%20,in%20a%20more%20personalized%20manner).
We should also consider token limits: if we have 3 memory items of \~50
tokens each, that's \~150 tokens, which is fine. If a memory item is
very long (\>200 tokens), maybe it should have been summarized rather
than stored raw. Possibly enforce a size cutoff in memory storage (if a
user or assistant turn was huge, we might store an excerpt or summary in
addition to raw? But that's complexity).

-   **Channel tagging:** Include channel info in memory metadata, but
    only surface it in prompt if relevant. For example, if user is on
    Telegram and memory from IDE is needed, it might be wise to note it
    like "\[IDE session\] ..." because context differences could matter
    (e.g. code vs conversation). But that might confuse the model or
    user if not explained. Another idea is just to incorporate that in
    the memory text subtly: "Earlier (in IDE) you wrote code that did
    X". However, if the user is the only one reading the final answer,
    maybe they'd like the assistant to clarify "the code you wrote in
    the IDE". Actually, that could be good to avoid confusion like "what
    code? oh right, my IDE code." So not a hard rule, but possibly
    beneficial.

-   **Summarization for cold memory:** Use the assistant itself to
    produce summaries for archival. For example, at the end of each day,
    run a prompt: "Summarize the key points from today's conversation
    for memory." Keep the summary in a cold store (could be text in a
    file or its own vector with a "summary" tag). This summary can
    mention topics discussed, any conclusions or decisions, and any
    important facts learned about the user. We then have long-term
    compressed memory to search if needed. We just must be careful the
    summary is accurate -- perhaps have the assistant list actual
    statements rather than freeform (to reduce chance of hallucinating
    events that didn't happen). Or we can manually review summaries
    occasionally.

-   **Asynchronous updates:** Implement the system such that after
    sending the assistant's reply to the user, we immediately embed the
    user's query and assistant's answer and upsert into the vector DB.
    This ensures memory is ready for the next turn without delaying the
    response. If using Node, this might mean calling a Python
    microservice to handle embeddings and DB writes asynchronously.
    Alternatively, do it synchronously but since the assistant is
    waiting for the LLM response anyway, one of the two (embedding vs
    generation) will likely be the bottleneck, not both. We can pipeline
    it.

-   **User control:** Provide methods to export or clear memory. Perhaps
    a special command like `/forget last message` or `/wipe memory` can
    be recognized (in any channel or a control UI) and we then remove
    those entries. This is not just good practice but also helps during
    dev/testing to reset if needed. It also aligns with privacy by
    design -- the user can purge data anytime.

-   **Continuous improvement hooks:** One nice architectural addition
    could be a *reflection* step. Similar to generative agents where
    they periodically reflect on memory to form higher-level
    insights[\[63\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=,other%20observations%20when%20retrieval%20occurs)[\[64\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=language%20model%2C%20%E2%80%9CGiven%20only%20the,is%20Klaus%20Mueller%20passionate%20about%3F%E2%80%9D),
    our assistant might occasionally synthesize what it's learned about
    the user. For example, after enough data, it might conclude "User
    often gets anxious about deadlines, and finds breathing exercises
    helpful." This could be stored as a distilled fact in long-term user
    profile memory. While not required, it could enrich personalization.
    This is something we can add in later phases, once the basic memory
    retrieval works.

Now, considering the **platform (TypeScript/Node with Claude API)**: we
will likely orchestrate memory retrieval and prompt assembly in our
Node.js code, then send the composed prompt to Claude. Claude's large
context (up to 100k for some versions) actually could allow a *lot* of
memory to be inserted if we wanted, but we'll keep it slim as reasoned.
Claude is also pretty good at following complex instructions and using
provided context effectively (Anthropic specifically has done research
on long-term dialogue memory, so Claude might have some helpful biases).
We should emphasize in the system prompt or few-shot examples how to use
memory: e.g., an instruction: *"When relevant background information
(Memory) is provided, incorporate it into your answer. Do not ignore it.
If something from memory is sensitive or the user seems to have changed
their mind since, use judgment in mentioning it. Do not invent memories
that are not provided."* This kind of meta-instruction helps align the
model's behavior.

## Open Problems and Future Directions

Even with the above plan, there are open research questions and
challenges we should be aware of, which might inspire future
improvements:

-   **Optimal decay function:** We chose an exponential time decay
    somewhat arbitrarily. What is the "right" decay curve for
    conversational memory relevance? This likely depends on user
    behavior. If a topic hasn't come up in a while, maybe it truly is
    less relevant (exponential suits that). But there might be cases
    where importance should override time completely -- e.g., if the
    user once told the assistant a crucial fact ("I have a peanut
    allergy"), that should probably never be forgotten or down-weighted
    too much, even if it was weeks ago. So a more adaptive strategy is
    needed: *important facts have a slower decay, trivial facts decay
    faster*. This ties to weighting by importance. We may need to
    implement a mechanism to mark certain memories as "long-term
    important" (like allergies, names of family members, etc.) which
    essentially live in the long-term user profile (cold memory) and are
    always considered. On the flip side, ephemeral details (like what
    they ate for lunch last Tuesday) can decay out in a day or two.
    Finding the right balance likely requires user feedback and possibly
    even a learned model (some works train a separate model to predict
    memory relevance given context). For now, we do manual tuning, but
    it's an open problem how to automate this optimally.

-   **Scaling to very long conversations:** If our user ends up chatting
    for months, how to scale the memory? Summarization can only compress
    so much without losing detail. Some emerging solutions are
    *hierarchical memory*: e.g., have memories of memories (summaries of
    summaries). Or using external knowledge graphs: extracting
    structured info (like relationships: "User -\> lives_in -\> London")
    from conversation and storing those. Then when needed, query the
    knowledge graph for factual recall and the vector store for episodic
    recall. This could reduce reliance on pure vector search and handle
    things like "Has the user ever mentioned their favorite food?" with
    a direct query to a knowledge store. Open-source projects like
    LangChain's **ConversationKnowledgeGraphMemory** attempt to build
    such graphs. This remains a complex area -- knowledge extraction
    from free-form chat can be error-prone (hallucinations or missing
    pieces)[\[65\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=2025%20%2C%20Salama%20et%20al,existent%20facts%20%28%2018).
    But combining structured and unstructured memory is likely the
    future (some research calls it hybrid semantic memory).

-   **Model bias vs user facts:** There's a known phenomenon where the
    LLM's internal knowledge can conflict with the conversation memory.
    For example, the model might *know* a generic fact about something
    and override the user's specific detail. A trivial case: user says
    "My birthday is July 10th," but the model might have seen elsewhere
    another date (if it recognized the user as some famous person or
    something). Usually not an issue for personal assistants (the user
    is not a famous entity in training data), but relevant for knowledge
    updates. This is noted in research as the **parametric vs episodic
    memory
    conflict**[\[66\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=A%20major%20research%20challenge%20remains,is%20a%20demonstrated%20countermeasure)[\[67\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=questions%20with%20high%20pretraining%20memorization,is%20a%20demonstrated%20countermeasure).
    Ensuring the assistant trusts the user-provided memory over its own
    training is important. Our approach of explicitly injecting memory
    should mostly solve this (the model will see the user's statement
    and normally use it). But if it does slip (like answering from
    general knowledge ignoring user's own data), we might need to
    further emphasize via system instructions to prioritize conversation
    memory for user-specific info.

-   **Evaluating long-term satisfaction:** We will want to evaluate not
    just immediate correctness, but whether over weeks the assistant's
    personality and helpfulness improve with memory. Are there any
    negative effects? Possibly the user might feel uncomfortable if the
    assistant remembers *everything* ("It's weird that you recall my
    every word"). Some user studies indicate a fine line between helpful
    memory and the "creepy"
    factor[\[11\]](https://arxiv.org/html/2512.01710v1#:~:text=We%20focused%20on%20perceived%20helpfulness%2C,more%20engaging%20and%20sustained%20without)[\[53\]](https://arxiv.org/html/2512.01710v1#:~:text=better%20continuity%2C%20personalized%20prompts%29.%20Non,sustained%20without%20reducing%20user%20comfort).
    To mitigate that, transparency and giving the user an "off switch"
    are key. Perhaps even a setting for memory duration (some might
    prefer the assistant only remember the last day and not beyond).
    These are design considerations outside pure tech. In future,
    building a UI to manage memory (like a timeline the user can edit)
    would be great.

-   **Error handling when retrieval fails:** If our vector DB goes down
    or the embedding API fails, the assistant should still function
    (just without memory). We should code a fallback: if memory
    retrieval throws an error or times out, log it but proceed to
    respond with just the recent context. Robustness in that sense is
    needed for production use.

-   **Adaptive retrieval and learning:** Over time, the system could
    learn which retrieved memories actually helped. Perhaps via user
    feedback or observing if the assistant's answers were rated good
    when certain memory was used. This could allow adjusting the
    retrieval parameters. For example, if we notice many times the top-1
    memory was always used but 2 and 3 were not, maybe we can reduce K
    or tighten threshold (to save tokens). Or if we find it often needed
    a memory that was ranked 5th (meaning we cut it off), maybe loosen
    threshold. This kind of adaptive optimization is an open area
    (there's research on *reinforcement learning for memory retrieval*,
    having the agent learn a policy to decide what to
    fetch[\[68\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=,modal%20memory%20fusion%20%28e.g.%2C%20images)[\[69\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=,28%20May%202025)).
    In the future, something like a neural **memory controller** could
    dynamically decide how many and which memories to retrieve given
    context, possibly by training on successful dialogue examples. For
    now, we rely on heuristics, but it's good to keep an eye on
    developments there.

-   **Multi-modal memory:** Currently we focus on text (since channels
    like IDE, CLI will mostly yield text). But if in future the
    assistant gets image input or audio, integrating those into memory
    is another challenge. For example, remembering an image the user
    shared and being able to refer to it later would require storing a
    reference or a description of it. Companies like Meta are exploring
    image+text memory (e.g. "remember this photo context for later
    conversation"). While not immediately needed, our architecture could
    extend by storing embeddings of images (via CLIP or similar) along
    with text. Then if the user says "That diagram I sent earlier -- any
    thoughts?", we could retrieve the image (or its analysis) from
    memory. This is a forward-looking idea, but something to consider if
    our assistant expands modalities.

-   **Unified memory vs separate by channel:** We decided on unified
    memory with channel tags. Another possible design is to maintain
    separate vector indexes per channel, under the assumption that
    context rarely crosses (maybe what happens in IDE stays in IDE?).
    But we already have use cases for cross-reference (like referencing
    code discussed in IDE while chatting in Telegram). So unified is
    better for a single user. If scaling to multiple users and channels,
    one might have memory partitions by user and within that by channel
    type, with some bleed-over allowed via higher-level unification. It
    can get complex, so thankfully for one user we avoid that.

-   **Continuous learning vs memory:** One might ask, why not fine-tune
    the model on the conversation history? That would bake the memory in
    but has many downsides: cost, risk of overfitting or forgetting, and
    inability to delete data easily. External memory is the preferred
    approach in literature because it's more
    flexible[\[2\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=integrating%20non,continual%20learning%2C%20and%20personalized%20interactions)[\[70\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=1,Components).
    There is interesting research on *lifelong learning* where the model
    gradually updates itself with new knowledge. But for personal
    assistant, that's not needed -- external memory suffices and is
    safer (no model drift, and can be edited).

**Where we might contribute:** This project itself will be an
implementation that few personal assistants currently have -- a true
long-term memory spanning multiple contexts. We could open-source parts
of it or share our findings (e.g., how well time-weighted semantic
search works in practice for chat). The **time decay + semantic
retrieval** approach for dialogue could be tuned and possibly published
as a short blog or paper, adding to community knowledge (some have
discussed it on forums, but concrete evaluations are few). Also, the
integration of memory with multiple channels (IDE + chat) could yield
insights on how context switching affects memory usage. We could
contribute by evaluating, say, coding assistant scenarios: does
remembering a discussion from chat help in IDE code explanations and
vice versa?

Another research angle is **memory safety and privacy**. We might
experiment with client-side encryption of certain memory entries (so
even if the DB is compromised, sensitive ones are ciphered). But the
model can't use an encrypted memory obviously. Instead, one could
encrypt at rest and decrypt in memory when building prompts. Just
something to consider if extremely sensitive data is stored. There's
also a line of work on using homomorphic hashes for vector DB so you
don't leak raw text (beyond our scope currently).

In summary, while we have a solid plan, we remain aware that fine-tuning
this memory system is an ongoing journey. We'll keep abreast of new
research -- e.g., any new "Long-Term Memory for LLM" papers (there are
many coming out; one survey in 2025 by Wu et al. covers dozens of memory
mechanisms[\[71\]](https://medium.com/@ashishpandey2062/llms-dont-have-memory-so-how-do-they-remember-be1e5d505d6a#:~:text=Contextual%20memory%20is%20like%20remembering,Context%20Window%3A%20LLM%27s%20Working%20Memory)).
The field is evolving, and our implementation can evolve with it.

## Implementation Roadmap

Finally, let's outline a phased plan to implement and roll out this
conversational memory system:

**Phase 1: Basic Vector Memory Integration**\
*Goal:* Get a minimal warm-memory working with relevant retrieval.

-   **Set up vector store** in the stack. For now, use a simple local
    solution (maybe even an in-memory FAISS index for prototyping, then
    swap to LanceDB or SQLite-vss for persistence).
-   **Modify the conversation pipeline** so that after each user
    message, the system searches the vector memory for relevant context.
    Initially, keep it simple: retrieve top-1 or top-2 by pure
    similarity (no decay yet) to validate the concept.
-   **Prompt augmentation:** Append the retrieved text as a system
    prompt or prefix in a clear format. Ensure the LLM (Claude) responds
    appropriately (test a few scenarios).
-   **Test basic recall:** e.g., say "My favorite food is sushi", then a
    few turns later ask "What's my favorite food?" -- see if it
    remembers via the memory injection. Tweak formatting until it works
    reliably.
-   Keep the hot context as is (last few messages) for now; the focus is
    adding memory beyond it.

Once this skeleton is functional, move to phase 2.

**Phase 2: Time-Decayed & Thresholded Retrieval**\
*Goal:* Make retrieval smarter with recency weighting and avoid
irrelevant memory injections.

-   Implement the **time-decay scoring** in the retrieval function.
    Decide on initial decay rate (e.g., half-life \~ 1-2 days).
-   Add a **similarity score threshold** or gating logic. Possibly
    implement a simple check: if top result similarity \< X, don't
    retrieve anything.
-   **Test recency effect:** Create a scenario where an older memory is
    semantically similar to query but a newer one is slightly less
    similar. Verify the newer one wins if it should. For example: user
    discusses Topic A yesterday and again in a slightly different way
    today -- ensure today's context is used more.
-   **Prevent over-retrieval:** Try a completely off-topic query and
    ensure no memory (or only very low similarity memory) is added.
-   Start logging retrieval actions for debugging (like print which
    memory was fetched and its score) to fine-tune.

**Phase 3: Cold Memory and Summarization**\
*Goal:* Manage memory growth and archive older content.

-   Decide on a timeframe or size limit for warm memory. E.g., warm
    keeps last 7 days or last 1000 turns.
-   Implement a job or trigger to **summarize conversations** that are
    about to fall out of warm memory. For example, if a day's worth of
    chat is about to be dropped, have the assistant generate a summary
    and store that summary (in a separate `cold_memory` list or vector
    index with large granularity).
-   Alternatively, implement an **archive store** where we just move the
    raw transcripts (maybe not needed if we keep everything in a DB with
    a flag).
-   For now, summarization can be basic: one summary per day's chat,
    focusing on key facts and unresolved questions. Use the assistant in
    a separate mode for this.
-   Ensure that when user asks broad questions ("Remind me what we did
    last week"), the system can search the cold summary. Possibly
    incorporate a manual command or automatic if certain keywords
    detected (like "week" or date).
-   This phase may also include setting up a mechanism to compress or
    drop trivial memory entries as discussed (e.g., filter out those
    with importance=1 before summarizing, so the summary doesn't include
    every "OK").

**Phase 4: Refinement and Personalization**\
*Goal:* Improve memory quality and personalization after initial
deployment.

-   **Add importance tagging:** If needed, run back through existing
    memory and mark a few things (like personal facts) as high
    importance, maybe by a quick script or prompt that finds lines with
    "favorite" or "I am". Weight these higher or keep them indefinitely.
-   Integrate a **long-term user profile memory.** Perhaps create a
    separate small JSON or YAML store of "User Profile" containing
    stable facts (name, birthday, preferences). Some of these can be
    extracted from conversations or explicitly set by user. Always
    include this profile in the prompt as well (or at least ensure those
    facts are part of memory).
-   **Tune retrieval parameters:** based on the logs from phase 2,
    adjust the threshold or number of results. If we see irrelevant
    memory being injected, tighten threshold. If we see useful memory
    sometimes not coming through, loosen it or increase k.
-   Implement the **forget on request** feature: e.g., if user says
    "forget that" or a specific command, remove that memory. This likely
    involves parsing the request to identify which memory (maybe by time
    or content) and deleting it from the vector store (and maybe adding
    a note to cold storage that it was deleted, so that even a summary
    won't mention it).
-   Work on the **polish of responses**: The assistant should seamlessly
    weave in memory without sounding robotic. Possibly add more few-shot
    examples in the prompt of how to use memory ("If the user asks
    something that was discussed before, use phrasing like 'As we talked
    about \[timeframe\], ...'"). Ensure it doesn't overuse exact
    phrases; it should vary between direct references and subtle
    contextual continuity.

**Phase 5: Evaluation and Feedback Loop**\
*Goal:* Measure performance and adjust accordingly.

-   Conduct a series of **simulation tests**: Create a dummy user
    persona and conversation script that covers various scenarios (info
    given, changed, referenced later, etc.). Run the assistant through
    it and see how it fares. Identify any misses or inappropriate
    recalls.
-   Possibly involve a real user (or ourselves acting as user over a
    week) and keep a diary of any memory issues encountered.
-   Evaluate using the criteria from the **Evaluation** section: Does
    the assistant correctly recall details? Does it avoid false
    memories? How is latency?
-   If possible, try out something like the LongMemEval tasks
    informally: for example, try a multi-session Q&A to see if the
    assistant can handle it with our memory (though our use-case is a
    single user, multi-session is basically continuing day after day).
-   With data from testing, adjust decay or algorithm further if needed.
    For example, if we find it too forgetful, we might slow decay; if
    too clingy to old stuff, speed it up.
-   Check for any signs of "creepiness" -- e.g., maybe ask a friend to
    chat with it and see if any memory reference felt off-putting. If
    so, refine how the assistant frames remembered info (maybe always in
    service of helping, not just "I know this about you").

**Phase 6: Advanced Enhancements (ongoing)**\
*Goal:* Go beyond the MVP to incorporate cutting-edge ideas.

This is optional/future, but could include: - **Automated reflection:**
Let the assistant periodically generate "insights" about the user's
goals or habits (like generative agents did with
reflections[\[63\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=,other%20observations%20when%20retrieval%20occurs)[\[64\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=language%20model%2C%20%E2%80%9CGiven%20only%20the,is%20Klaus%20Mueller%20passionate%20about%3F%E2%80%9D)).
Use these to improve proactivity (e.g., "You often mention being anxious
on Mondays. Perhaps doing X each Monday morning could help?"). This
should be done carefully to remain helpful not
intrusive[\[61\]](https://arxiv.org/html/2512.01710v1#:~:text=balancing%20proactivity%20with%20user%20autonomy,as%20supportive%20rather%20than%20prescriptive). -
**Memory-based personalization of style:** If the assistant learns the
user prefers concise answers, or a certain tone, it can remember that
and always adapt style. This can be explicit: store "User prefers terse
responses" from a feedback and always incorporate that into the system
prompt for the model. - **Integration with external knowledge and
calendar:** If we know events (via time-linked
memory)[\[72\]](https://arxiv.org/html/2512.01710v1#:~:text=%23%20Time),
the assistant could remind proactively. E.g., if the user said "my
meeting is next Friday at 3pm" and time now is Friday 10am, the
assistant could recall that and say "Good luck on your meeting this
afternoon!". This bleeds into agent proactivity, which is a feature
memory enables. Implementation-wise, that could be a scheduled check on
memory for any event dated today. - **Experiment with learned memory
retrieval models:** If someone releases an easy-to-use model that, given
the dialogue history, decides what to retrieve (like the RAGate concept
or something using a transformer to pick memories), we could experiment
replacing our heuristic with that. But only if it clearly benefits.

The roadmap above ensures we start simple, get a working product, then
incrementally add sophistication. By Phase 5, we should have a robust
memory system that addresses the core problem: the assistant remembers
earlier conversations across channels and time, providing continuity
without needing the full history in context. Subsequent improvements
will make it even more natural and aligned with user needs.

**Conclusion:** We've surveyed literature on memory-augmented LLMs and
gleaned best practices: use a hierarchical memory approach (short-term
context + long-term vector store +
archive)[\[1\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Patterns%20such%20as%20Mixed%20Memory,structure%20memory%20hierarchically%20with)[\[29\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=%2A%20Sensory%2Fcontext%20memory%20%28real,step%20reasoning),
weight semantic retrieval with
recency[\[22\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=,99),
choose suitable embedding granularity, and always consider user
experience in how memory is used. Industry systems like Pi and Convai
confirm these approaches and underscore handling of recency and
importance[\[40\]](https://convai.com/blog/long-term-memeory#:~:text=the%20factors%20that%20make%20a,different%20from%20just%20information%20are)[\[37\]](https://news.ycombinator.com/item?id=35798744#:~:text=On%20memory%20Wow%3A%20,term).
Our technical design aligns well with state-of-the-art: a
**time-weighted RAG** system for dialogue.

By following this plan, we aim to create an AI assistant that feels
markedly more attentive and coherent over long-term interactions -- one
that can genuinely pick up the conversation from this morning or last
week and carry on intelligently. This moves us closer to an assistant
that "actually knows you" in a useful, user-friendly way, rather than a
stateless chatbot. It's an exciting step toward more human-like AI
communication, and one that relatively few implementations have achieved
to date. With careful execution, our personal assistant will not only
remember, but remember *responsibly* and effectively, making it a more
trustworthy and engaging companion.

**Sources:**

-   Zeppieri, S. (2025). *Mixed Memory-Augmented Generation (MMAG) for
    LLM-based agents* -- Memory taxonomy and user study
    results[\[8\]](https://arxiv.org/html/2512.01710v1#:~:text=across%20extended%20interactions,its%20implementation%20in%20the%20Heero)[\[11\]](https://arxiv.org/html/2512.01710v1#:~:text=We%20focused%20on%20perceived%20helpfulness%2C,more%20engaging%20and%20sustained%20without).
-   Park et al. (2023). *Generative Agents: Interactive Simulacra of
    Human Behavior* -- Memory retrieval combining recency, importance,
    relevance[\[19\]](https://www.lukew.com/ff/entry.asp?2030#:~:text=situation%20as%20input%20and%20returns,level)[\[22\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=,99).
-   Zhong et al. (2023). *MemoryBank: Enhancing LLMs with Long-Term
    Memory* -- Forgetting curve-inspired memory
    decay[\[24\]](https://arxiv.org/abs/2305.10250#:~:text=memories%2C%20continually%20evolve%20through%20continuous,based%20chatbot%20named)[\[25\]](https://arxiv.org/abs/2305.10250#:~:text=To%20mimic%20anthropomorphic%20behaviors%20and,displays%20heightened%20empathy%20in%20its).
-   Convai (2024). *Long Term Memory Feature* -- Industry implementation
    with recency and emotional
    ranking[\[40\]](https://convai.com/blog/long-term-memeory#:~:text=the%20factors%20that%20make%20a,different%20from%20just%20information%20are)[\[39\]](https://convai.com/blog/long-term-memeory#:~:text=request%20,in%20a%20more%20personalized%20manner).
-   Reddit discussion (2023). *Character.AI context window limitations*
    -- Example of 3000-token memory limit and
    forgetting[\[32\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=Resume%20for%20the%20people%20that,didn%27t%20understand%20it).
-   Inflection AI's Pi -- AI behavior with episodic (long-term) vs
    short-term memory (Hacker News
    comment)[\[37\]](https://news.ycombinator.com/item?id=35798744#:~:text=On%20memory%20Wow%3A%20,term).
-   Wu et al. (2025). *LongMemEval Benchmark* -- Evaluation criteria for
    long-term memory in
    dialogues[\[56\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=,answer%20synthesis%20in%20extended%20interactions)[\[58\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=Ability%20Description%20Information%20Extraction%20,when%20necessary%20evidence%20is%20absent).
-   Emergent Mind (2025). *Memory-Augmented LLMs Survey* -- External
    memory modules, retrieval, and memory management
    strategies[\[2\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=integrating%20non,continual%20learning%2C%20and%20personalized%20interactions)[\[49\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Ablations%20show%20that%3A).
-   Reddit r/MachineLearning (2024). *Conversational RAG best practices*
    -- sliding window + summary, need for dynamic retrieval
    gating[\[73\]](https://www.reddit.com/r/MachineLearning/comments/1ftdby7/d_how_are_folks_building_conversational_retrieval/#:~:text=together%20and%20have%20an%20LLM,synthesize%20and%20answer)[\[74\]](https://www.reddit.com/r/MachineLearning/comments/1ftdby7/d_how_are_folks_building_conversational_retrieval/#:~:text=1,to%20make%20this%20decision).
-   Anthropic Claude documentation (implicitly) -- not cited, but
    Claude's ability to handle large prompts was considered.

[\[1\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Patterns%20such%20as%20Mixed%20Memory,structure%20memory%20hierarchically%20with)
[\[2\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=integrating%20non,continual%20learning%2C%20and%20personalized%20interactions)
[\[3\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Memory,continual%20learning%2C%20and%20personalized%20interactions)
[\[13\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=,manages%20insertion%20of%20new%20vectors)
[\[28\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Each%20memory%20slot%20stores%20a,27%20Mar%202025)
[\[29\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=%2A%20Sensory%2Fcontext%20memory%20%28real,step%20reasoning)
[\[30\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=coherence%2C%20task%20accuracy%2C%20and%20user,engagement)
[\[31\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=,27%20Wang)
[\[49\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=Ablations%20show%20that%3A)
[\[50\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=,recall%20access%20%28%2018)
[\[65\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=2025%20%2C%20Salama%20et%20al,existent%20facts%20%28%2018)
[\[66\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=A%20major%20research%20challenge%20remains,is%20a%20demonstrated%20countermeasure)
[\[67\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=questions%20with%20high%20pretraining%20memorization,is%20a%20demonstrated%20countermeasure)
[\[68\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=,modal%20memory%20fusion%20%28e.g.%2C%20images)
[\[69\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=,28%20May%202025)
[\[70\]](https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms#:~:text=1,Components)
Memory-Augmented LLMs: Enhanced Context Recall

<https://www.emergentmind.com/topics/memory-augmented-large-language-models-llms>

[\[4\]](https://arxiv.org/html/2512.01710v1#:~:text=Recent%20work%20has%20begun%20to,richer%20and%20more%20adaptive%20interactions)
[\[5\]](https://arxiv.org/html/2512.01710v1#:~:text=LLMs%20beyond%20short,episodic%20recall%2C%20and%20contextual%20awareness)
[\[6\]](https://arxiv.org/html/2512.01710v1#:~:text=MemGPT%20,isn%E2%80%99t%20just%20about%20scaling%20up)
[\[7\]](https://arxiv.org/html/2512.01710v1#:~:text=information%20across%20conversations%20without%20bloating,memory%20is%20organized%20and%20accessed)
[\[8\]](https://arxiv.org/html/2512.01710v1#:~:text=across%20extended%20interactions,its%20implementation%20in%20the%20Heero)
[\[9\]](https://arxiv.org/html/2512.01710v1#:~:text=To%20address%20this%20need%2C%20we,environmental%20context%20without%20overwhelming%20users)
[\[10\]](https://arxiv.org/html/2512.01710v1#:~:text=Memory%20Type%20Cognitive%20Psychology%20Analogy,Memory%20Sensory%20integration%2C%20situational%20awareness)
[\[11\]](https://arxiv.org/html/2512.01710v1#:~:text=We%20focused%20on%20perceived%20helpfulness%2C,more%20engaging%20and%20sustained%20without)
[\[12\]](https://arxiv.org/html/2512.01710v1#:~:text=conversations%20in%20Heero%2C%20we%20observed,sustained%20without%20reducing%20user%20comfort)
[\[51\]](https://arxiv.org/html/2512.01710v1#:~:text=6)
[\[52\]](https://arxiv.org/html/2512.01710v1#:~:text=)
[\[53\]](https://arxiv.org/html/2512.01710v1#:~:text=better%20continuity%2C%20personalized%20prompts%29.%20Non,sustained%20without%20reducing%20user%20comfort)
[\[54\]](https://arxiv.org/html/2512.01710v1#:~:text=From%20a%20system%20perspective%2C%20we,that%20average%20response%20latency%20remained)
[\[61\]](https://arxiv.org/html/2512.01710v1#:~:text=balancing%20proactivity%20with%20user%20autonomy,as%20supportive%20rather%20than%20prescriptive)
[\[62\]](https://arxiv.org/html/2512.01710v1#:~:text=contexts%20such%20as%20education%2C%20healthcare%2C,edit%20or%20erase%20their%20data)
[\[72\]](https://arxiv.org/html/2512.01710v1#:~:text=%23%20Time) MMAG:
Mixed Memory-Augmented Generation for Large Language Models Applications

<https://arxiv.org/html/2512.01710v1>

[\[14\]](https://aclanthology.org/2025.findings-naacl.30.pdf#:~:text=Knowledge%20Retrieval%3A%20Several%20studies%20have,relevant%20knowl%02edge%20but%20first%20transformed)
[\[15\]](https://aclanthology.org/2025.findings-naacl.30.pdf#:~:text=and%20Gabriel%2C%202023%3B%20Miehling%20et,In%20contrast%2C%20without)
[\[16\]](https://aclanthology.org/2025.findings-naacl.30.pdf#:~:text=stage%20of%20a%20conversation,propose%20a%20binary%20knowledge%20gate)
[\[17\]](https://aclanthology.org/2025.findings-naacl.30.pdf#:~:text=retrieval,de%02velop%20RAGate%20by%20exploring%20the)
[\[18\]](https://aclanthology.org/2025.findings-naacl.30.pdf#:~:text=conversation%20turns%2C%20producing%20high,In%20addition)
aclanthology.org

<https://aclanthology.org/2025.findings-naacl.30.pdf>

[\[19\]](https://www.lukew.com/ff/entry.asp?2030#:~:text=situation%20as%20input%20and%20returns,level)
LukeW \| Generative Agents

<https://www.lukew.com/ff/entry.asp?2030>

[\[20\]](https://www.emergentmind.com/topics/generative-agents#:~:text=observations%2C%20plans%2C%20reflections%2C%20and%20high,recursively%20abstracts%20over%20reflections%20for)
[\[21\]](https://www.emergentmind.com/topics/generative-agents#:~:text=,over%20reflections%20for%20hierarchical%20reasoning)
Generative Agents: Human-like AI Behaviors

<https://www.emergentmind.com/topics/generative-agents>

[\[22\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=,99)
[\[23\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=,fill%20in%3E%E2%80%9D)
[\[63\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=,other%20observations%20when%20retrieval%20occurs)
[\[64\]](https://www.hioscar.ai/10-memory-and-retrieval-for-llms#:~:text=language%20model%2C%20%E2%80%9CGiven%20only%20the,is%20Klaus%20Mueller%20passionate%20about%3F%E2%80%9D)
10: Memory & Retrieval for LLMs --- OscarAI

<https://www.hioscar.ai/10-memory-and-retrieval-for-llms>

[\[24\]](https://arxiv.org/abs/2305.10250#:~:text=memories%2C%20continually%20evolve%20through%20continuous,based%20chatbot%20named)
[\[25\]](https://arxiv.org/abs/2305.10250#:~:text=To%20mimic%20anthropomorphic%20behaviors%20and,displays%20heightened%20empathy%20in%20its)
\[2305.10250\] MemoryBank: Enhancing Large Language Models with
Long-Term Memory

<https://arxiv.org/abs/2305.10250>

[\[26\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=LongMemEval%20formalizes%20a%20modular%20architecture,memory%2C%20partitioned%20into%20three%20stages)
[\[27\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=,5)
[\[56\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=,answer%20synthesis%20in%20extended%20interactions)
[\[57\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=,answer%20synthesis%20in%20extended%20interactions)
[\[58\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=Ability%20Description%20Information%20Extraction%20,when%20necessary%20evidence%20is%20absent)
[\[59\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=across%20several%20distinct%20sessions%20Temporal,posed)
[\[60\]](https://www.emergentmind.com/topics/longmemeval-dataset#:~:text=including%20timestamps%20and%20inferred%20times,when%20necessary%20evidence%20is%20absent)
LongMemEval: Benchmark for LLM Memory

<https://www.emergentmind.com/topics/longmemeval-dataset>

[\[32\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=Resume%20for%20the%20people%20that,didn%27t%20understand%20it)
[\[33\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=Forward)
[\[34\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=messages%20are%20pushed%20out%20of,about%20refers%20to%20two%20things)
[\[35\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=I%20then%20proceeded%20to%20have,the%20start%20of%20the%20conversation)
[\[36\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=I%20asked%20the%20AI%20at,roughly%202800%20or%203000%20tokens)
[\[47\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=window)
[\[48\]](https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/#:~:text=With%20such%20a%20tiny%20context,already%20rock%20bottom%29%20expectations)
C AI has a context window of about 3000 tokens : r/CharacterAI

<https://www.reddit.com/r/CharacterAI/comments/1hr7nqd/c_ai_has_a_context_window_of_about_3000_tokens/>

[\[37\]](https://news.ycombinator.com/item?id=35798744#:~:text=On%20memory%20Wow%3A%20,term)
Inflection AI First Release -- Pi \| Hacker News

<https://news.ycombinator.com/item?id=35798744>

[\[38\]](https://convai.com/blog/long-term-memeory#:~:text=A%20key%20aspect%20of%20building,their%20own%20personalities%20over%20time)
[\[39\]](https://convai.com/blog/long-term-memeory#:~:text=request%20,in%20a%20more%20personalized%20manner)
[\[40\]](https://convai.com/blog/long-term-memeory#:~:text=the%20factors%20that%20make%20a,different%20from%20just%20information%20are)
[\[41\]](https://convai.com/blog/long-term-memeory#:~:text=,influencing%20the%20character%27s%20personality%20development)
[\[42\]](https://convai.com/blog/long-term-memeory#:~:text=the%20RAG%20processor%20accesses%20the,in%20a%20more%20personalized%20manner)
[\[43\]](https://convai.com/blog/long-term-memeory#:~:text=on%20their%20relevance.%20,in%20a%20more%20personalized%20manner)
[\[44\]](https://convai.com/blog/long-term-memeory#:~:text=prioritized%2C%20influencing%20the%20character%27s%20personality,development)
[\[45\]](https://convai.com/blog/long-term-memeory#:~:text=To%20safeguard%20user%20privacy%20while,controls%20to%20their%20end%20users)
Implement Long-Term Memory in AI Characters with Convai

<https://convai.com/blog/long-term-memeory>

[\[46\]](https://github.com/qhjqhj00/MemoRAG#:~:text=MemoRAG%20is%20an%20innovative%20RAG,is%20accepted%20by%20theWebConf%202025)
GitHub - qhjqhj00/MemoRAG: Empowering RAG with a memory-based data
interface for all-purpose applications!

<https://github.com/qhjqhj00/MemoRAG>

[\[55\]](https://aclanthology.org/2025.findings-acl.989/#:~:text=,including%20their%20effectiveness%2C%20efficiency%2C)
Towards More Comprehensive Evaluation on the Memory of LLM \...

<https://aclanthology.org/2025.findings-acl.989/>

[\[71\]](https://medium.com/@ashishpandey2062/llms-dont-have-memory-so-how-do-they-remember-be1e5d505d6a#:~:text=Contextual%20memory%20is%20like%20remembering,Context%20Window%3A%20LLM%27s%20Working%20Memory)
LLMs Don\'t Have Memory: How Do They Remember? - Medium

<https://medium.com/@ashishpandey2062/llms-dont-have-memory-so-how-do-they-remember-be1e5d505d6a>

[\[73\]](https://www.reddit.com/r/MachineLearning/comments/1ftdby7/d_how_are_folks_building_conversational_retrieval/#:~:text=together%20and%20have%20an%20LLM,synthesize%20and%20answer)
[\[74\]](https://www.reddit.com/r/MachineLearning/comments/1ftdby7/d_how_are_folks_building_conversational_retrieval/#:~:text=1,to%20make%20this%20decision)
\[D\] How are folks building conversational Retrieval Augmented
Generation apps : r/MachineLearning

<https://www.reddit.com/r/MachineLearning/comments/1ftdby7/d_how_are_folks_building_conversational_retrieval/>
