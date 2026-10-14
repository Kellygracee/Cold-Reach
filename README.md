# Cold-Reach

Cold-Reach is a conversation-led marketing assistant domain core. It helps businesses describe their product, find public posts and comments where the product may be relevant, and prepare thoughtful replies for a human to review.

## Foundation & Technology Choice

- **Runtime & Language**: Node.js LTS with TypeScript (strict mode enabled).
- **Schema & Validation**: [Zod](https://zod.dev) for runtime validation and static type inference.
- **Testing**: [Vitest](https://vitest.dev) for test execution.
- **Linting & Formatting**: ESLint (v9 flat config) and Prettier.

## Data Contracts

1. **`ProductProfile`**: Captures product name, value proposition, optional product description, problems solved, ideal customer description, seed keywords, customer pain-point phrases, excluded topics, and tone guidelines.
2. **`ConversationItem`**: Encapsulates conversation platform, author alias, excerpt, valid source permalink, timestamp, matched keywords, and explicit `sourceProvenance` (`DEMO` or `LIVE`).
3. **`Opportunity`**: Links a conversation to its relevance score (0–100), structured "why matched" explanation, reply draft state, and status (`NEW`, `REVIEWED`, `SKIPPED`, `RESPONDED`).
4. **`DraftReply`**: Holds reply text, value angle, transparency disclosure note, and human revision history (`editedBy: 'USER'`).
5. **`QueryExpansionResult` & `QueryTerm`**: Holds organized search term clusters (`seed_terms`, `pain_points`, `solution_seeking`, `audience_context`) along with term provenance (`USER` vs. `APP`), explainable generation reasons, and exclusion conflict status.
6. **`ConversationSearchResult` & `ConversationSearchResultItem`**: Encapsulates matched conversations with deterministic relevance scores (`[0, 100]`), matched query terms, provider metadata, and strict `sourceProvenance: 'DEMO'`.

## Storage Architecture & Profile Service

- **Storage Choice**:
  - `ProfileRepository`: Abstraction interface for CRUD operations.
  - `FileProfileRepository`: The smallest appropriate persistence approach for the current standalone domain core. Stores profiles in a local formatted JSON file using atomic writes (`.tmp` write followed by atomic rename) with zero external database dependencies.
  - `InMemoryProfileRepository`: Ephemeral, zero-I/O in-memory store using deep-cloned records, ideal for unit testing and stateless runners.
- **`ProfileService`**: Manages profile lifecycle, ID generation (`crypto.randomUUID()`), timestamp auditing (`createdAt`, `updatedAt`), safe non-throwing validation (`validateProfile`), and CRUD operations.

## Deterministic Query Expansion Engine

The query expansion engine (`QueryExpansionEngine`) generates organized, explainable search term clusters from a profile without external APIs, LLMs, or web scraping:

1. **Clusters**:
   - `seed_terms`: Exact user seed keywords and closely anchored terms.
   - `pain_points`: Bottlenecks, venting, and frustration expressions derived from customer pain-point phrases and problems solved.
   - `solution_seeking`: Tool searches, recommendations, software inquiries, and workflow questions derived from seeds, problems solved, and value propositions.
   - `audience_context`: Target persona searches pairing ICP roles with seeds and problem domains.
2. **Provenance & Explainability**: Every term is labeled with `source: 'USER'` or `source: 'APP'`, its originating `sourceField`, and a clear human-readable `reason`.
3. **Excluded Topics & Conflict Handling**:
   - **User-entered terms** that conflict with excluded topics are **never silently discarded**; they are clearly flagged with `hasConflict: true`, listed conflicting topics, and a prominent warning.
   - **App-suggested terms** that conflict are filtered out from active search clusters and audited in `filteredTerms`.
   - Word boundary pattern matching avoids false positive substring collisions (e.g., `free` matches `free tool` but not `freelance`).
4. **Deterministic & Repeatable**: Pure deterministic algorithms guarantee identical outputs, ordering, and deterministic term IDs across repeated runs.
5. **Review & Edit**: Built-in utilities to add custom terms (`addTerm`), remove terms (`removeTerm`), update terms (`updateTerm`), and export active search strings (`getActiveTermStrings`).

## Conversation Provider Contract & Demo Search (Phase 3A)

- **`ConversationProvider` Interface**: Typed contract for searching conversation items across sources (`search(input: SearchInput): Promise<ConversationSearchResult>`).
- **`DemoProvider`**:
  - Backed by curated, fictional conversation fixtures (`DEMO_CONVERSATION_FIXTURES`) across Reddit, Twitter, Hacker News, and LinkedIn.
  - Search filtering supported: Phase 2 query terms (`string[]`, `QueryTerm[]`, or query string), `excludedTopics` filtering, `platform`, `since` / `until` timestamps, `authorAlias`, `minRelevanceScore`, and `limit` / `offset` pagination.
  - **Deterministic Relevance Ordering**: Computes bounded scores (`[0, 100]`) based on matched query terms, multi-word phrase bonuses, and conversational intent indicators. Orders results by relevance score descending, then timestamp descending, then ID ascending.
  - **Strict DEMO Provenance**: Every returned conversation is explicitly tagged `sourceProvenance: 'DEMO'`. Demo results are guarded by contract and runtime assertion (`assertNotDemoAsLive`) so they can never be presented as LIVE results.
  - Pure local domain logic: zero UI, external APIs, scrapers, or live platform posting.

## Live Conversation Providers (Phase 3B)

Phase 3B introduces production-ready live search providers connecting to public web APIs and syndication feeds. Every item returned by live providers is tagged with `sourceProvenance: 'LIVE'` (verified by `assertNotDemoAsLive`). Fixture or fallback data is strictly prohibited from being labeled LIVE.

| Provider                 | Endpoint / Protocol                                                        | Usability Status                | Authentication / Setup                                                                                                          |
| :----------------------- | :------------------------------------------------------------------------- | :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------ |
| **`HackerNewsProvider`** | Algolia HN Search API (`https://hn.algolia.com/api/v1/search`)             | **READY** (Zero setup)          | None required. Public official API.                                                                                             |
| **`BlueskyProvider`**    | AT Protocol (`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts`) | **READY** (Zero setup)          | None required. Public read-only post search.                                                                                    |
| **`RedditProvider`**     | Reddit OAuth2 Data API (`https://oauth.reddit.com/search.json`)            | **CONFIGURED / NOT_CONFIGURED** | Requires registered Reddit App OAuth credentials (`clientId`, `clientSecret`). Returns clear `NOT_CONFIGURED` state if omitted. |
| **`RssFeedProvider`**    | RSS 2.0 & Atom 1.0 Feeds                                                   | **CONFIGURED / NOT_CONFIGURED** | Requires one or more valid feed URLs. Returns `NOT_CONFIGURED` if empty.                                                        |

### Network & Security Protections

- **SSRF Prevention**: `validateSafePublicUrl` validates all user-supplied feed URLs, blocking requests to `localhost`, loopback addresses (`127.0.0.0/8`, `::1`), link-local/cloud metadata (`169.254.169.254`), and private IPv4 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
- **Typed Error Handling**: Specific error classes for `ProviderRateLimitError` (HTTP 429 with retry delay), `ProviderAuthenticationError` (HTTP 401/403), `ProviderTimeoutError`, `ProviderMalformedResponseError`, and `ProviderSecurityError`.
- **Zero Heavy Scraping**: Uses only permitted official APIs and XML syndication feeds without browser automation or unauthorized scraping.

## Relevance Analysis & Opportunity Attribution (Phase 4)

Phase 4 evaluates incoming conversations against the user's `ProductProfile` and Phase 2 query terms to attribute deduplicated `Opportunity` records with explainable relevance evidence.

1. **Deterministic Scoring Engine (`RelevanceAnalysisEngine`)**:
   - Computes a bounded score in `[0, 100]` evaluating:
     - **Direct Problem Solved / Pain Point Match (0–35 pts)**: Identifies whether the author is facing a problem solved by the product.
     - **Query Term Alignment (0–30 pts)**: Matches against Phase 2 search clusters (`seed_terms`, `solution_seeking`, `pain_points`, `audience_context`).
     - **Intent & Buying Signals (0–20 pts)**: Detects requests for tool recommendations, alternatives, questions (`?`), or bottleneck venting.
     - **Audience / ICP Fit (0–15 pts)**: Matches target roles/personas from `idealCustomerDescription`.
     - **Exclusion Conflict Penalty**: Conversations matching `excludedTopics` receive a -60 point penalty (capped to max 15) with an explicit reputation warning.
   - **No Silent Discards**: Low-scoring candidates are never silently dropped; the score communicates relevance to the operator.
2. **Structured `whyMatched` Evidence**:
   - `summary`: High-level explanation of problem alignment or peripheral mention.
   - `matchedNeeds`: Concrete list of problem statements or capabilities matched.
   - `relevanceRationale`: Grounded in `profile.problemsSolved` and `profile.valueProposition` without inventing unverified product claims.
   - `contextSnippet`: Key sentence or snippet from the conversation excerpt.
3. **Opportunity Attribution & Deduplication (`OpportunityService`)**:
   - Initialized in status `NEW` with `replyDraft: null` (reply drafting not started).
   - Preserves candidate's original `sourcePermalink` and provenance (`DEMO` or `LIVE`).
   - Deduplicates within batches and across runs by conversation ID or permalink.
   - When an existing opportunity is re-evaluated, updates `relevanceScore`, `whyMatched`, and `updatedAt` while preserving original `id`, `createdAt`, `status` (e.g., if already `REVIEWED`), and draft state.
   - Supports storage via `InMemoryOpportunityRepository` and `FileOpportunityRepository` (atomic file persistence).

## Contextual Reply Drafting & Human Review (Phase 5)

Phase 5 builds a grounded, compliant reply drafting service (`ReplyDraftingService`) and human reviewer workflow.

1. **Grounded Prompt Construction (`DraftPromptBuilder`)**:
   - **Answer First**: Instructions strictly require addressing the user's situation or question directly with actionable advice before mentioning any tool.
   - **Relevant Mention Only**: The product is introduced only when directly relevant to what was asked.
   - **Strictly Grounded (No Hallucinations)**: Limits product capabilities, problems solved, and value angles strictly to information in the `ProductProfile`. Prohibits inventing benchmarks, statistics, pricing, or unverified claims.
   - **No Handle Inferences**: Prohibits guessing or assuming background, company size, credentials, or audience size from author handles (e.g., `@dan_podcaster`). Only explicit text in the conversation excerpt is used.
   - **Transparency Disclosure Note**: Every draft includes a standardized disclosure note disclosing product affiliation (`DraftPromptBuilder.buildTransparencyNote`).

2. **Injectable Draft Generation Provider (`DraftGenerationProvider`)**:
   - `DefaultAiDraftProvider`: Inspects environment variables (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`). When unconfigured, cleanly reports `isConfigured() === false` and raises `DraftProviderNotConfiguredError` rather than inventing mock credentials or masquerading as live AI.
   - `MockDraftProvider`: Deterministic, grounded mock provider for evaluation, tests, and local workflows.
   - Any custom LLM client can be injected via `new ReplyDraftingService({ provider: customProvider })`.

3. **Low-Relevance Gating (< 40)**:
   - For opportunities with relevance scores below 40, draft generation is blocked with `LowScoreOverrideRequiredError` unless explicit confirmation (`allowLowScoreOverride: true`) is provided.

4. **Human Review, Edits & Revision History**:
   - `generateDraft`: Transitions opportunity status from `NEW` to `REVIEWED` (never `RESPONDED`).
   - `editDraft`: Saves human edits with full chronological audit tracking in `revisionHistory` (`editedBy: 'USER'`, `previousText`, `newText`, `editedAt`, `changeSummary`).
   - `copyDraft`: Prepares formatted clipboard content (incorporating the transparency note) and character count for manual posting.
   - `getReviewData`: Returns complete review payload for UI rendering (opportunity, candidate, whyMatched evidence, relevance score, draft, permalink, override status).
   - `setReviewStatus`: Transitions status between `NEW`, `REVIEWED`, and `SKIPPED`. Rejects `RESPONDED`, enforcing that manual response confirmation belongs to the dedicated manual dispatch audit workflow.

5. **No-Send Guarantees**:
   - Strictly zero automated posting, messaging, commenting, or DMs.
   - `hasAutomatedDispatchCapability()` returns `false`.

## Opportunity Tracking & Pipeline Service (Phase 6)

Phase 6 provides reliable opportunity lifecycle tracking, audit persistence, and filterable pipeline metrics through `PipelineService`.

1. **State Machine & Status Transitions (`ALLOWED_STATUS_TRANSITIONS`)**:
   - `NEW` $\rightarrow$ `REVIEWED`, `SKIPPED`, `RESPONDED`
   - `REVIEWED` $\rightarrow$ `RESPONDED`, `SKIPPED`, `NEW`
   - `SKIPPED` $\rightarrow$ `NEW`, `REVIEWED`
   - `RESPONDED` $\rightarrow$ None (terminal audit state).
   - Any invalid transition (e.g., `SKIPPED -> RESPONDED`, or attempting to transition away from `RESPONDED`) is blocked with `InvalidStatusTransitionError` or `AuditImmutabilityError`.

2. **Manual Response Auditing & Immutability**:
   - Transitioning to `RESPONDED` requires a verified `manualResponseAudit` record:
     - `manualDispatchConfirmed: true` (strictly confirms human external dispatch).
     - `dispatchMethod: 'MANUAL_EXTERNAL_POST'` (verifies action took place outside the application).
     - `markedSentAt`: Valid ISO 8601 timestamp.
   - **Audit Immutability**: Once an opportunity is marked `RESPONDED`, its audit record cannot be modified, overwritten, or deleted. Attempting to alter audit details throws `AuditImmutabilityError`.

3. **Status History & Review Notes Persistence**:
   - Each valid transition appends a `StatusHistoryEntry` (`id`, `fromStatus`, `toStatus`, `timestamp`, `reason`, `changedBy: 'USER'`).
   - Human operators can record and update `userReviewNotes` independently or during transitions.
   - Both in-memory and disk persistence (`FileOpportunityRepository`) maintain complete status history and review notes across process restarts.

4. **Filterable Pipeline Metrics (`getPipelineMetrics`)**:
   - Real-time aggregation grounded strictly in stored records.
   - **Metrics Computed**:
     - `totalOpportunities`: Total matching opportunities.
     - `statusBreakdown`: Counts for `new`, `reviewed`, `skipped`, and `responded`.
     - `conversionRates`: `responseRateOverTotal`, `responseRateOverReviewed`, and `skipRate`.
     - `platformBreakdown`: Distribution across platforms (e.g., Hacker News, Reddit, Bluesky, RSS).
     - `provenanceBreakdown`: Split between `demo` and `live`.
     - `relevanceDistribution`: Average, min, max scores, plus tiers (`high` $\ge 70$, `medium` $40..69$, `low` $< 40$).
     - `auditSummary`: Total external responses, verified manual dispatches, and guaranteed `appDispatchedCount: 0`.
   - **Filters Supported**: By status (single or multiple), platform, provenance, relevance score range, and date range (`startDate`, `endDate` over `createdAt`, `updatedAt`, or `markedSentAt`).

## Phase 7: API Integration for the Stitch Frontend

Cold-Reach provides a typed, zero-dependency REST API layer (`ColdReachApiServer`) and an SDK client (`ColdReachApiClient`) specifically designed to power Stitch-generated frontend interfaces.

### Architecture & Design Principles

- **Thin Typed Layer**: Reuses the core domain services (`ProfileService`, `QueryExpansionEngine`, `DemoProvider`, `OpportunityService`, `ReplyDraftingService`, `PipelineService`) and schemas without duplicating business logic.
- **Consistent Response Shapes**:
  - Success responses: `{ success: true, data: T }`
  - Paginated responses: `{ success: true, data: { items: T[], pagination: { page, pageSize, totalItems, totalPages, hasNextPage, hasPrevPage } } }`
  - Error responses: `{ success: false, error: { code: string, message: string, details?: unknown } }`
- **Development Boundary**: Defaults to binding strictly to `127.0.0.1` (port 3001). Exposing beyond local development requires:
  1. An authentication provider / session layer (e.g. JWT or OAuth2 bearer tokens).
  2. TLS / HTTPS termination via a reverse proxy (e.g. Caddy, NGINX).
  3. API rate limiting and CORS policy restricted to production domain origins.
- **Configured CORS**: Supports preflight `OPTIONS` (HTTP 204) and credentials for designated frontend origins (`http://localhost:3000`, `http://localhost:5173`, etc.).
- **OpenAPI 3.1.0 Contract**: A comprehensive typed OpenAPI specification is served at `GET /api/openapi.json` for frontend client generation.

### API Endpoints Summary

| Method | Path                                 | Description                                                                          |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------ |
| `GET`  | `/api/openapi.json`                  | OpenAPI 3.1.0 specification document                                                 |
| `GET`  | `/api/profiles`                      | List all product profiles                                                            |
| `POST` | `/api/profiles`                      | Create a product profile                                                             |
| `GET`  | `/api/profiles/:id`                  | Retrieve product profile by ID                                                       |
| `PUT`  | `/api/profiles/:id`                  | Update product profile by ID                                                         |
| `POST` | `/api/query-expansion`               | Deterministic query expansion for a profile                                          |
| `GET`  | `/api/providers`                     | Query provider registry status & capabilities                                        |
| `POST` | `/api/search`                        | Search conversations across providers with `DEMO`/`LIVE` provenance                  |
| `GET`  | `/api/opportunities`                 | List opportunities with filtering (status, score, platform, provenance) & pagination |
| `GET`  | `/api/opportunities/:id`             | Get opportunity details                                                              |
| `POST` | `/api/opportunities/attribute`       | Evaluate & attribute a single conversation candidate                                 |
| `POST` | `/api/opportunities/attribute-batch` | Batch evaluate & attribute multiple conversation candidates                          |
| `GET`  | `/api/opportunities/:id/draft`       | Retrieve existing reply draft                                                        |
| `POST` | `/api/opportunities/:id/draft`       | Generate contextual draft (gated on score $< 40$ with explicit override)             |
| `PUT`  | `/api/opportunities/:id/draft`       | Edit draft (records human revision history with `editedBy: 'USER'`)                  |
| `GET`  | `/api/opportunities/:id/review`      | Retrieve full review data bundle (context + whyMatched + transparency note)          |
| `GET`  | `/api/opportunities/:id/source-link` | Retrieve validated external permalink                                                |
| `GET`  | `/api/opportunities/:id/copy`        | Get formatted payload ready for manual external pasting                              |
| `POST` | `/api/opportunities/:id/status`      | Execute state machine status transition (`NEW`, `REVIEWED`, `SKIPPED`, `RESPONDED`)  |
| `POST` | `/api/opportunities/:id/respond`     | Explicit manual response confirmation (`dispatchMethod: 'MANUAL_EXTERNAL_POST'`)     |
| `PUT`  | `/api/opportunities/:id/notes`       | Update human operator review notes                                                   |
| `GET`  | `/api/opportunities/:id/history`     | Audit trail of status transitions                                                    |
| `GET`  | `/api/pipeline/metrics`              | Real-time aggregated pipeline metrics and audit statistics                           |

### Integrity & Compliance Rules

- **Strict Provenance**: Demo data must never be presented as live search results (`assertNotDemoAsLive`). Every search item and opportunity explicitly tags provenance (`DEMO` or `LIVE`).
- **Bounded Relevance Scores**: Scores are enforced within the `[0, 100]` range.
- **Human-in-the-Loop Only**: The `RESPONDED` status requires explicit human confirmation (`dispatchMethod: 'MANUAL_EXTERNAL_POST'`). The application strictly does not perform automated direct messaging or automated posting.
- **Audit Immutability**: `manualResponseAudit` records are immutable once saved; once an opportunity transitions to `RESPONDED`, it cannot transition to any other status.
- **Valid URLs and Timestamps**: All permalinks must use HTTP/HTTPS protocols and timestamps must conform to ISO 8601.

## Phase 8: Stitch Frontend Implementation

ColdReach includes a production frontend implemented directly from the official Stitch project (`15552703017280237757`).

### Visual Design System

- **Warm Tactile Neumorphism**: Employs an organic cream canvas (`#fff8f3`), deep teal primary accents (`#005f73`), subtle warm amber highlights, and dual-layer neumorphic elevation shadows (`neu-raised`, `neu-raised-sm`, `neu-inset`, `neu-pressed`, `neu-pill-active`).
- **Typography & Iconography**: Loaded with Google Fonts [Manrope](https://fonts.google.com/specimen/Manrope) (weights 400, 500, 600, 700, 800) and Google Material Symbols Outlined.
- **Theme Support**: Built-in Light and Dark mode companion palette (`#111827`, `#0d131f`) with adapted neumorphic shadow contrasts.

### Screens Implemented

The application provides a responsive single-page architecture serving all six screens from the Stitch design:

1. **Agent Chat (`#chat`)**:
   - **Conversation Discovery Chat**: Real-time agent chat interface for discovering leads conversationally.
   - **Multi-Stage Synthesis Progression**: Live progress bar and status steps for Intent Extraction, Source Connector polling, Semantic Relevance Scoring, and Grounded Reply Synthesis.
   - **Real Provider Status Pills**: Displays live operational status (Hacker News, Bluesky, Reddit, RSS) during searches.
   - **Search Cancellation**: Full in-flight cancellation via `AbortController`.
   - **Inline Opportunity Review**: Displays matched evidence, relevance score badges, grounded reply draft with transparency disclosure, external source permalink launcher, and one-click copy to clipboard.

2. **Dashboard (`#dashboard`)**:
   - **Live Pipeline KPIs**: Real-time cards for Active Searches, High Intent Leads, Manual Outreach Marked Sent, and Human Response Rate.
   - **Weekly Volume Trend Chart**: Embedded vector SVG chart illustrating discovery and response curves.
   - **Tasks Requiring Review**: Prioritized opportunity list with quick-action links to inspect and review drafts.
   - **Source Health**: Live status overview of connected and unconfigured conversation providers.

3. **Opportunities / Discovery (`#opportunities`)**:
   - **Master-Detail Discovery Layout**: Browse opportunities with status filter tabs (_All_, _High Intent_, _Needs Review_, _Replied_, _Skipped_), text search, and platform badges.
   - **Candidate Analysis & Evidence**: Full conversation excerpt, author alias, timestamp, whyMatched evidence summary, and matched needs pills.
   - **Inline Grounded Draft Editor**: Edit drafts directly with character counting and automatic human revision tracking (`editedBy: 'USER'`).
   - **External Source Launcher**: Direct link to the conversation on its originating platform.
   - **Manual External Response Modal**: Strict human confirmation workflow before transitioning to `RESPONDED` (`dispatchMethod: 'MANUAL_EXTERNAL_POST'`).
   - **Operator Notes**: Save operator review notes directly to the opportunity record.

4. **Product Profile (`#product-profile`)**:
   - **Profile Management**: Full form for Product Name, Value Proposition, Description, Ideal Customer Profile, and Tone Guidelines.
   - **Interactive Tag / Chip Editors**: Add and remove Problem Solved statements, Customer Pain Points, Seed Keywords, and Excluded Topics.
   - **Conflict Detection**: Real-time warning when seed keywords conflict with excluded topics.
   - **Live Query Expansion Tester**: Tests the deterministic query engine against the current profile, displaying generated clusters (_Seed Terms_, _Pain Points_, _Solution Seeking_, _Audience Context_) with generation reasons and provenance tags.

5. **Analytics (`#analytics`)**:
   - **Pipeline Conversion Metrics**: Total opportunities, status breakdown, and response conversion rates.
   - **Conversion Funnel Visualization**: Visual progression from Discovered $\rightarrow$ High Intent $\rightarrow$ Reviewed $\rightarrow$ Manually Responded.
   - **Platform & Provenance Breakdown**: Distribution across Hacker News, Bluesky, Reddit, and RSS, with strict separation between `LIVE` and `DEMO` sources.
   - **Raw Data Export**: One-click download of the complete pipeline metrics JSON snapshot.

6. **Settings / Source Connectors (`#settings`)**:
   - **Appearance Customizer**: One-click toggle between Light and Dark mode themes.
   - **Provider Connector Registry**: Displays live status and capabilities for all supported sources:
     - **Hacker News**: Live public search (Algolia API).
     - **Bluesky**: Live public search (AT Protocol).
     - **Reddit**: Configured or Unconfigured (OAuth2 credentials).
     - **RSS / Atom**: Configured or Unconfigured (valid feed URLs).
   - **Compliance & Dispatch Policy**: Read-only verification that automated posting is disabled (`appDispatchedCount: 0`) and all outreach is strictly manual.

### Running the Application

Build the project and start the integrated server:

```bash
# 1. Compile TypeScript
npm run build

# 2. Start ColdReach Server (serves both API and Frontend at http://127.0.0.1:3001)
npm start
```

Open your browser to `http://127.0.0.1:3001` to access the ColdReach web interface.

## Available Verification Checks

```bash
# Type check without emitting files
npm run typecheck

# Run test suite
npm run test

# Lint source files
npm run lint

# Check formatting
npm run format:check

# Format files
npm run format

# Compile TypeScript to dist/
npm run build
```
