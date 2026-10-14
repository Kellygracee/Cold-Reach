import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpportunityService, OpportunityNotFoundError } from './opportunity-service.js';
import {
  InMemoryOpportunityRepository,
  FileOpportunityRepository,
} from '../storage/opportunity-repository.js';
import { RelevanceAnalysisEngine } from './relevance-engine.js';
import { ProductProfile } from '../contracts/profile.js';
import { ConversationItem } from '../contracts/conversation.js';
import { assertNotDemoAsLive, IntegrityValidationError } from '../contracts/integrity.js';
import { ProfileValidationError } from './profile-service.js';

describe('Phase 4: Relevance Analysis and Opportunity Attribution', () => {
  let inMemoryRepo: InMemoryOpportunityRepository;
  let service: OpportunityService;

  const validProfile: ProductProfile = {
    id: 'prof-audio-1',
    productName: 'FlowScribe AI',
    valueProposition: 'Automates podcast transcription and highlight generation for creators.',
    productDescription: 'Automates podcast transcription and highlight generation for creators.',
    problemsSolved: [
      'Hours spent manually transcribing audio',
      'Difficulty finding viral clip moments',
    ],
    idealCustomerDescription:
      'Independent podcasters and media agencies publishing weekly episodes.',
    seedKeywords: ['podcast transcription', 'audiogram', 'clip generator'],
    customerPainPointPhrases: [
      'audio transcription takes too long',
      'finding good clips is frustrating',
    ],
    excludedTopics: ['cryptocurrency', 'political commentary'],
    toneGuidelines: ['Helpful', 'Empathetic', 'Concise'],
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
  };

  const highRelevanceCandidate: ConversationItem = {
    id: 'conv-high-101',
    platform: 'reddit',
    authorAlias: 'indie_podcaster_dan',
    contentExcerpt:
      'Any recommendations for a podcast transcription tool? I spend hours manually transcribing audio for each episode and it takes too long.',
    sourcePermalink: 'https://reddit.com/r/podcasting/comments/high101/transcription_help',
    timestamp: '2026-10-14T12:00:00.000Z',
    matchedKeywords: ['podcast transcription', 'transcription tool'],
    sourceProvenance: 'LIVE',
  };

  const lowRelevanceCandidate: ConversationItem = {
    id: 'conv-low-202',
    platform: 'twitter',
    authorAlias: 'casual_listener',
    contentExcerpt: 'Listened to a good podcast episode on my commute today.',
    sourcePermalink: 'https://twitter.com/casual_listener/status/1900000000000202',
    timestamp: '2026-10-14T11:00:00.000Z',
    matchedKeywords: ['podcast'],
    sourceProvenance: 'LIVE',
  };

  const excludedTopicCandidate: ConversationItem = {
    id: 'conv-excl-303',
    platform: 'reddit',
    authorAlias: 'crypto_host',
    contentExcerpt:
      'Best cryptocurrency podcast transcription tool for daily Bitcoin and DeFi trading discussions?',
    sourcePermalink: 'https://reddit.com/r/crypto/comments/excl303/crypto_transcription',
    timestamp: '2026-10-14T13:00:00.000Z',
    matchedKeywords: ['podcast transcription', 'cryptocurrency'],
    sourceProvenance: 'DEMO',
  };

  beforeEach(() => {
    inMemoryRepo = new InMemoryOpportunityRepository();
    service = new OpportunityService(inMemoryRepo);
  });

  describe('Relevance Scoring Engine', () => {
    it('computes a high relevance score for direct problem and intent matches', () => {
      const evaluation = RelevanceAnalysisEngine.evaluate({
        profile: validProfile,
        candidate: highRelevanceCandidate,
      });

      expect(evaluation.relevanceScore).toBeGreaterThanOrEqual(75);
      expect(evaluation.relevanceScore).toBeLessThanOrEqual(100);
      expect(evaluation.matchedProblems.length).toBeGreaterThan(0);
      expect(evaluation.matchedProblems).toContain('Hours spent manually transcribing audio');
      expect(evaluation.hasExclusionConflict).toBe(false);
    });

    it('computes a low relevance score for peripheral mentions without active pain points', () => {
      const evaluation = RelevanceAnalysisEngine.evaluate({
        profile: validProfile,
        candidate: lowRelevanceCandidate,
      });

      expect(evaluation.relevanceScore).toBeLessThan(40);
      expect(evaluation.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(evaluation.whyMatched.summary).toContain('Low relevance');
    });

    it('heavily penalizes candidates that conflict with excluded topics', () => {
      const evaluation = RelevanceAnalysisEngine.evaluate({
        profile: validProfile,
        candidate: excludedTopicCandidate,
      });

      expect(evaluation.hasExclusionConflict).toBe(true);
      expect(evaluation.conflictingTopics).toContain('cryptocurrency');
      // Heavily penalized
      expect(evaluation.relevanceScore).toBeLessThanOrEqual(15);
      expect(evaluation.whyMatched.summary).toContain('conflicts with user-excluded topic');
    });

    it('produces identical deterministic scores across multiple runs', () => {
      const eval1 = RelevanceAnalysisEngine.evaluate({
        profile: validProfile,
        candidate: highRelevanceCandidate,
      });

      for (let i = 0; i < 5; i++) {
        const evalNext = RelevanceAnalysisEngine.evaluate({
          profile: validProfile,
          candidate: highRelevanceCandidate,
        });
        expect(evalNext.relevanceScore).toBe(eval1.relevanceScore);
        expect(evalNext.whyMatched).toEqual(eval1.whyMatched);
      }
    });
  });

  describe('Structured whyMatched Evidence', () => {
    it('generates structured evidence satisfying WhyMatchedExplanation schema', async () => {
      const opportunity = await service.attributeOpportunity({
        profile: validProfile,
        candidate: highRelevanceCandidate,
      });

      const { whyMatched } = opportunity;
      expect(whyMatched.summary.length).toBeGreaterThan(5);
      expect(whyMatched.summary).toContain('FlowScribe AI');

      expect(whyMatched.matchedNeeds.length).toBeGreaterThanOrEqual(1);
      expect(whyMatched.matchedNeeds).toContain('Hours spent manually transcribing audio');

      expect(whyMatched.relevanceRationale).toContain('FlowScribe AI');
      expect(whyMatched.relevanceRationale).toContain(validProfile.valueProposition);

      expect(whyMatched.contextSnippet).toContain('podcast transcription tool');
    });

    it('does not invent product claims, referencing actual value proposition', async () => {
      const opportunity = await service.attributeOpportunity({
        profile: validProfile,
        candidate: highRelevanceCandidate,
      });

      expect(opportunity.whyMatched.relevanceRationale).toContain(validProfile.valueProposition);
      expect(opportunity.whyMatched.relevanceRationale).not.toContain('invented feature');
    });
  });

  describe('Provenance and Permalink Integrity', () => {
    it('preserves LIVE provenance and source permalink exactly', async () => {
      const opportunity = await service.attributeOpportunity({
        profile: validProfile,
        candidate: highRelevanceCandidate,
      });

      expect(opportunity.conversation.sourceProvenance).toBe('LIVE');
      expect(opportunity.conversation.sourcePermalink).toBe(highRelevanceCandidate.sourcePermalink);

      // Verify Phase 1 integrity check passes for LIVE
      expect(() => assertNotDemoAsLive(opportunity, 'LIVE')).not.toThrow();
    });

    it('preserves DEMO provenance and source permalink exactly', async () => {
      const opportunity = await service.attributeOpportunity({
        profile: validProfile,
        candidate: excludedTopicCandidate,
      });

      expect(opportunity.conversation.sourceProvenance).toBe('DEMO');
      expect(opportunity.conversation.sourcePermalink).toBe(excludedTopicCandidate.sourcePermalink);

      // Verify Phase 1 integrity check passes for DEMO
      expect(() => assertNotDemoAsLive(opportunity, 'DEMO')).not.toThrow();

      // Verify Phase 1 integrity check throws if presented as LIVE
      expect(() => assertNotDemoAsLive(opportunity, 'LIVE')).toThrow(IntegrityValidationError);
    });
  });

  describe('Initial Opportunity Lifecycle State', () => {
    it('initializes new opportunities in NEW status with reply drafting not started (null)', async () => {
      const opportunity = await service.attributeOpportunity({
        profile: validProfile,
        candidate: highRelevanceCandidate,
      });

      expect(opportunity.status).toBe('NEW');
      expect(opportunity.replyDraft).toBeNull();
      expect(opportunity.createdAt).toBeDefined();
      expect(opportunity.updatedAt).toBe(opportunity.createdAt);
    });
  });

  describe('Deduplication Handling', () => {
    it('deduplicates multiple identical candidates within attributeBatch', async () => {
      const candidates = [
        highRelevanceCandidate,
        { ...highRelevanceCandidate }, // duplicate
        lowRelevanceCandidate,
      ];

      const batchResult = await service.attributeBatch({
        profile: validProfile,
        candidates,
      });

      expect(batchResult.length).toBe(2);
      expect(batchResult.map((o) => o.conversation.id)).toEqual([
        highRelevanceCandidate.id,
        lowRelevanceCandidate.id,
      ]);
    });

    it('updates existing opportunity on re-attribution while preserving ID, createdAt, and status', async () => {
      const initial = await service.attributeOpportunity({
        profile: validProfile,
        candidate: highRelevanceCandidate,
      });

      // Operator updates status to REVIEWED
      await service.updateOpportunity(initial.id, { status: 'REVIEWED' });

      // Later run re-evaluates the same conversation with updated excerpt
      const updatedCandidate = {
        ...highRelevanceCandidate,
        contentExcerpt: `${highRelevanceCandidate.contentExcerpt} Additional details added.`,
      };

      const reattributed = await service.attributeOpportunity({
        profile: validProfile,
        candidate: updatedCandidate,
      });

      expect(reattributed.id).toBe(initial.id); // Same Opportunity ID
      expect(reattributed.createdAt).toBe(initial.createdAt); // Preserved creation time
      expect(reattributed.status).toBe('REVIEWED'); // Preserved operator status!
      expect(reattributed.conversation.contentExcerpt).toContain('Additional details added');
    });
  });

  describe('Low and High Relevance Candidates (No Silent Discarding)', () => {
    it('never silently discards low relevance candidates; score communicates relevance', async () => {
      const batch = await service.attributeBatch({
        profile: validProfile,
        candidates: [highRelevanceCandidate, lowRelevanceCandidate, excludedTopicCandidate],
      });

      expect(batch.length).toBe(3);

      const highOpp = batch.find((o) => o.conversation.id === highRelevanceCandidate.id);
      const lowOpp = batch.find((o) => o.conversation.id === lowRelevanceCandidate.id);
      const exclOpp = batch.find((o) => o.conversation.id === excludedTopicCandidate.id);

      expect(highOpp?.relevanceScore).toBeGreaterThanOrEqual(75);
      expect(lowOpp?.relevanceScore).toBeLessThan(40);
      expect(exclOpp?.relevanceScore).toBeLessThanOrEqual(15);
    });

    it('orders batch results deterministically by relevanceScore DESC', async () => {
      const batch = await service.attributeBatch({
        profile: validProfile,
        candidates: [lowRelevanceCandidate, highRelevanceCandidate, excludedTopicCandidate],
      });

      for (let i = 0; i < batch.length - 1; i++) {
        expect(batch[i]!.relevanceScore).toBeGreaterThanOrEqual(batch[i + 1]!.relevanceScore);
      }
    });
  });

  describe('Empty and Incomplete Profiles', () => {
    it('evaluates minimal profiles without crashing', async () => {
      const minimalProfile: ProductProfile = {
        id: 'prof-minimal-1',
        productName: 'SimpleScribe',
        valueProposition: 'Audio notes tool',
        problemsSolved: ['Slow note taking'],
        idealCustomerDescription: 'Students',
        seedKeywords: [],
        customerPainPointPhrases: [],
        excludedTopics: [],
        toneGuidelines: ['Direct'],
        createdAt: '2026-10-14T00:00:00.000Z',
        updatedAt: '2026-10-14T00:00:00.000Z',
      };

      const opp = await service.attributeOpportunity({
        profile: minimalProfile,
        candidate: highRelevanceCandidate,
      });

      expect(opp.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(opp.relevanceScore).toBeLessThanOrEqual(100);
      expect(opp.whyMatched).toBeDefined();
    });

    it('throws ProfileValidationError when an invalid profile is passed', async () => {
      await expect(
        service.attributeOpportunity({
          profile: { productName: 'Incomplete' } as unknown as ProductProfile,
          candidate: highRelevanceCandidate,
        }),
      ).rejects.toThrow(ProfileValidationError);
    });
  });

  describe('Opportunity Management CRUD', () => {
    it('retrieves opportunity by ID or throws OpportunityNotFoundError', async () => {
      const opp = await service.attributeOpportunity({
        profile: validProfile,
        candidate: highRelevanceCandidate,
      });

      const found = await service.getOpportunity(opp.id);
      expect(found).toEqual(opp);

      await expect(service.getOpportunity('nonexistent-id')).rejects.toThrow(
        OpportunityNotFoundError,
      );
    });

    it('deletes an opportunity', async () => {
      const opp = await service.attributeOpportunity({
        profile: validProfile,
        candidate: highRelevanceCandidate,
      });

      const deleted = await service.deleteOpportunity(opp.id);
      expect(deleted).toBe(true);

      const found = await service.findOpportunity(opp.id);
      expect(found).toBeNull();
    });

    it('filters opportunities by status and minScore', async () => {
      await service.attributeBatch({
        profile: validProfile,
        candidates: [highRelevanceCandidate, lowRelevanceCandidate],
      });

      const highOnly = await service.listOpportunities({ minScore: 50 });
      expect(highOnly.length).toBe(1);
      expect(highOnly[0]?.conversation.id).toBe(highRelevanceCandidate.id);
    });
  });
});

describe('FileOpportunityRepository (Disk Persistence)', () => {
  let tempDir: string;
  let tempFile: string;
  let fileRepo: FileOpportunityRepository;
  let service: OpportunityService;

  const sampleProfile: ProductProfile = {
    id: 'prof-file-test',
    productName: 'ClipBot',
    valueProposition: 'Creates viral clips from long video',
    problemsSolved: ['Finding viral moments'],
    idealCustomerDescription: 'Streamers',
    seedKeywords: ['clip generator'],
    customerPainPointPhrases: ['manual clipping'],
    excludedTopics: [],
    toneGuidelines: ['Direct'],
    createdAt: '2026-10-14T00:00:00.000Z',
    updatedAt: '2026-10-14T00:00:00.000Z',
  };

  const sampleCandidate: ConversationItem = {
    id: 'conv-file-1',
    platform: 'reddit',
    authorAlias: 'streamer_joe',
    contentExcerpt: 'Looking for a clip generator for twitch highlights.',
    sourcePermalink: 'https://reddit.com/r/twitch/comments/file1',
    timestamp: '2026-10-14T14:00:00.000Z',
    matchedKeywords: ['clip generator'],
    sourceProvenance: 'LIVE',
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cold-reach-opp-'));
    tempFile = path.join(tempDir, 'opportunities.json');
    fileRepo = new FileOpportunityRepository(tempFile);
    service = new OpportunityService(fileRepo);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore windows lock cleanup error
    }
  });

  it('persists opportunities to disk and reloads across new repository instances', async () => {
    const opp = await service.attributeOpportunity({
      profile: sampleProfile,
      candidate: sampleCandidate,
    });

    // Check disk content
    const rawContent = await fs.readFile(tempFile, 'utf-8');
    expect(rawContent).toContain('ClipBot');
    expect(rawContent).toContain('streamer_joe');

    // Instantiate fresh repository pointing to the same file
    const newRepo = new FileOpportunityRepository(tempFile);
    const reloadedService = new OpportunityService(newRepo);

    const reloaded = await reloadedService.getOpportunity(opp.id);
    expect(reloaded.id).toBe(opp.id);
    expect(reloaded.relevanceScore).toBe(opp.relevanceScore);
    expect(reloaded.conversation.authorAlias).toBe('streamer_joe');
  });

  it('updates and persists modifications in file repository', async () => {
    const opp = await service.attributeOpportunity({
      profile: sampleProfile,
      candidate: sampleCandidate,
    });

    await service.updateOpportunity(opp.id, { status: 'REVIEWED' });

    const rawContent = await fs.readFile(tempFile, 'utf-8');
    expect(rawContent).toContain('"status": "REVIEWED"');
  });

  it('deletes records from file repository', async () => {
    const opp = await service.attributeOpportunity({
      profile: sampleProfile,
      candidate: sampleCandidate,
    });

    await service.deleteOpportunity(opp.id);

    const newRepo = new FileOpportunityRepository(tempFile);
    const found = await newRepo.findById(opp.id);
    expect(found).toBeNull();
  });
});
