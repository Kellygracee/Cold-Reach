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

export interface BlueskyProviderConfig {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

interface BlueskyAuthor {
  handle: string;
  displayName?: string;
}

interface BlueskyRecord {
  text: string;
  createdAt: string;
}

interface BlueskyPost {
  uri: string;
  cid: string;
  author: BlueskyAuthor;
  record: BlueskyRecord;
}

interface BlueskySearchResponse {
  posts?: BlueskyPost[];
  cursor?: string;
}

/**
 * Live provider for Bluesky conversations powered by the public AT Protocol searchPosts endpoint.
 * Accessible without credentials for public read-only search.
 */
export class BlueskyProvider implements ConversationProvider {
  readonly name = 'bluesky';
  readonly provenance = 'LIVE' as const;

  private readonly baseUrl: string;
  private readonly fetchFn?: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: BlueskyProviderConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts';
    this.fetchFn = config.fetchFn;
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  getStatus(): ProviderStatus {
    return {
      state: 'READY',
      configured: true,
      reason: 'Bluesky public searchPosts endpoint is publicly accessible without credentials.',
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
    const limit = Math.min(100, Math.max(1, input.limit ?? 25));
    const offset = input.offset ?? 0;
    const minScore = input.minRelevanceScore ?? 0;

    const queryString = queryTerms.join(' ');
    const params = new URLSearchParams({
      q: queryString,
      sort: 'latest',
      limit: String(Math.min(100, limit + offset)),
    });

    if (input.since) {
      params.append('since', input.since);
    }
    if (input.until) {
      params.append('until', input.until);
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

    const data = await parseJsonResponse<BlueskySearchResponse>(response, this.name);

    if (!Array.isArray(data.posts)) {
      throw new ProviderMalformedResponseError(
        'Expected "posts" array in Bluesky search response.',
        this.name,
      );
    }

    const matchedCandidates: ConversationSearchResultItem[] = [];

    for (const post of data.posts) {
      if (!post.record || !post.record.text || !post.author) continue;

      const contentExcerpt = post.record.text.trim();
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
        !post.author.handle.toLowerCase().includes(input.authorAlias.toLowerCase().trim())
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

      // 4. Relevance score calculation
      const relevanceScore = calculateDemoRelevanceScore(contentExcerpt, matched);
      if (relevanceScore < minScore) {
        continue;
      }

      // Extract rkey from at-uri (at://did:plc:.../app.bsky.feed.post/<rkey>)
      const rkey = post.uri.split('/').pop() || post.cid;
      const permalink = `https://bsky.app/profile/${post.author.handle}/post/${rkey}`;

      const candidateConversation: ConversationItem = {
        id: `bsky-${post.cid || rkey}`,
        platform: 'bluesky',
        authorAlias: post.author.handle,
        contentExcerpt,
        sourcePermalink: permalink,
        timestamp: post.record.createdAt || new Date().toISOString(),
        matchedKeywords: matched,
        sourceProvenance: 'LIVE',
      };

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
