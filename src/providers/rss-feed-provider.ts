import crypto from 'node:crypto';
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
import { DnsLookupFunction, safeFetch, validateSafePublicUrl } from './utils/network.js';

export interface RssFeedProviderConfig {
  feedUrls?: string[];
  fetchFn?: typeof fetch;
  dnsLookupFn?: DnsLookupFunction;
  timeoutMs?: number;
  throwIfNotConfigured?: boolean;
}

interface ParsedFeedEntry {
  id: string;
  title: string;
  description: string;
  link: string;
  pubDate: string;
  author: string;
}

/**
 * Strips HTML tags and unescapes basic XML entities.
 */
function cleanXmlContent(text: string): string {
  // Extract CDATA if present
  let cleaned = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

  // Strip XML/HTML tags
  cleaned = cleaned.replace(/<[^>]*>/g, ' ');

  // Unescape standard entities
  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Extracts inner content of the first matching XML tag.
 */
function extractTagContent(xml: string, tagName: string): string | null {
  // Handle CDATA block or standard content
  const regex = new RegExp(`<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = xml.match(regex);
  return match && match[1] ? match[1].trim() : null;
}

/**
 * Parses RSS 2.0 or Atom 1.0 XML content into structured entries without external dependencies.
 */
export function parseRssOrAtomXml(xmlString: string, providerName: string): ParsedFeedEntry[] {
  if (!xmlString.trim()) {
    throw new ProviderMalformedResponseError('Feed returned empty response.', providerName);
  }

  const entries: ParsedFeedEntry[] = [];

  const isAtom = xmlString.includes('<feed') && xmlString.includes('<entry');
  const isRss = xmlString.includes('<rss') || xmlString.includes('<channel');

  if (!isAtom && !isRss) {
    throw new ProviderMalformedResponseError(
      'Feed content is neither valid RSS 2.0 nor Atom 1.0 XML.',
      providerName,
    );
  }

  if (isAtom) {
    // Parse Atom entries
    const entryBlocks = xmlString.match(/<entry(?:\s+[^>]*)?>[\s\S]*?<\/entry>/gi) ?? [];
    for (const block of entryBlocks) {
      const rawTitle = extractTagContent(block, 'title') ?? 'Untitled';
      const rawContent =
        extractTagContent(block, 'content') ?? extractTagContent(block, 'summary') ?? '';

      // Atom link can be <link href="..." /> or <link>...</link>
      let link = '';
      const hrefMatch = block.match(/<link(?:\s+[^>]*?)?href=["']([^"']+)["']/i);
      if (hrefMatch && hrefMatch[1]) {
        link = hrefMatch[1].trim();
      } else {
        const linkTag = extractTagContent(block, 'link');
        if (linkTag) link = linkTag.trim();
      }

      const updated =
        extractTagContent(block, 'updated') ?? extractTagContent(block, 'published') ?? '';

      const authorName =
        extractTagContent(block, 'name') ?? extractTagContent(block, 'author') ?? 'Atom Author';

      const id = extractTagContent(block, 'id') ?? link ?? crypto.randomUUID();

      if (link && link.startsWith('http')) {
        entries.push({
          id,
          title: cleanXmlContent(rawTitle),
          description: cleanXmlContent(rawContent),
          link,
          pubDate: updated,
          author: cleanXmlContent(authorName),
        });
      }
    }
  } else {
    // Parse RSS 2.0 items
    const itemBlocks = xmlString.match(/<item(?:\s+[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
    for (const block of itemBlocks) {
      const rawTitle = extractTagContent(block, 'title') ?? 'Untitled';
      const rawDesc =
        extractTagContent(block, 'description') ??
        extractTagContent(block, 'content:encoded') ??
        '';

      const link = extractTagContent(block, 'link') ?? '';
      const pubDate = extractTagContent(block, 'pubDate') ?? '';
      const author =
        extractTagContent(block, 'author') ??
        extractTagContent(block, 'dc:creator') ??
        'RSS Author';

      const guid = extractTagContent(block, 'guid') ?? link ?? crypto.randomUUID();

      if (link && link.startsWith('http')) {
        entries.push({
          id: guid,
          title: cleanXmlContent(rawTitle),
          description: cleanXmlContent(rawDesc),
          link,
          pubDate,
          author: cleanXmlContent(author),
        });
      }
    }
  }

  return entries;
}

/**
 * Live provider for searching RSS and Atom syndication feeds.
 * Includes strict SSRF validation to prevent requests to localhost or private network ranges.
 */
export class RssFeedProvider implements ConversationProvider {
  readonly name = 'rss';
  readonly provenance = 'LIVE' as const;

  private readonly feedUrls: string[];
  private readonly fetchFn?: typeof fetch;
  private readonly dnsLookupFn?: DnsLookupFunction;
  private readonly timeoutMs: number;
  private readonly throwIfNotConfigured: boolean;

  constructor(config: RssFeedProviderConfig = {}) {
    this.feedUrls = (config.feedUrls ?? []).map((u) => u.trim()).filter(Boolean);
    this.fetchFn = config.fetchFn;
    this.dnsLookupFn = config.dnsLookupFn;
    this.timeoutMs = config.timeoutMs ?? 10000;
    this.throwIfNotConfigured = config.throwIfNotConfigured ?? false;

    // Validate configured feed URLs for SSRF protection at startup
    for (const feedUrl of this.feedUrls) {
      validateSafePublicUrl(feedUrl, this.name);
    }
  }

  isConfigured(): boolean {
    return this.feedUrls.length > 0;
  }

  getStatus(): ProviderStatus {
    if (!this.isConfigured()) {
      return {
        state: 'NOT_CONFIGURED',
        configured: false,
        reason: 'No RSS or Atom feed URLs configured. Provide at least one public feed URL.',
      };
    }
    return {
      state: 'READY',
      configured: true,
      reason: `${this.feedUrls.length} RSS/Atom feed URL(s) configured.`,
    };
  }

  async search(input: SearchInput): Promise<ConversationSearchResult> {
    if (!this.isConfigured()) {
      if (this.throwIfNotConfigured) {
        throw new ProviderConfigurationError(
          'RSS provider is not configured with any feed URLs.',
          this.name,
        );
      }
      return {
        items: [],
        totalMatches: 0,
        providerName: this.name,
        sourceProvenance: 'LIVE',
        providerStatus: 'NOT_CONFIGURED',
        statusReason: 'No RSS or Atom feed URLs configured.',
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

    const allEntries: ParsedFeedEntry[] = [];

    // Fetch and parse all configured feeds
    for (const feedUrl of this.feedUrls) {
      // Re-validate target URL
      validateSafePublicUrl(feedUrl, this.name);

      const response = await safeFetch(feedUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/rss+xml, application/atom+xml, text/xml, application/xml',
        },
        fetchFn: this.fetchFn,
        dnsLookupFn: this.dnsLookupFn,
        timeoutMs: this.timeoutMs,
        providerName: this.name,
      });

      const xmlText = await response.text();
      const entries = parseRssOrAtomXml(xmlText, this.name);
      allEntries.push(...entries);
    }

    const matchedCandidates: ConversationSearchResultItem[] = [];

    for (const entry of allEntries) {
      const fullText = entry.description ? `${entry.title}\n\n${entry.description}` : entry.title;
      const contentExcerpt = fullText.trim();
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
        !entry.author.toLowerCase().includes(input.authorAlias.toLowerCase().trim())
      ) {
        continue;
      }

      // 3. Since/until date checks
      let entryTimestamp: string;
      const parsedDate = new Date(entry.pubDate);
      if (!Number.isNaN(parsedDate.getTime())) {
        entryTimestamp = parsedDate.toISOString();
      } else {
        entryTimestamp = new Date().toISOString();
      }

      if (input.since && new Date(entryTimestamp).getTime() < new Date(input.since).getTime()) {
        continue;
      }
      if (input.until && new Date(entryTimestamp).getTime() > new Date(input.until).getTime()) {
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

      const stableId = `rss-${crypto
        .createHash('md5')
        .update(entry.id || entry.link)
        .digest('hex')
        .slice(0, 12)}`;

      const candidateConversation: ConversationItem = {
        id: stableId,
        platform: 'rss',
        authorAlias: entry.author || 'feed-author',
        contentExcerpt,
        sourcePermalink: entry.link,
        timestamp: entryTimestamp,
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
