import { ConversationItem, ConversationItemSchema } from '../contracts/conversation.js';
import {
  ConversationProvider,
  ConversationSearchResult,
  ConversationSearchResultItem,
  ConversationSearchResultSchema,
  ProviderMalformedResponseError,
  ProviderStatus,
  SearchInput,
} from '../contracts/conversation-provider.js';
import { QueryTerm } from '../contracts/query.js';
import { detectExclusionConflicts, normalizeQueryTerm } from '../services/query-expansion.js';
import { calculateDemoRelevanceScore } from './demo-provider.js';
import { parseJsonResponse, safeFetch } from './utils/network.js';

export interface HackerNewsProviderConfig {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

interface AlgoliaHit {
  objectID: string;
  title?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  author?: string;
  created_at?: string;
  created_at_i?: number;
  url?: string | null;
}

interface AlgoliaSearchResponse {
  hits?: AlgoliaHit[];
  nbHits?: number;
}

/**
 * Live provider for Hacker News discussions powered by the official Algolia search API.
 * Free and publicly accessible without authentication.
 */
export class HackerNewsProvider implements ConversationProvider {
  readonly name = 'hackernews';
  readonly provenance = 'LIVE' as const;

  private readonly baseUrl: string;
  private readonly fetchFn?: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: HackerNewsProviderConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://hn.algolia.com/api/v1/search';
    this.fetchFn = config.fetchFn;
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  getStatus(): ProviderStatus {
    return {
      state: 'READY',
      configured: true,
      reason: 'Official Hacker News Algolia search API is publicly accessible without credentials.',
    };
  }

  async search(input: SearchInput): Promise<ConversationSearchResult> {
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
        sourceProvenance: 'LIVE',
        providerStatus: 'READY',
      };
    }

    const excludedTopics = (input.excludedTopics ?? []).map((t) => t.trim()).filter(Boolean);
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const offset = input.offset ?? 0;
    const minScore = input.minRelevanceScore ?? 0;

    // Build Algolia query
    const queryString = queryTerms.join(' ');
    const params = new URLSearchParams({
      query: queryString,
      tags: '(story,comment)',
      hitsPerPage: String(limit + offset),
    });

    if (input.since) {
      const timestampSeconds = Math.floor(new Date(input.since).getTime() / 1000);
      if (Number.isFinite(timestampSeconds)) {
        params.append('numericFilters', `created_at_i>=${timestampSeconds}`);
      }
    }

    const requestUrl = `${this.baseUrl}?${params.toString()}`;

    const response = await safeFetch(requestUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      fetchFn: this.fetchFn,
      timeoutMs: this.timeoutMs,
      providerName: this.name,
    });

    const data = await parseJsonResponse<AlgoliaSearchResponse>(response, this.name);

    if (!Array.isArray(data.hits)) {
      throw new ProviderMalformedResponseError(
        'Expected "hits" array in Algolia search response.',
        this.name,
      );
    }

    const matchedCandidates: ConversationSearchResultItem[] = [];

    for (const hit of data.hits) {
      if (!hit.objectID) continue;

      let rawExcerpt = '';
      if (hit.comment_text) {
        rawExcerpt = hit.comment_text;
      } else if (hit.title && hit.story_text) {
        rawExcerpt = `${hit.title}\n\n${hit.story_text}`;
      } else {
        rawExcerpt = hit.title || hit.story_text || '';
      }

      // Strip basic HTML tags from Algolia comments/stories
      const contentExcerpt = rawExcerpt
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!contentExcerpt) continue;

      // 1. Excluded topics check
      if (excludedTopics.length > 0) {
        const { hasConflict } = detectExclusionConflicts(contentExcerpt, excludedTopics);
        if (hasConflict) {
          continue;
        }
      }

      // 2. Author alias check
      if (
        input.authorAlias &&
        !(hit.author || '').toLowerCase().includes(input.authorAlias.toLowerCase().trim())
      ) {
        continue;
      }

      // 3. Query term matching
      const normalizedExcerpt = normalizeQueryTerm(contentExcerpt);
      const matched = queryTerms.filter((qt) => {
        if (qt.includes(' ')) {
          return normalizedExcerpt.includes(qt);
        }
        const regex = new RegExp(`(^|[^a-z0-9])${qt}s?([^a-z0-9]|$)`, 'i');
        return regex.test(normalizedExcerpt);
      });

      if (matched.length === 0) {
        continue;
      }

      // 4. Calculate deterministic relevance score
      const relevanceScore = calculateDemoRelevanceScore(contentExcerpt, matched);
      if (relevanceScore < minScore) {
        continue;
      }

      const timestamp = hit.created_at
        ? new Date(hit.created_at).toISOString()
        : hit.created_at_i
          ? new Date(hit.created_at_i * 1000).toISOString()
          : new Date().toISOString();

      const candidateConversation: ConversationItem = {
        id: `hn-${hit.objectID}`,
        platform: 'hackernews',
        authorAlias: hit.author || 'anonymous',
        contentExcerpt,
        sourcePermalink: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        timestamp,
        matchedKeywords: matched,
        sourceProvenance: 'LIVE',
      };

      // Ensure valid contract
      const validConversation = ConversationItemSchema.parse(candidateConversation);

      matchedCandidates.push({
        conversation: validConversation,
        relevanceScore,
        matchedTerms: matched,
      });
    }

    // Sort deterministically: relevanceScore DESC, timestamp DESC, id ASC
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
      sourceProvenance: 'LIVE',
      providerStatus: 'READY',
    };

    return ConversationSearchResultSchema.parse(result);
  }
}
