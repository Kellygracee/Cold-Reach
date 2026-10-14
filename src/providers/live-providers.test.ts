import { describe, it, expect, vi } from 'vitest';
import { HackerNewsProvider } from './hacker-news-provider.js';
import { BlueskyProvider } from './bluesky-provider.js';
import { RedditProvider } from './reddit-provider.js';
import { RssFeedProvider, parseRssOrAtomXml } from './rss-feed-provider.js';
import {
  ProviderAuthenticationError,
  ProviderConfigurationError,
  ProviderMalformedResponseError,
  ProviderRateLimitError,
  ProviderSecurityError,
  ProviderTimeoutError,
} from '../contracts/conversation-provider.js';
import { validateSafePublicUrl, safeFetch } from './utils/network.js';
import { assertNotDemoAsLive } from '../contracts/integrity.js';

describe('Phase 3B: Live Conversation Providers', () => {
  describe('SSRF Protection & Network Utilities', () => {
    it('accepts valid public HTTP and HTTPS URLs', () => {
      expect(() => validateSafePublicUrl('https://example.com/feed.xml')).not.toThrow();
      expect(() => validateSafePublicUrl('http://subdomain.blog.org/atom')).not.toThrow();
    });

    it('rejects localhost and local domain names to prevent SSRF', () => {
      expect(() => validateSafePublicUrl('http://localhost:8080/feed')).toThrow(
        ProviderSecurityError,
      );
      expect(() => validateSafePublicUrl('http://service.localhost/feed')).toThrow(
        ProviderSecurityError,
      );
      expect(() => validateSafePublicUrl('http://myhost.local/feed')).toThrow(
        ProviderSecurityError,
      );
      expect(() => validateSafePublicUrl('http://internal.service.lan/atom')).toThrow(
        ProviderSecurityError,
      );
    });

    it('rejects loopback, private, and cloud metadata IPv4 addresses', () => {
      // Loopback 127.0.0.0/8
      expect(() => validateSafePublicUrl('http://127.0.0.1/rss')).toThrow(ProviderSecurityError);
      expect(() => validateSafePublicUrl('http://127.0.0.5:3000/rss')).toThrow(
        ProviderSecurityError,
      );

      // AWS / Cloud metadata service 169.254.169.254
      expect(() => validateSafePublicUrl('http://169.254.169.254/latest/meta-data')).toThrow(
        ProviderSecurityError,
      );

      // Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
      expect(() => validateSafePublicUrl('http://10.0.0.1/feed')).toThrow(ProviderSecurityError);
      expect(() => validateSafePublicUrl('http://172.16.0.10/feed')).toThrow(ProviderSecurityError);
      expect(() => validateSafePublicUrl('http://192.168.1.1/feed')).toThrow(ProviderSecurityError);

      // 0.0.0.0
      expect(() => validateSafePublicUrl('http://0.0.0.0/feed')).toThrow(ProviderSecurityError);
    });

    it('rejects IPv6 loopback and private addresses', () => {
      expect(() => validateSafePublicUrl('http://[::1]:8080/rss')).toThrow(ProviderSecurityError);
      expect(() => validateSafePublicUrl('http://[fe80::1]/rss')).toThrow(ProviderSecurityError);
    });

    it('rejects non-http protocols like file:// or ftp://', () => {
      expect(() => validateSafePublicUrl('file:///etc/passwd')).toThrow(ProviderSecurityError);
      expect(() => validateSafePublicUrl('ftp://example.com/feed')).toThrow(ProviderSecurityError);
    });

    it('safeFetch throws ProviderRateLimitError on HTTP 429 with Retry-After header', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Too Many Requests', {
          status: 429,
          headers: { 'Retry-After': '30' },
        }),
      );

      await expect(
        safeFetch('https://api.example.com/test', {
          fetchFn: mockFetch as unknown as typeof fetch,
          providerName: 'test-provider',
        }),
      ).rejects.toThrow(ProviderRateLimitError);
    });

    it('safeFetch throws ProviderAuthenticationError on HTTP 401 or 403', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Unauthorized', {
          status: 401,
        }),
      );

      await expect(
        safeFetch('https://api.example.com/test', {
          fetchFn: mockFetch as unknown as typeof fetch,
          providerName: 'test-provider',
        }),
      ).rejects.toThrow(ProviderAuthenticationError);
    });

    it('safeFetch throws ProviderTimeoutError when request times out', async () => {
      const mockFetch = vi.fn().mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      );

      await expect(
        safeFetch('https://api.example.com/test', {
          fetchFn: mockFetch as unknown as typeof fetch,
          timeoutMs: 10,
          providerName: 'test-provider',
        }),
      ).rejects.toThrow(ProviderTimeoutError);
    });
  });

  describe('Hacker News Provider (Public & Configured)', () => {
    it('reports READY status out of the box without credentials', () => {
      const hn = new HackerNewsProvider();
      expect(hn.getStatus()).toEqual({
        state: 'READY',
        configured: true,
        reason: expect.stringContaining('Algolia search API'),
      });
    });

    it('maps Algolia response to ConversationSearchResult with LIVE provenance', async () => {
      const mockAlgoliaResponse = {
        hits: [
          {
            objectID: '40001',
            title: 'Show HN: FlowScribe – Automates podcast transcription',
            story_text: 'We built a tool to help creators transcribe audio fast.',
            author: 'audio_dev',
            created_at: '2026-10-14T12:00:00.000Z',
          },
          {
            objectID: '40002',
            title: null,
            comment_text:
              'Any recommendations for a good podcast transcription software that works well?',
            author: 'hn_listener',
            created_at: '2026-10-14T13:00:00.000Z',
          },
        ],
        nbHits: 2,
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockAlgoliaResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const hn = new HackerNewsProvider({
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const result = await hn.search({
        queryTerms: ['podcast transcription', 'transcription software'],
      });

      expect(result.sourceProvenance).toBe('LIVE');
      expect(result.providerName).toBe('hackernews');
      expect(result.items.length).toBe(2);

      const item40001 = result.items.find((i) => i.conversation.id === 'hn-40001')!;
      expect(item40001).toBeDefined();
      expect(item40001.conversation.sourceProvenance).toBe('LIVE');
      expect(item40001.conversation.platform).toBe('hackernews');
      expect(item40001.conversation.sourcePermalink).toBe(
        'https://news.ycombinator.com/item?id=40001',
      );
      expect(item40001.conversation.authorAlias).toBe('audio_dev');
      expect(item40001.relevanceScore).toBeGreaterThanOrEqual(40);

      const item40002 = result.items.find((i) => i.conversation.id === 'hn-40002')!;
      expect(item40002).toBeDefined();
      expect(item40002.conversation.sourceProvenance).toBe('LIVE');
      expect(item40002.conversation.authorAlias).toBe('hn_listener');

      // Verify Phase 1 integrity check passes for LIVE items
      expect(() => assertNotDemoAsLive(item40001.conversation, 'LIVE')).not.toThrow();
    });

    it('filters out items matching excluded topics', async () => {
      const mockAlgoliaResponse = {
        hits: [
          {
            objectID: '40003',
            title: 'Podcast transcription tool for cryptocurrency traders',
            author: 'crypto_guy',
            created_at: '2026-10-14T10:00:00.000Z',
          },
          {
            objectID: '40004',
            title: 'Podcast transcription for indie podcasters',
            author: 'pod_creator',
            created_at: '2026-10-14T11:00:00.000Z',
          },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockAlgoliaResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const hn = new HackerNewsProvider({
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const result = await hn.search({
        queryTerms: ['podcast transcription'],
        excludedTopics: ['cryptocurrency'],
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0]?.conversation.id).toBe('hn-40004');
    });

    it('throws ProviderMalformedResponseError on invalid JSON from Algolia', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('<html>Bad Gateway</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      );

      const hn = new HackerNewsProvider({
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      await expect(hn.search({ queryTerms: ['podcast transcription'] })).rejects.toThrow(
        ProviderMalformedResponseError,
      );
    });
  });

  describe('Bluesky Provider (Public & Configured)', () => {
    it('reports READY status out of the box without credentials', () => {
      const bsky = new BlueskyProvider();
      expect(bsky.getStatus()).toEqual({
        state: 'READY',
        configured: true,
        reason: expect.stringContaining('searchPosts endpoint'),
      });
    });

    it('maps AT Protocol search response to ConversationSearchResult with LIVE provenance', async () => {
      const mockBskyResponse = {
        posts: [
          {
            uri: 'at://did:plc:test1234/app.bsky.feed.post/3kxyz999',
            cid: 'bafyreitestcid123',
            author: {
              handle: 'creator.bsky.social',
              displayName: 'Creator Alex',
            },
            record: {
              text: 'Looking for a reliable podcast transcription tool. Any suggestions for creators?',
              createdAt: '2026-10-14T14:00:00.000Z',
            },
          },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockBskyResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const bsky = new BlueskyProvider({
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const result = await bsky.search({
        queryTerms: ['podcast transcription'],
      });

      expect(result.sourceProvenance).toBe('LIVE');
      expect(result.providerName).toBe('bluesky');
      expect(result.items.length).toBe(1);

      const item = result.items[0]!;
      expect(item.conversation.sourceProvenance).toBe('LIVE');
      expect(item.conversation.platform).toBe('bluesky');
      expect(item.conversation.authorAlias).toBe('creator.bsky.social');
      expect(item.conversation.sourcePermalink).toBe(
        'https://bsky.app/profile/creator.bsky.social/post/3kxyz999',
      );
      expect(item.conversation.contentExcerpt).toContain('podcast transcription tool');
    });

    it('throws ProviderRateLimitError on HTTP 429 from Bluesky', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Rate limit reached', {
          status: 429,
          headers: { 'Retry-After': '60' },
        }),
      );

      const bsky = new BlueskyProvider({
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      await expect(bsky.search({ queryTerms: ['podcasting'] })).rejects.toThrow(
        ProviderRateLimitError,
      );
    });
  });

  describe('Reddit Provider (OAuth2 Configured vs NOT_CONFIGURED)', () => {
    it('returns NOT_CONFIGURED status when credentials are not provided', () => {
      const reddit = new RedditProvider();
      expect(reddit.getStatus()).toEqual({
        state: 'NOT_CONFIGURED',
        configured: false,
        reason: expect.stringContaining('OAuth2 client credentials'),
      });
    });

    it('returns empty result with providerStatus NOT_CONFIGURED when searching unconfigured provider', async () => {
      const reddit = new RedditProvider();
      const result = await reddit.search({ queryTerms: ['cold outreach'] });

      expect(result.providerStatus).toBe('NOT_CONFIGURED');
      expect(result.items).toEqual([]);
      expect(result.totalMatches).toBe(0);
      expect(result.sourceProvenance).toBe('LIVE');
    });

    it('throws ProviderConfigurationError if throwIfNotConfigured is true', async () => {
      const reddit = new RedditProvider({ throwIfNotConfigured: true });
      await expect(reddit.search({ queryTerms: ['cold outreach'] })).rejects.toThrow(
        ProviderConfigurationError,
      );
    });

    it('authenticates via OAuth2 and maps search results when configured', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('access_token')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: 'fake-reddit-token-xyz',
                token_type: 'bearer',
                expires_in: 3600,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        if (url.includes('search.json')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: {
                  children: [
                    {
                      kind: 't3',
                      data: {
                        id: 'post999',
                        title: 'Cold outreach CRM with automated follow up?',
                        selftext: 'Looking for a B2B sales automation tool that works.',
                        author: 'sales_rep_99',
                        permalink: '/r/sales/comments/post999/cold_outreach_crm',
                        created_utc: 1728900000,
                      },
                    },
                  ],
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const reddit = new RedditProvider({
        clientId: 'my-client-id',
        clientSecret: 'my-client-secret',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(reddit.getStatus().state).toBe('READY');

      const result = await reddit.search({
        queryTerms: ['cold outreach', 'follow up'],
      });

      expect(result.sourceProvenance).toBe('LIVE');
      expect(result.providerStatus).toBe('READY');
      expect(result.items.length).toBe(1);

      const first = result.items[0]!;
      expect(first.conversation.sourceProvenance).toBe('LIVE');
      expect(first.conversation.id).toBe('reddit-post999');
      expect(first.conversation.sourcePermalink).toBe(
        'https://reddit.com/r/sales/comments/post999/cold_outreach_crm',
      );
      expect(first.conversation.authorAlias).toBe('sales_rep_99');
      expect(first.conversation.contentExcerpt).toContain('Cold outreach CRM');
    });

    it('throws ProviderAuthenticationError if OAuth token request fails with 401', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Unauthorized client', {
          status: 401,
        }),
      );

      const reddit = new RedditProvider({
        clientId: 'bad-id',
        clientSecret: 'bad-secret',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      await expect(reddit.search({ queryTerms: ['cold outreach'] })).rejects.toThrow(
        ProviderAuthenticationError,
      );
    });
  });

  describe('RSS / Atom Feed Provider (SSRF Protected)', () => {
    it('returns NOT_CONFIGURED status when no feed URLs are set', () => {
      const rss = new RssFeedProvider();
      expect(rss.getStatus()).toEqual({
        state: 'NOT_CONFIGURED',
        configured: false,
        reason: expect.stringContaining('No RSS or Atom feed URLs'),
      });
    });

    it('blocks SSRF on initialization if user configures a localhost or private address', () => {
      expect(() => new RssFeedProvider({ feedUrls: ['http://localhost:8000/feed.xml'] })).toThrow(
        ProviderSecurityError,
      );

      expect(() => new RssFeedProvider({ feedUrls: ['http://169.254.169.254/feed.xml'] })).toThrow(
        ProviderSecurityError,
      );
    });

    it('parses RSS 2.0 XML and returns LIVE search results', async () => {
      const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Podcasting Tech News</title>
    <link>https://podnews.example.com</link>
    <item>
      <title>Best Podcast Transcription Workflows in 2026</title>
      <link>https://podnews.example.com/article/101</link>
      <description><![CDATA[Comparing manual transcription to AI workflow tools.]]></description>
      <pubDate>Mon, 14 Oct 2026 10:00:00 GMT</pubDate>
      <author>editor@podnews.example.com (Tech Editor)</author>
      <guid>https://podnews.example.com/article/101</guid>
    </item>
  </channel>
</rss>`;

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(rssXml, {
          status: 200,
          headers: { 'Content-Type': 'application/rss+xml' },
        }),
      );

      const rssProvider = new RssFeedProvider({
        feedUrls: ['https://podnews.example.com/rss'],
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(rssProvider.getStatus().state).toBe('READY');

      const result = await rssProvider.search({
        queryTerms: ['podcast transcription'],
      });

      expect(result.sourceProvenance).toBe('LIVE');
      expect(result.providerName).toBe('rss');
      expect(result.items.length).toBe(1);

      const item = result.items[0]!;
      expect(item.conversation.sourceProvenance).toBe('LIVE');
      expect(item.conversation.sourcePermalink).toBe('https://podnews.example.com/article/101');
      expect(item.conversation.contentExcerpt).toContain(
        'Best Podcast Transcription Workflows in 2026',
      );
    });

    it('parses Atom 1.0 XML and returns LIVE search results', async () => {
      const atomXml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Sales Automation Insights</title>
  <entry>
    <title>Cold Outreach Strategies That Convert</title>
    <link href="https://salesblog.example.com/posts/202" />
    <id>urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a</id>
    <updated>2026-10-14T08:00:00Z</updated>
    <summary>How automated follow up sequences prevent deals from slipping through the cracks.</summary>
    <author>
      <name>Growth Lead</name>
    </author>
  </entry>
</feed>`;

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(atomXml, {
          status: 200,
          headers: { 'Content-Type': 'application/atom+xml' },
        }),
      );

      const rssProvider = new RssFeedProvider({
        feedUrls: ['https://salesblog.example.com/atom'],
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const result = await rssProvider.search({
        queryTerms: ['cold outreach', 'follow up'],
      });

      expect(result.sourceProvenance).toBe('LIVE');
      expect(result.items.length).toBe(1);

      const item = result.items[0]!;
      expect(item.conversation.sourcePermalink).toBe('https://salesblog.example.com/posts/202');
      expect(item.conversation.authorAlias).toBe('Growth Lead');
      expect(item.conversation.matchedKeywords).toContain('cold outreach');
    });

    it('throws ProviderMalformedResponseError when feed returns non-XML garbage', () => {
      expect(() => parseRssOrAtomXml('Not an xml feed at all', 'rss')).toThrow(
        ProviderMalformedResponseError,
      );
    });

    it('blocks HTTP redirects to localhost or private IP addresses', async () => {
      // Mock returns a 302 redirecting to http://127.0.0.1:8000/secret.xml
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url === 'https://public-blog.example.com/feed.xml') {
          return Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { Location: 'http://127.0.0.1:8000/secret.xml' },
            }),
          );
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const rssProvider = new RssFeedProvider({
        feedUrls: ['https://public-blog.example.com/feed.xml'],
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      await expect(rssProvider.search({ queryTerms: ['test'] })).rejects.toThrow(
        ProviderSecurityError,
      );
    });

    it('blocks HTTP redirects to cloud metadata IP address 169.254.169.254', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url === 'https://public-blog.example.com/feed.xml') {
          return Promise.resolve(
            new Response(null, {
              status: 301,
              headers: { Location: 'http://169.254.169.254/latest/meta-data' },
            }),
          );
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const rssProvider = new RssFeedProvider({
        feedUrls: ['https://public-blog.example.com/feed.xml'],
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      await expect(rssProvider.search({ queryTerms: ['test'] })).rejects.toThrow(
        ProviderSecurityError,
      );
    });

    it('blocks hostnames resolving to private IP addresses via DNS', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('<rss></rss>'));
      const mockDnsLookup = vi.fn().mockResolvedValue([{ address: '192.168.1.50', family: 4 }]);

      const rssProvider = new RssFeedProvider({
        feedUrls: ['https://legit-looking-internal.example.com/feed.xml'],
        fetchFn: mockFetch as unknown as typeof fetch,
        dnsLookupFn: mockDnsLookup,
      });

      await expect(rssProvider.search({ queryTerms: ['test'] })).rejects.toThrow(
        ProviderSecurityError,
      );
    });

    it('blocks hostnames resolving to loopback 127.0.0.1 via DNS', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('<rss></rss>'));
      const mockDnsLookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

      const rssProvider = new RssFeedProvider({
        feedUrls: ['https://localtest-domain.example.com/feed.xml'],
        fetchFn: mockFetch as unknown as typeof fetch,
        dnsLookupFn: mockDnsLookup,
      });

      await expect(rssProvider.search({ queryTerms: ['test'] })).rejects.toThrow(
        ProviderSecurityError,
      );
    });
  });
});
