import { ConversationItem, ConversationItemSchema } from '../contracts/conversation.js';
import {
  ConversationProvider,
  ConversationSearchResult,
  ConversationSearchResultItem,
  ConversationSearchResultSchema,
  SearchInput,
} from '../contracts/conversation-provider.js';
import { QueryTerm } from '../contracts/query.js';
import { detectExclusionConflicts, normalizeQueryTerm } from '../services/query-expansion.js';
import { DEMO_CONVERSATION_FIXTURES } from './fixtures/demo-conversations.js';

export class DemoProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoProviderError';
  }
}

/**
 * Computes deterministic relevance score for a conversation against matched query terms.
 * Bounded strictly within [0, 100].
 */
export function calculateDemoRelevanceScore(excerpt: string, matchedTerms: string[]): number {
  if (matchedTerms.length === 0) return 0;

  const normalizedExcerpt = normalizeQueryTerm(excerpt);

  // Base score: 40 points for first matched term, +15 for each additional matched term (up to 40)
  let score = 40 + Math.min(40, (matchedTerms.length - 1) * 15);

  // Exact multi-word phrase match bonus
  const hasMultiWordMatch = matchedTerms.some(
    (t) => t.includes(' ') && normalizedExcerpt.includes(t),
  );
  if (hasMultiWordMatch) {
    score += 10;
  }

  // Question / help inquiry bonus
  if (excerpt.includes('?')) {
    score += 5;
  }

  // Intent indicator bonus
  const intentWords = [
    'recommend',
    'recommendations',
    'looking for',
    'alternative',
    'best',
    'how to',
    'tool',
    'software',
    'struggling',
    'tired of',
    'need',
  ];
  const hasIntent = intentWords.some((w) => normalizedExcerpt.includes(w));
  if (hasIntent) {
    score += 5;
  }

  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Provider backed by curated, fictional conversation fixtures.
 * Strictly guarantees sourceProvenance: 'DEMO' on all results.
 */
export class DemoProvider implements ConversationProvider {
  readonly name = 'demo-provider';
  readonly provenance = 'DEMO' as const;

  private readonly fixtures: ConversationItem[];

  constructor(fixtures: ConversationItem[] = DEMO_CONVERSATION_FIXTURES) {
    // Strictly validate that all fixtures carry DEMO provenance
    for (const fixture of fixtures) {
      if (fixture.sourceProvenance !== 'DEMO') {
        throw new DemoProviderError(
          `DemoProvider integrity violation: fixture "${fixture.id}" has non-DEMO provenance "${fixture.sourceProvenance}". Demo results must never be labeled LIVE.`,
        );
      }
      ConversationItemSchema.parse(fixture);
    }
    this.fixtures = fixtures.map((f) => structuredClone(f));
  }

  /**
   * Searches demo conversations using query terms, supported filters, and excluded topics.
   */
  async search(input: SearchInput): Promise<ConversationSearchResult> {
    // Normalize query terms from string[], QueryTerm[], or single query string
    let rawQueryTerms: string[] = [];
    if (input.query && typeof input.query === 'string') {
      rawQueryTerms = [input.query];
    } else if (input.queryTerms && Array.isArray(input.queryTerms)) {
      rawQueryTerms = input.queryTerms.map((t: string | QueryTerm) =>
        typeof t === 'string' ? t : t.term,
      );
    }

    const queryTerms = rawQueryTerms.map(normalizeQueryTerm).filter((t) => t.length > 0);

    if (queryTerms.length === 0) {
      return {
        items: [],
        totalMatches: 0,
        providerName: this.name,
        sourceProvenance: 'DEMO',
      };
    }

    const excludedTopics = (input.excludedTopics ?? []).map((t) => t.trim()).filter(Boolean);
    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;
    const minScore = input.minRelevanceScore ?? 0;

    // Platform normalization
    const platformFilter = input.platform
      ? Array.isArray(input.platform)
        ? input.platform.map((p) => p.toLowerCase().trim())
        : [input.platform.toLowerCase().trim()]
      : null;

    const matchedCandidates: ConversationSearchResultItem[] = [];

    for (const fixture of this.fixtures) {
      const normalizedExcerpt = normalizeQueryTerm(fixture.contentExcerpt);

      // 1. Excluded topics filter: Discard any conversation containing excluded topics
      if (excludedTopics.length > 0) {
        const { hasConflict } = detectExclusionConflicts(fixture.contentExcerpt, excludedTopics);
        if (hasConflict) {
          continue;
        }
      }

      // 2. Platform filter
      if (platformFilter && !platformFilter.includes(fixture.platform.toLowerCase())) {
        continue;
      }

      // 3. Since filter
      if (input.since && new Date(fixture.timestamp).getTime() < new Date(input.since).getTime()) {
        continue;
      }

      // 4. Until filter
      if (input.until && new Date(fixture.timestamp).getTime() > new Date(input.until).getTime()) {
        continue;
      }

      // 5. Author alias filter
      if (
        input.authorAlias &&
        !fixture.authorAlias.toLowerCase().includes(input.authorAlias.toLowerCase().trim())
      ) {
        continue;
      }

      // 6. Query terms match
      const matched = queryTerms.filter((qt) => {
        if (qt.includes(' ')) {
          return normalizedExcerpt.includes(qt);
        }
        const wordRegex = new RegExp(`(^|[^a-z0-9])${qt}s?([^a-z0-9]|$)`, 'i');
        return wordRegex.test(normalizedExcerpt);
      });

      if (matched.length === 0) {
        continue;
      }

      // 7. Calculate relevance score
      const relevanceScore = calculateDemoRelevanceScore(fixture.contentExcerpt, matched);
      if (relevanceScore < minScore) {
        continue;
      }

      const conversation: ConversationItem = {
        ...fixture,
        matchedKeywords: matched,
        sourceProvenance: 'DEMO', // strictly DEMO
      };

      matchedCandidates.push({
        conversation,
        relevanceScore,
        matchedTerms: matched,
      });
    }

    // 8. Deterministic relevance ordering:
    // Primary: relevanceScore DESC
    // Secondary: timestamp DESC
    // Tertiary: id ASC
    matchedCandidates.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      const timeDiff =
        new Date(b.conversation.timestamp).getTime() - new Date(a.conversation.timestamp).getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return a.conversation.id.localeCompare(b.conversation.id);
    });

    const totalMatches = matchedCandidates.length;
    const paginatedItems = matchedCandidates.slice(offset, offset + limit);

    const result: ConversationSearchResult = {
      items: paginatedItems,
      totalMatches,
      providerName: this.name,
      sourceProvenance: 'DEMO',
    };

    return ConversationSearchResultSchema.parse(result);
  }
}

/**
 * Alias for DemoProvider to match various naming preferences.
 */
export const DemoConversationProvider = DemoProvider;
