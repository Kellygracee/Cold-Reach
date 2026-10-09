# Cold-Reach

Cold-Reach is a conversation-led marketing assistant domain core. It helps businesses describe their product, find public posts and comments where the product may be relevant, and prepare thoughtful replies for a human to review.

## Foundation & Technology Choice

- **Runtime & Language**: Node.js LTS with TypeScript (strict mode enabled).
- **Schema & Validation**: [Zod](https://zod.dev) for runtime validation and static type inference.
- **Testing**: [Vitest](https://vitest.dev) for test execution.
- **Linting & Formatting**: ESLint (v9 flat config) and Prettier.

## Data Contracts

1. **`ProductProfile`**: Captures product name, value proposition, problems solved, ideal customer description, excluded topics, and tone guidelines.
2. **`ConversationItem`**: Encapsulates conversation platform, author alias, excerpt, valid source permalink, timestamp, matched keywords, and explicit `sourceProvenance` (`DEMO` or `LIVE`).
3. **`Opportunity`**: Links a conversation to its relevance score (0–100), structured "why matched" explanation, reply draft state, and status (`NEW`, `REVIEWED`, `SKIPPED`, `RESPONDED`).
4. **`DraftReply`**: Holds reply text, value angle, transparency disclosure note, and human revision history (`editedBy: 'USER'`).

## Integrity & Compliance Rules

- **Strict Provenance**: Demo data must never be presented as live search results (`assertNotDemoAsLive`).
- **Bounded Relevance Scores**: Scores are enforced within the `[0, 100]` range.
- **Human-in-the-Loop Only**: The `RESPONDED` status requires explicit human confirmation (`dispatchMethod: 'MANUAL_EXTERNAL_POST'`). The application strictly does not perform automated direct messaging or automated posting.
- **Valid URLs and Timestamps**: All permalinks must use HTTP/HTTPS protocols and timestamps must conform to ISO 8601.

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
