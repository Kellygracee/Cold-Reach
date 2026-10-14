import { ConversationItem, ConversationItemSchema } from '../contracts/conversation.js';
import {
  ConversationProvider,
  ConversationSearchResult,
  ConversationSearchResultItem,
  ConversationSearchResultSchema,
  ProviderConfigurationError,
  ProviderMalformedResponseError,
  ProviderStatus,
  SearchInput,
} from '../contracts/conversation-provider.js';
import { QueryTerm } from '../contracts/query.js';
import { detectExclusionConflicts, normalizeQueryTerm } from '../services/query-expansion.js';
import { calculateDemoRelevanceScore } from './demo-provider.js';
import { parseJsonResponse, safeFetch } from './utils/network.js';

export interface RedditProviderConfig {
  clientId?: string;
  clientSecret?: string;
  userAgent?: string;
  accessToken?: string;
  tokenEndpoint?: string;
  searchEndpoint?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  throwIfNotConfigured?: boolean;
}

interface RedditTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface RedditPostData {
  id: string;
  title: string;
  selftext?: string;
  author: string;
  permalink: string;
  created_utc: number;
}

interface RedditSearchResponse {
  data?: {
    children?: Array<{
      kind: string;
      data: RedditPostData;
    }>;
  };
}

/**
 * Live provider for Reddit discussions using the official Reddit OAuth2 Data API.
 * Requires registered client credentials (clientId and clientSecret).
 * Returns NOT_CONFIGURED state when credentials are not configured.
 */
export class RedditProvider implements ConversationProvider {
  readonly name = 'reddit';
  readonly provenance = 'LIVE' as const;

  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly userAgent: string;
  private readonly tokenEndpoint: string;
  private readonly searchEndpoint: string;
  private readonly fetchFn?: typeof fetch;
  private readonly timeoutMs: number;
  private readonly throwIfNotConfigured: boolean;

  private cachedToken?: string;
  private tokenExpiresAt: number = 0;

  constructor(config: RedditProviderConfig = {}) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.userAgent = config.userAgent ?? 'ColdReach:v0.1.0 (by /u/coldreach)';
    this.tokenEndpoint = config.tokenEndpoint ?? 'https://www.reddit.com/api/v1/access_token';
    this.searchEndpoint = config.searchEndpoint ?? 'https://oauth.reddit.com/search.json';
    this.fetchFn = config.fetchFn;
    this.timeoutMs = config.timeoutMs ?? 10000;
    this.throwIfNotConfigured = config.throwIfNotConfigured ?? false;

    if (config.accessToken) {
      this.cachedToken = config.accessToken;
      this.tokenExpiresAt = Date.now() + 3600 * 1000;
    }
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret) || Boolean(this.cachedToken);
  }

  getStatus(): ProviderStatus {
    if (!this.isConfigured()) {
      return {
        state: 'NOT_CONFIGURED',
        configured: false,
        reason:
          'Reddit API requires registered OAuth2 client credentials (clientId and clientSecret). Set up a Reddit App to obtain credentials.',
      };
    }
    return {
      state: 'READY',
      configured: true,
      reason: 'Reddit OAuth2 client credentials are configured.',
    };
  }

  private async getValidAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.cachedToken;
    }

    if (!this.clientId || !this.clientSecret) {
      throw new ProviderConfigurationError(
        'Cannot fetch Reddit access token: clientId and clientSecret are missing.',
        this.name,
      );
    }

    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'client_credentials' });

    const response = await safeFetch(this.tokenEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      body: body.toString(),
      fetchFn: this.fetchFn,
      timeoutMs: this.timeoutMs,
      providerName: this.name,
    });

    const tokenData = await parseJsonResponse<RedditTokenResponse>(response, this.name);
    if (!tokenData.access_token) {
      throw new ProviderMalformedResponseError(
        'Expected "access_token" in Reddit token response.',
        this.name,
      );
    }

    this.cachedToken = tokenData.access_token;
    this.tokenExpiresAt = Date.now() + (tokenData.expires_in ?? 3600) * 1000;
    return this.cachedToken;
  }

  async search(input: SearchInput): Promise<ConversationSearchResult> {
    // If not configured, report NOT_CONFIGURED state cleanly
    if (!this.isConfigured()) {
      if (this.throwIfNotConfigured) {
        throw new ProviderConfigurationError(
          'Reddit provider is not configured with required API credentials.',
          this.name,
        );
      }
      return {
        items: [],
        totalMatches: 0,
        providerName: this.name,
        sourceProvenance: 'LIVE',
        providerStatus: 'NOT_CONFIGURED',
        statusReason:
          'Reddit API requires registered OAuth2 client credentials (clientId and clientSecret).',
      };
    }

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

    const token = await this.getValidAccessToken();

    const queryString = queryTerms.join(' ');
    const params = new URLSearchParams({
      q: queryString,
      sort: 'new',
      limit: String(Math.min(100, limit + offset)),
      raw_json: '1',
    });

    const requestUrl = `${this.searchEndpoint}?${params.toString()}`;

    const response = await safeFetch(requestUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': this.userAgent,
        Accept: 'application/json',
      },
      fetchFn: this.fetchFn,
      timeoutMs: this.timeoutMs,
      providerName: this.name,
    });

    const searchData = await parseJsonResponse<RedditSearchResponse>(response, this.name);

    if (!searchData.data || !Array.isArray(searchData.data.children)) {
      throw new ProviderMalformedResponseError(
        'Expected data.children array in Reddit search response.',
        this.name,
      );
    }

    const matchedCandidates: ConversationSearchResultItem[] = [];

    for (const child of searchData.data.children) {
      const post = child.data;
      if (!post || !post.id || !post.title) continue;

      const fullText = post.selftext ? `${post.title}\n\n${post.selftext}` : post.title;
      const contentExcerpt = fullText.trim();
      if (!contentExcerpt) continue;

      // 1. Excluded topics filter
      if (excludedTopics.length > 0) {
        const { hasConflict } = detectExclusionConflicts(contentExcerpt, excludedTopics);
        if (hasConflict) {
          continue;
        }
      }

      // 2. Author alias filter
      if (
        input.authorAlias &&
        !post.author.toLowerCase().includes(input.authorAlias.toLowerCase().trim())
      ) {
        continue;
      }

      // 3. Since/until filters
      const postTimestampMs = post.created_utc * 1000;
      if (input.since && postTimestampMs < new Date(input.since).getTime()) {
        continue;
      }
      if (input.until && postTimestampMs > new Date(input.until).getTime()) {
        continue;
      }

      // 4. Query term match
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

      // 5. Relevance score calculation
      const relevanceScore = calculateDemoRelevanceScore(contentExcerpt, matched);
      if (relevanceScore < minScore) {
        continue;
      }

      const permalink = post.permalink.startsWith('http')
        ? post.permalink
        : `https://reddit.com${post.permalink}`;

      const candidateConversation: ConversationItem = {
        id: `reddit-${post.id}`,
        platform: 'reddit',
        authorAlias: post.author,
        contentExcerpt,
        sourcePermalink: permalink,
        timestamp: new Date(postTimestampMs).toISOString(),
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
