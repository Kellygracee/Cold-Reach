import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationItem } from '../contracts/conversation.js';
import { ProductProfile } from '../contracts/profile.js';
import { MockDraftProvider } from '../providers/mock-draft-provider.js';
import { InMemoryOpportunityRepository } from '../storage/opportunity-repository.js';
import { InMemoryProfileRepository } from '../storage/profile-repository.js';
import { ColdReachApiClient } from './client.js';
import { ColdReachApiServer } from './server.js';

describe('Phase 7: API Integration for the Stitch Frontend', () => {
  let server: ColdReachApiServer;
  let client: ColdReachApiClient;
  let serverUrl: string;

  const validProfileData = {
    productName: 'FlowScribe AI',
    valueProposition: 'Automated high-accuracy podcast transcriptions and chapter markers.',
    productDescription: 'Tool that cuts audio transcription turnaround time.',
    problemsSolved: [
      'Hours spent manually transcribing audio',
      'Inaccurate chapter markers in long podcast recordings',
    ],
    idealCustomerDescription: 'Podcasters, audio engineers, and indie content creators.',
    seedKeywords: ['podcast transcription', 'audio to text', 'chapter markers'],
    customerPainPointPhrases: [
      'transcription takes forever',
      'how to generate chapters from audio',
    ],
    excludedTopics: ['cryptocurrency', 'video editing'],
    toneGuidelines: ['helpful', 'peer-to-peer', 'humble', 'not salesy'],
  };

  const highRelevanceCandidate: ConversationItem = {
    id: 'hn-888',
    platform: 'Hacker News',
    authorAlias: 'dan_podcaster',
    contentExcerpt:
      'I host a tech podcast and spend hours manually transcribing audio recordings. Looking for any tool recommendations?',
    sourcePermalink: 'https://news.ycombinator.com/item?id=888',
    timestamp: '2026-03-01T12:00:00.000Z',
    matchedKeywords: ['podcast transcription', 'manually transcribing audio'],
    sourceProvenance: 'LIVE',
  };

  const lowRelevanceCandidate: ConversationItem = {
    id: 'bsky-999',
    platform: 'Bluesky',
    authorAlias: 'casual_reader',
    contentExcerpt: 'Just reading a book this afternoon.',
    sourcePermalink: 'https://bsky.app/profile/casual_reader/post/999',
    timestamp: '2026-03-01T13:00:00.000Z',
    matchedKeywords: ['reading'],
    sourceProvenance: 'LIVE',
  };

  beforeAll(async () => {
    const profileRepo = new InMemoryProfileRepository();
    const oppRepo = new InMemoryOpportunityRepository();
    const draftProvider = new MockDraftProvider();

    server = new ColdReachApiServer({
      profileRepository: profileRepo,
      opportunityRepository: oppRepo,
      draftProvider,
      allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    });

    const info = await server.start(0, '127.0.0.1');
    serverUrl = info.url;
    client = new ColdReachApiClient({ baseUrl: serverUrl });
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('Server Binding & CORS Configuration', () => {
    it('binds to localhost (127.0.0.1) and returns valid OpenAPI 3.1.0 specification', async () => {
      expect(serverUrl).toContain('127.0.0.1');
      const spec = (await client.getOpenApiSpec()) as Record<string, unknown>;
      expect(spec['openapi']).toBe('3.1.0');
      expect((spec['info'] as Record<string, unknown>)['title']).toBe('Cold-Reach Stitch API');
      expect((spec['paths'] as Record<string, unknown>)['/api/profiles']).toBeDefined();
      expect((spec['paths'] as Record<string, unknown>)['/api/opportunities']).toBeDefined();
    });

    it('responds to preflight OPTIONS request with 204 and CORS headers', async () => {
      const res = await fetch(`${serverUrl}/api/profiles`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    });

    it('returns 404 for unknown endpoints with consistent error shape', async () => {
      const res = await fetch(`${serverUrl}/api/unknown-endpoint`);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Product Profile Endpoints', () => {
    let createdProfile: ProductProfile;

    it('creates a product profile with 201 status and validation', async () => {
      createdProfile = await client.createProfile(validProfileData);
      expect(createdProfile.id).toBeDefined();
      expect(createdProfile.productName).toBe('FlowScribe AI');
      expect(createdProfile.seedKeywords).toContain('podcast transcription');
    });

    it('rejects invalid profile creation with 400 VALIDATION_ERROR', async () => {
      const res = await fetch(`${serverUrl}/api/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName: '' }), // Invalid blank name and missing fields
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('PROFILE_VALIDATION_ERROR');
      expect(json.error.details).toBeDefined();
    });

    it('retrieves profile by ID and lists profiles', async () => {
      const fetched = await client.getProfile(createdProfile.id);
      expect(fetched.id).toBe(createdProfile.id);

      const list = await client.listProfiles();
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.some((p) => p.id === createdProfile.id)).toBe(true);
    });

    it('updates product profile', async () => {
      const updated = await client.updateProfile(createdProfile.id, {
        productName: 'FlowScribe AI Pro',
      });
      expect(updated.productName).toBe('FlowScribe AI Pro');
    });
  });

  describe('Query Expansion & Conversation Search', () => {
    it('generates query expansion clusters from profile with provenance and conflict flags', async () => {
      const profiles = await client.listProfiles();
      const profile = profiles[0];

      const expansion = await client.expandQuery({ profileId: profile.id });
      const seedCluster = expansion.clusters.find((c) => c.id === 'seed_terms');
      const solutionCluster = expansion.clusters.find((c) => c.id === 'solution_seeking');
      expect(seedCluster?.terms.length).toBeGreaterThan(0);
      expect(solutionCluster?.terms.length).toBeGreaterThan(0);
      expect(seedCluster?.terms[0].source).toBe('USER');
      expect(expansion.filteredTermsCount).toBe(0);
    });

    it('lists available search and AI providers with status and provenance information', async () => {
      const providers = await client.listProviders();
      expect(providers.length).toBeGreaterThanOrEqual(5);

      const demo = providers.find((p) => p.id === 'demo');
      expect(demo?.state).toBe('READY');
      expect(demo?.provenance).toBe('DEMO');

      const hn = providers.find((p) => p.id === 'hacker-news');
      expect(hn?.state).toBe('READY');
      expect(hn?.provenance).toBe('LIVE');
    });

    it('executes conversation search with clear DEMO provenance labeling', async () => {
      const result = await client.searchConversations({
        provider: 'demo',
        queryTerms: ['podcast transcription', 'audio'],
      });

      expect(result.sourceProvenance).toBe('DEMO');
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items[0].conversation.sourceProvenance).toBe('DEMO');
    });
  });

  describe('Opportunity Attribution, Listing & Pagination', () => {
    let highOppId: string;
    let lowOppId: string;

    it('attributes candidate conversation to Opportunity with relevance score and whyMatched', async () => {
      const profiles = await client.listProfiles();
      const opp = await client.attributeOpportunity({
        candidate: highRelevanceCandidate,
        profile: profiles[0],
      });

      expect(opp.id).toBeDefined();
      highOppId = opp.id;
      expect(opp.relevanceScore).toBeGreaterThanOrEqual(60);
      expect(opp.status).toBe('NEW');
      expect(opp.conversation.sourceProvenance).toBe('LIVE');
      expect(opp.whyMatched.summary).toContain('FlowScribe AI Pro');
      expect(opp.whyMatched.matchedNeeds).toContain('Hours spent manually transcribing audio');

      // Attribute a low relevance candidate as well
      const lowOpp = await client.attributeOpportunity({
        candidate: lowRelevanceCandidate,
        profile: profiles[0],
      });
      lowOppId = lowOpp.id;
      expect(lowOpp.relevanceScore).toBeLessThan(40);
    });

    it('lists opportunities with pagination metadata', async () => {
      const paginated = await client.listOpportunities({ page: 1, pageSize: 1 });
      expect(paginated.items.length).toBe(1);
      expect(paginated.pagination.page).toBe(1);
      expect(paginated.pagination.pageSize).toBe(1);
      expect(paginated.pagination.totalItems).toBeGreaterThanOrEqual(2);
      expect(paginated.pagination.hasNextPage).toBe(true);
    });

    it('filters opportunities by status and score range', async () => {
      const highOnly = await client.listOpportunities({ minScore: 60 });
      expect(highOnly.items.length).toBeGreaterThanOrEqual(1);
      expect(highOnly.items.every((o) => o.relevanceScore >= 60)).toBe(true);

      const newOnly = await client.listOpportunities({ status: 'NEW' });
      expect(newOnly.items.every((o) => o.status === 'NEW')).toBe(true);
    });

    it('retrieves opportunity detail by ID', async () => {
      const opp = await client.getOpportunity(highOppId);
      expect(opp.id).toBe(highOppId);
      expect(opp.conversation.authorAlias).toBe('dan_podcaster');
    });

    describe('Draft Retrieval, Generation, Editing, and Review Actions', () => {
      it('returns null draft initially', async () => {
        const draft = await client.getDraft(highOppId);
        expect(draft).toBeNull();
      });

      it('generates contextual reply draft grounded in profile with transparency note', async () => {
        const draft = await client.generateDraft(highOppId);
        expect(draft).not.toBeNull();
        expect(draft.replyText).toContain(
          'practical approach to handling hours spent manually transcribing audio',
        );
        expect(draft.transparencyNote).toContain(
          'Transparency: I am affiliated with FlowScribe AI',
        );

        // Verify opportunity transitioned to REVIEWED
        const opp = await client.getOpportunity(highOppId);
        expect(opp.status).toBe('REVIEWED');
      });

      it('blocks drafting on score < 40 without explicit override (422)', async () => {
        const res = await fetch(`${serverUrl}/api/opportunities/${lowOppId}/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.success).toBe(false);
        expect(json.error.code).toBe('LOW_SCORE_OVERRIDE_REQUIRED');
      });

      it('allows drafting on score < 40 when allowLowScoreOverride is true', async () => {
        const draft = await client.generateDraft(lowOppId, { allowLowScoreOverride: true });
        expect(draft).toBeDefined();
        expect(draft.replyText).toBeTruthy();
      });

      it('edits draft and records user revision history with editedBy: USER', async () => {
        const initialDraft = await client.getDraft(highOppId);
        const edited = await client.editDraft(highOppId, {
          newText: 'Custom human edited reply directly answering question.',
          changeSummary: 'Clarified turnaround time details.',
        });

        expect(edited.replyText).toBe('Custom human edited reply directly answering question.');
        expect(edited.revisionHistory.length).toBe(1);
        expect(edited.revisionHistory[0].editedBy).toBe('USER');
        expect(edited.revisionHistory[0].previousText).toBe(initialDraft?.replyText);
        expect(edited.revisionHistory[0].changeSummary).toBe('Clarified turnaround time details.');
      });

      it('retrieves review data bundle for future UI rendering', async () => {
        const review = await client.getReviewData(highOppId);
        expect(review.opportunity.id).toBe(highOppId);
        expect(review.sourcePermalink).toBe(highRelevanceCandidate.sourcePermalink);
        expect(review.draft).not.toBeNull();
        expect(review.revisionCount).toBe(1);
        expect(review.relevanceAssessment.isLowRelevance).toBe(false);
      });

      it('retrieves original source link', async () => {
        const sourceLink = await client.getSourceLink(highOppId);
        expect(sourceLink.permalink).toBe(highRelevanceCandidate.sourcePermalink);
      });

      it('retrieves formatted clipboard copy payload including transparency disclosure', async () => {
        const copyPayload = await client.copyDraft(highOppId);
        expect(copyPayload.clipboardText).toContain('Custom human edited reply');
        expect(copyPayload.clipboardText).toContain(
          'Transparency: I am affiliated with FlowScribe AI',
        );
        expect(copyPayload.characterCount).toBe(copyPayload.clipboardText.length);
      });
    });

    describe('Status Transitions, Manual Response Auditing & Pipeline Metrics', () => {
      it('updates user review notes independently', async () => {
        const updated = await client.updateReviewNotes(
          highOppId,
          'Lead marked for priority follow-up.',
        );
        expect(updated.userReviewNotes).toBe('Lead marked for priority follow-up.');
      });

      it('records manual external response via /respond endpoint with immutable audit', async () => {
        const responded = await client.recordManualResponse(highOppId, {
          manualDispatchConfirmed: true,
          operatorNotes: 'Copied draft and replied on Hacker News discussion thread.',
          userReviewNotes: 'Sent manually via browser.',
        });

        expect(responded.status).toBe('RESPONDED');
        expect(responded.manualResponseAudit).toBeDefined();
        expect(responded.manualResponseAudit?.dispatchMethod).toBe('MANUAL_EXTERNAL_POST');
        expect(responded.manualResponseAudit?.manualDispatchConfirmed).toBe(true);
        expect(responded.manualResponseAudit?.operatorNotes).toContain('replied on Hacker News');
      });

      it('blocks attempting to transition away from terminal RESPONDED status (409)', async () => {
        const res = await fetch(`${serverUrl}/api/opportunities/${highOppId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toStatus: 'REVIEWED' }),
        });

        expect(res.status).toBe(409);
        const json = await res.json();
        expect(json.success).toBe(false);
        expect(json.error.code).toBe('AUDIT_IMMUTABILITY_ERROR');
      });

      it('retrieves status history audit trail', async () => {
        const history = await client.getStatusHistory(highOppId);
        expect(history.length).toBeGreaterThanOrEqual(2);
        expect(history.some((h) => h.toStatus === 'REVIEWED')).toBe(true);
        expect(history.some((h) => h.toStatus === 'RESPONDED')).toBe(true);
      });

      it('returns comprehensive pipeline metrics with appDispatchedCount: 0 guarantee', async () => {
        const metrics = await client.getPipelineMetrics();
        expect(metrics.totalOpportunities).toBeGreaterThanOrEqual(2);
        expect(metrics.statusBreakdown.responded).toBe(1);
        expect(metrics.auditSummary.appDispatchedCount).toBe(0);
        expect(metrics.auditSummary.totalRespondedOutsideApp).toBe(1);
        expect(metrics.auditSummary.manualDispatchConfirmedCount).toBe(1);
        expect(metrics.auditSummary.manualExternalPostMethodCount).toBe(1);
      });
    });

    describe('Static Asset Serving & Frontend SPA Routing', () => {
      it('serves index.html at root route GET /', async () => {
        const res = await fetch(`${serverUrl}/`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        const text = await res.text();
        expect(text).toContain('ColdReach');
        expect(text).toContain('view-chat');
        expect(text).toContain('view-dashboard');
        expect(text).toContain('view-opportunities');
        expect(text).toContain('view-product-profile');
        expect(text).toContain('view-analytics');
        expect(text).toContain('view-settings');
      });

      it('serves static assets with appropriate content-type headers', async () => {
        const cssRes = await fetch(`${serverUrl}/styles.css`);
        expect(cssRes.status).toBe(200);
        expect(cssRes.headers.get('content-type')).toContain('text/css');

        const jsRes = await fetch(`${serverUrl}/app.js`);
        expect(jsRes.status).toBe(200);
        expect(jsRes.headers.get('content-type')).toContain('javascript');
      });

      it('falls back to index.html for non-API client routes (SPA routing)', async () => {
        const spaRes = await fetch(`${serverUrl}/chat`);
        expect(spaRes.status).toBe(200);
        expect(spaRes.headers.get('content-type')).toContain('text/html');
        const text = await spaRes.text();
        expect(text).toContain('ColdReach');
      });

      it('preserves strict 404 JSON response for unknown /api/* endpoints', async () => {
        const apiRes = await fetch(`${serverUrl}/api/does-not-exist`);
        expect(apiRes.status).toBe(404);
        expect(apiRes.headers.get('content-type')).toContain('application/json');
        const json = await apiRes.json();
        expect(json.success).toBe(false);
        expect(json.error.code).toBe('NOT_FOUND');
      });
    });
  });
});
