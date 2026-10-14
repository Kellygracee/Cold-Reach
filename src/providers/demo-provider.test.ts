import { describe, it, expect } from 'vitest';
import { DemoProvider, DemoProviderError, calculateDemoRelevanceScore } from './demo-provider.js';
import { ConversationItem } from '../contracts/conversation.js';
import { QueryTerm } from '../contracts/query.js';
import { assertNotDemoAsLive, IntegrityValidationError } from '../contracts/integrity.js';

describe('DemoProvider (Phase 3A)', () => {
  const provider = new DemoProvider();

  describe('Provider Metadata and Basic Search', () => {
    it('exposes correct provider metadata', () => {
      expect(provider.name).toBe('demo-provider');
      expect(provider.provenance).toBe('DEMO');
    });

    it('searches demo conversations using an array of string query terms', async () => {
      const result = await provider.search({
        queryTerms: ['podcast transcription', 'transcription tool'],
      });

      expect(result.sourceProvenance).toBe('DEMO');
      expect(result.providerName).toBe('demo-provider');
      expect(result.totalMatches).toBeGreaterThan(0);
      expect(result.items.length).toBeGreaterThan(0);

      const firstItem = result.items[0]!;
      expect(firstItem.conversation.sourceProvenance).toBe('DEMO');
      expect(firstItem.relevanceScore).toBeGreaterThanOrEqual(40);
      expect(firstItem.matchedTerms.length).toBeGreaterThan(0);
    });

    it('searches demo conversations using Phase 2 QueryTerm objects', async () => {
      const queryTerms: QueryTerm[] = [
        {
          id: 'seed-1',
          term: 'cold outreach',
          source: 'USER',
          cluster: 'seed_terms',
          reason: 'User seed keyword',
          hasConflict: false,
          conflictingExcludedTopics: [],
          isFiltered: false,
        },
        {
          id: 'seed-2',
          term: 'follow up email',
          source: 'USER',
          cluster: 'seed_terms',
          reason: 'User seed keyword',
          hasConflict: false,
          conflictingExcludedTopics: [],
          isFiltered: false,
        },
      ];

      const result = await provider.search({ queryTerms });
      expect(result.totalMatches).toBeGreaterThan(0);

      for (const item of result.items) {
        expect(
          item.matchedTerms.some((t) => t === 'cold outreach' || t === 'follow up email'),
        ).toBe(true);
      }
    });

    it('searches demo conversations using a single query string', async () => {
      const result = await provider.search({
        query: 'audiogram',
      });

      expect(result.totalMatches).toBeGreaterThan(0);
      expect(result.items.some((i) => i.conversation.contentExcerpt.includes('audiogram'))).toBe(
        true,
      );
    });

    it('returns empty results gracefully when query terms are empty', async () => {
      const result = await provider.search({
        queryTerms: [],
      });

      expect(result.totalMatches).toBe(0);
      expect(result.items).toEqual([]);
      expect(result.sourceProvenance).toBe('DEMO');
    });

    it('returns empty results when no conversations match query terms', async () => {
      const result = await provider.search({
        queryTerms: ['xyznonexistentkeyword12345'],
      });

      expect(result.totalMatches).toBe(0);
      expect(result.items).toEqual([]);
    });
  });

  describe('Search Filtering', () => {
    it('applies excluded topics to discard conversations containing excluded topics', async () => {
      // Without excluded topics, "podcast transcription" matches the crypto fixture conv-demo-010
      const searchWithoutExclusion = await provider.search({
        queryTerms: ['podcast transcription'],
      });
      const hasCryptoPost = searchWithoutExclusion.items.some(
        (i) => i.conversation.id === 'conv-demo-010',
      );
      expect(hasCryptoPost).toBe(true);

      // With excluded topics: "cryptocurrency", conv-demo-010 MUST be excluded
      const searchWithExclusion = await provider.search({
        queryTerms: ['podcast transcription'],
        excludedTopics: ['cryptocurrency'],
      });

      const filteredOutCrypto = searchWithExclusion.items.some(
        (i) => i.conversation.id === 'conv-demo-010',
      );
      expect(filteredOutCrypto).toBe(false);
      expect(
        searchWithExclusion.items.every(
          (i) => !i.conversation.contentExcerpt.toLowerCase().includes('cryptocurrency'),
        ),
      ).toBe(true);
    });

    it('filters out fixtures matching multi-word excluded topics', async () => {
      const searchWithMultiWordExclusion = await provider.search({
        queryTerms: ['audiogram', 'clip generator'],
        excludedTopics: ['political commentary'],
      });

      const foundPoliticalPost = searchWithMultiWordExclusion.items.some(
        (i) => i.conversation.id === 'conv-demo-011',
      );
      expect(foundPoliticalPost).toBe(false);
    });

    it('filters out mass spam fixtures', async () => {
      const searchSpam = await provider.search({
        queryTerms: ['cold outreach'],
        excludedTopics: ['mass spamming'],
      });

      const foundSpamPost = searchSpam.items.some((i) => i.conversation.id === 'conv-demo-012');
      expect(foundSpamPost).toBe(false);
    });

    it('filters by single platform', async () => {
      const result = await provider.search({
        queryTerms: ['podcast transcription', 'cold outreach', 'pdf'],
        platform: 'reddit',
      });

      expect(result.totalMatches).toBeGreaterThan(0);
      expect(result.items.every((i) => i.conversation.platform === 'reddit')).toBe(true);
    });

    it('filters by multiple platforms', async () => {
      const result = await provider.search({
        queryTerms: ['podcast transcription', 'cold outreach', 'pdf'],
        platform: ['reddit', 'hackernews'],
      });

      expect(result.totalMatches).toBeGreaterThan(0);
      expect(
        result.items.every(
          (i) => i.conversation.platform === 'reddit' || i.conversation.platform === 'hackernews',
        ),
      ).toBe(true);
    });

    it('filters by since timestamp', async () => {
      const cutoff = '2026-10-13T00:00:00.000Z';
      const result = await provider.search({
        queryTerms: ['podcast transcription', 'cold outreach'],
        since: cutoff,
      });

      expect(result.totalMatches).toBeGreaterThan(0);
      expect(
        result.items.every(
          (i) => new Date(i.conversation.timestamp).getTime() >= new Date(cutoff).getTime(),
        ),
      ).toBe(true);
    });

    it('filters by until timestamp', async () => {
      const cutoff = '2026-10-11T23:59:59.000Z';
      const result = await provider.search({
        queryTerms: ['podcast transcription', 'cold outreach', 'unsearchable pdfs'],
        until: cutoff,
      });

      expect(result.totalMatches).toBeGreaterThan(0);
      expect(
        result.items.every(
          (i) => new Date(i.conversation.timestamp).getTime() <= new Date(cutoff).getTime(),
        ),
      ).toBe(true);
    });

    it('filters by author alias', async () => {
      const result = await provider.search({
        queryTerms: ['audiogram', 'clips'],
        authorAlias: 'dan',
      });

      expect(result.totalMatches).toBe(1);
      expect(result.items[0]?.conversation.authorAlias).toBe('pod_host_dan');
    });

    it('filters by minRelevanceScore', async () => {
      const highThreshold = 65;
      const result = await provider.search({
        queryTerms: ['podcast transcription', 'audiogram'],
        minRelevanceScore: highThreshold,
      });

      expect(result.items.every((i) => i.relevanceScore >= highThreshold)).toBe(true);
    });

    it('supports pagination with limit and offset', async () => {
      const allMatches = await provider.search({
        queryTerms: ['podcast transcription', 'cold outreach', 'audiogram'],
        limit: 100,
        offset: 0,
      });

      const paginated = await provider.search({
        queryTerms: ['podcast transcription', 'cold outreach', 'audiogram'],
        limit: 2,
        offset: 1,
      });

      expect(paginated.totalMatches).toBe(allMatches.totalMatches);
      expect(paginated.items.length).toBe(2);
      expect(paginated.items[0]?.conversation.id).toBe(allMatches.items[1]?.conversation.id);
      expect(paginated.items[1]?.conversation.id).toBe(allMatches.items[2]?.conversation.id);
    });
  });

  describe('Deterministic Stable Ordering', () => {
    it('sorts results by relevanceScore descending with stable tie-breaking', async () => {
      const result = await provider.search({
        queryTerms: ['podcast transcription', 'audiogram', 'clip generator'],
      });

      for (let i = 0; i < result.items.length - 1; i++) {
        const curr = result.items[i]!;
        const next = result.items[i + 1]!;

        if (curr.relevanceScore === next.relevanceScore) {
          const timeCurr = new Date(curr.conversation.timestamp).getTime();
          const timeNext = new Date(next.conversation.timestamp).getTime();
          expect(timeCurr).toBeGreaterThanOrEqual(timeNext);
        } else {
          expect(curr.relevanceScore).toBeGreaterThan(next.relevanceScore);
        }
      }
    });

    it('produces identical result order and scores across 10 consecutive searches', async () => {
      const params = {
        queryTerms: ['podcast transcription', 'show notes', 'media agency'],
        excludedTopics: ['cryptocurrency'],
      };

      const run1 = await provider.search(params);

      for (let i = 0; i < 9; i++) {
        const nextRun = await provider.search(params);
        expect(nextRun).toEqual(run1);
      }
    });
  });

  describe('Provenance and Integrity Rules', () => {
    it('guarantees clear DEMO provenance on every returned item and result container', async () => {
      const result = await provider.search({
        queryTerms: ['podcast transcription'],
      });

      expect(result.sourceProvenance).toBe('DEMO');
      for (const item of result.items) {
        expect(item.conversation.sourceProvenance).toBe('DEMO');

        // Confirm Phase 1 integrity check passes when categorized as DEMO
        expect(() => assertNotDemoAsLive(item.conversation, 'DEMO')).not.toThrow();

        // Confirm Phase 1 integrity check strictly throws when attempted as LIVE
        expect(() => assertNotDemoAsLive(item.conversation, 'LIVE')).toThrow(
          IntegrityValidationError,
        );
      }
    });

    it('rejects custom fixtures containing LIVE provenance', () => {
      const invalidFixture: ConversationItem = {
        id: 'conv-illegal-live',
        platform: 'reddit',
        authorAlias: 'fake_live_author',
        contentExcerpt: 'Illegal live result inside demo provider',
        sourcePermalink: 'https://reddit.com/r/test/comments/123',
        timestamp: '2026-10-14T10:00:00.000Z',
        matchedKeywords: ['test'],
        sourceProvenance: 'LIVE', // PROHIBITED in DemoProvider
      };

      expect(() => new DemoProvider([invalidFixture])).toThrow(DemoProviderError);
    });
  });

  describe('calculateDemoRelevanceScore Helper', () => {
    it('returns 0 when no terms match', () => {
      expect(calculateDemoRelevanceScore('Some random text', [])).toBe(0);
    });

    it('calculates score within [0, 100] bounds', () => {
      const score = calculateDemoRelevanceScore(
        'Can anyone recommend the best podcast transcription tool? I am struggling with show notes.',
        ['podcast transcription', 'transcription tool'],
      );

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(score).toBeGreaterThan(50);
    });
  });
});
