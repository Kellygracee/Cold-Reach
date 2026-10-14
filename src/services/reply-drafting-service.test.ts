import { describe, expect, it } from 'vitest';
import {
  DraftNotFoundError,
  DraftProviderNotConfiguredError,
  LowScoreOverrideRequiredError,
  ManualResponseWorkflowRequiredError,
} from '../contracts/draft-provider.js';
import { ConversationItem } from '../contracts/conversation.js';
import { Opportunity } from '../contracts/opportunity.js';
import { ProductProfile } from '../contracts/profile.js';
import { DefaultAiDraftProvider } from '../providers/default-ai-draft-provider.js';
import { MockDraftProvider } from '../providers/mock-draft-provider.js';
import { InMemoryOpportunityRepository } from '../storage/opportunity-repository.js';
import { DraftPromptBuilder } from './draft-prompt-builder.js';
import { ReplyDraftingService } from './reply-drafting-service.js';

describe('Phase 5: Contextual Reply Drafting and Human Review', () => {
  const testProfile: ProductProfile = {
    id: 'prof-test-1',
    productName: 'FlowScribe AI',
    valueProposition: 'Automated high-accuracy podcast transcriptions and chapter markers.',
    productDescription: 'Audio processing tool that cuts transcription turnaround time.',
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
    createdAt: '2026-03-01T12:00:00.000Z',
    updatedAt: '2026-03-01T12:00:00.000Z',
  };

  const highRelevanceCandidate: ConversationItem = {
    id: 'hn-12345',
    platform: 'Hacker News',
    authorAlias: 'dan_podcaster',
    contentExcerpt:
      'I host a technical interview show and spend hours manually transcribing audio every weekend. Looking for advice or tool workflows.',
    sourcePermalink: 'https://news.ycombinator.com/item?id=12345',
    timestamp: '2026-03-02T10:00:00.000Z',
    matchedKeywords: ['manually transcribing audio'],
    sourceProvenance: 'LIVE',
  };

  const highRelevanceOpportunity: Opportunity = {
    id: 'opp-hn-12345',
    conversation: highRelevanceCandidate,
    relevanceScore: 82,
    whyMatched: {
      summary: 'Matches problem solved: Hours spent manually transcribing audio',
      matchedNeeds: ['Hours spent manually transcribing audio'],
      relevanceRationale:
        'Author is explicitly dealing with hours spent manually transcribing audio, which aligns with FlowScribe AI.',
      contextSnippet: 'spend hours manually transcribing audio every weekend',
    },
    replyDraft: null,
    status: 'NEW',
    createdAt: '2026-03-02T10:05:00.000Z',
    updatedAt: '2026-03-02T10:05:00.000Z',
  };

  const lowRelevanceOpportunity: Opportunity = {
    id: 'opp-hn-99999',
    conversation: {
      id: 'hn-99999',
      platform: 'Hacker News',
      authorAlias: 'casual_coder',
      contentExcerpt:
        'I heard some podcasts do audio processing in Python. Wondering how that works.',
      sourcePermalink: 'https://news.ycombinator.com/item?id=99999',
      timestamp: '2026-03-02T11:00:00.000Z',
      matchedKeywords: ['audio'],
      sourceProvenance: 'LIVE',
    },
    relevanceScore: 28,
    whyMatched: {
      summary: 'Peripheral mention of audio processing without immediate commercial pain point',
      matchedNeeds: ['Audio processing inquiry'],
      relevanceRationale: 'Casual technical inquiry without clear pain-point fit.',
      contextSnippet: 'audio processing in Python',
    },
    replyDraft: null,
    status: 'NEW',
    createdAt: '2026-03-02T11:05:00.000Z',
    updatedAt: '2026-03-02T11:05:00.000Z',
  };

  describe('Grounded Prompt Building & Drafting Rules', () => {
    it('builds a prompt requiring answering first, product mention only when relevant, and no hallucinations', () => {
      const prompt = DraftPromptBuilder.buildPrompt({
        profile: testProfile,
        conversation: highRelevanceCandidate,
        whyMatched: highRelevanceOpportunity.whyMatched,
        relevanceScore: highRelevanceOpportunity.relevanceScore,
      });

      expect(prompt.systemPrompt).toContain('ANSWER FIRST');
      expect(prompt.systemPrompt).toContain('MENTION PRODUCT ONLY WHEN DIRECTLY RELEVANT');
      expect(prompt.systemPrompt).toContain('STRICTLY GROUNDED (NO HALLUCINATIONS)');
      expect(prompt.systemPrompt).toContain('NO HANDLE OR BIO INFERENCES');
      expect(prompt.systemPrompt).toContain('TRANSPARENCY NOTE');

      expect(prompt.userPrompt).toContain('FlowScribe AI');
      expect(prompt.userPrompt).toContain(testProfile.valueProposition);
      expect(prompt.userPrompt).toContain('Author Handle: dan_podcaster');
      expect(prompt.userPrompt).toContain('do NOT guess background or audience from handle');
    });

    it('generates a draft answering conversation first and grounding claims strictly in profile', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const mockProvider = new MockDraftProvider();
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: mockProvider,
      });

      const draft = await service.generateDraft({
        opportunityId: highRelevanceOpportunity.id,
        profile: testProfile,
      });

      // Draft must answer first
      expect(draft.replyText).toContain(
        'practical approach to handling hours spent manually transcribing audio',
      );
      // Must mention product and value prop accurately
      expect(draft.replyText).toContain('FlowScribe AI');
      expect(draft.replyText).toContain(testProfile.valueProposition.toLowerCase());
      // Must not invent claims (e.g. 99.9% accuracy, $5/mo, 10M users)
      expect(draft.replyText).not.toContain('99.9%');
      expect(draft.replyText).not.toContain('free trial');
      expect(draft.replyText).not.toContain('$');
    });

    it('does not infer author details, audience size, or career from author handle', async () => {
      let capturedPrompt: string | undefined;
      const customProvider = new MockDraftProvider({
        customReplyGenerator: (p) => {
          capturedPrompt = p.userPrompt;
          return {
            replyText: 'Helpful advice without assuming audience size.',
            valueAngle: testProfile.valueProposition,
            transparencyNote: DraftPromptBuilder.buildTransparencyNote(testProfile),
          };
        },
      });

      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: customProvider,
      });

      await service.generateDraft({
        opportunityId: highRelevanceOpportunity.id,
        profile: testProfile,
      });

      expect(capturedPrompt).toBeDefined();
      expect(capturedPrompt).toContain('do NOT guess background or audience from handle');
    });
  });

  describe('Transparency Notes & Disclosures', () => {
    it('generates standardized transparency note disclosing product affiliation', () => {
      const note = DraftPromptBuilder.buildTransparencyNote(testProfile);
      expect(note).toBe(
        'Transparency: I am affiliated with FlowScribe AI (Automated high-accuracy podcast transcriptions and chapter markers.).',
      );
    });

    it('includes required transparency note in generated draft reply', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: new MockDraftProvider(),
      });

      const draft = await service.generateDraft({
        opportunityId: highRelevanceOpportunity.id,
        profile: testProfile,
      });

      expect(draft.transparencyNote).toContain('Transparency: I am affiliated with FlowScribe AI');
      expect(draft.transparencyNote).toContain(testProfile.valueProposition);
    });

    it('includes transparency note in clipboard copy by default', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: new MockDraftProvider(),
      });

      await service.generateDraft({
        opportunityId: highRelevanceOpportunity.id,
        profile: testProfile,
      });

      const copyResult = await service.copyDraft(highRelevanceOpportunity.id);
      expect(copyResult.clipboardText).toContain(
        'Transparency: I am affiliated with FlowScribe AI',
      );
      expect(copyResult.sourcePermalink).toBe(highRelevanceCandidate.sourcePermalink);
      expect(copyResult.characterCount).toBe(copyResult.clipboardText.length);
    });

    it('supports copying without transparency note if explicitly requested', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: new MockDraftProvider(),
      });

      const draft = await service.generateDraft({
        opportunityId: highRelevanceOpportunity.id,
        profile: testProfile,
      });

      const copyResult = await service.copyDraft(highRelevanceOpportunity.id, {
        includeTransparencyNote: false,
      });
      expect(copyResult.clipboardText).toBe(draft.replyText);
      expect(copyResult.clipboardText).not.toContain('Transparency:');
    });
  });

  describe('Low-Score Confirmation (< 40)', () => {
    it('blocks drafting when relevance score is below 40 without explicit override', async () => {
      const repository = new InMemoryOpportunityRepository([lowRelevanceOpportunity]);
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: new MockDraftProvider(),
      });

      await expect(
        service.generateDraft({
          opportunityId: lowRelevanceOpportunity.id,
          profile: testProfile,
        }),
      ).rejects.toThrow(LowScoreOverrideRequiredError);

      try {
        await service.generateDraft({
          opportunityId: lowRelevanceOpportunity.id,
          profile: testProfile,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(LowScoreOverrideRequiredError);
        const lowErr = err as LowScoreOverrideRequiredError;
        expect(lowErr.relevanceScore).toBe(28);
        expect(lowErr.threshold).toBe(40);
        expect(lowErr.warning).toContain('Warning: This opportunity has a relevance score of 28');
        expect(lowErr.warning).toContain('allowLowScoreOverride: true');
      }
    });

    it('allows drafting on score below 40 when allowLowScoreOverride is true', async () => {
      const repository = new InMemoryOpportunityRepository([lowRelevanceOpportunity]);
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: new MockDraftProvider(),
      });

      const draft = await service.generateDraft({
        opportunityId: lowRelevanceOpportunity.id,
        profile: testProfile,
        allowLowScoreOverride: true,
      });

      expect(draft).toBeDefined();
      expect(draft.replyText).toBeTruthy();

      const updated = await repository.findById(lowRelevanceOpportunity.id);
      expect(updated?.status).toBe('REVIEWED');
      expect(updated?.replyDraft).not.toBeNull();
    });

    it('does not require override when relevance score is >= 40', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: new MockDraftProvider(),
      });

      const draft = await service.generateDraft({
        opportunityId: highRelevanceOpportunity.id,
        profile: testProfile,
      });

      expect(draft).toBeDefined();
    });
  });

  describe('Human Edits & Revision History', () => {
    it('tracks human edits as revisions in DraftReply with editedBy: USER', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: new MockDraftProvider(),
      });

      const initialDraft = await service.generateDraft({
        opportunityId: highRelevanceOpportunity.id,
        profile: testProfile,
      });

      expect(initialDraft.revisionHistory).toHaveLength(0);

      const editedDraft = await service.editDraft(highRelevanceOpportunity.id, {
        newText: 'Custom human edited reply addressing specific question directly.',
        changeSummary: 'Clarified podcast workflow steps.',
      });

      expect(editedDraft.replyText).toBe(
        'Custom human edited reply addressing specific question directly.',
      );
      expect(editedDraft.revisionHistory).toHaveLength(1);
      expect(editedDraft.revisionHistory[0].editedBy).toBe('USER');
      expect(editedDraft.revisionHistory[0].previousText).toBe(initialDraft.replyText);
      expect(editedDraft.revisionHistory[0].newText).toBe(
        'Custom human edited reply addressing specific question directly.',
      );
      expect(editedDraft.revisionHistory[0].changeSummary).toBe(
        'Clarified podcast workflow steps.',
      );
      expect(new Date(editedDraft.revisionHistory[0].editedAt).getTime()).not.toBeNaN();
    });

    it('accumulates multiple sequential revisions in chronological order', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: new MockDraftProvider(),
      });

      await service.generateDraft({
        opportunityId: highRelevanceOpportunity.id,
        profile: testProfile,
      });

      await service.editDraft(highRelevanceOpportunity.id, {
        newText: 'First edit text.',
        changeSummary: 'First revision',
      });

      const secondEdit = await service.editDraft(highRelevanceOpportunity.id, {
        newText: 'Second edit text.',
        changeSummary: 'Second revision',
      });

      expect(secondEdit.revisionHistory).toHaveLength(2);
      expect(secondEdit.revisionHistory[0].newText).toBe('First edit text.');
      expect(secondEdit.revisionHistory[1].previousText).toBe('First edit text.');
      expect(secondEdit.revisionHistory[1].newText).toBe('Second edit text.');
    });

    it('rejects editing a non-existent draft', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: new MockDraftProvider(),
      });

      await expect(
        service.editDraft(highRelevanceOpportunity.id, {
          newText: 'Should fail because draft is null',
        }),
      ).rejects.toThrow(DraftNotFoundError);
    });

    it('rejects blank edit text', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: new MockDraftProvider(),
      });

      await service.generateDraft({
        opportunityId: highRelevanceOpportunity.id,
        profile: testProfile,
      });

      await expect(
        service.editDraft(highRelevanceOpportunity.id, {
          newText: '   ',
        }),
      ).rejects.toThrow('New revision text cannot be blank or empty');
    });
  });

  describe('Missing Provider Configuration Safeguards', () => {
    it('reports isConfigured() as false when no AI API keys are present in environment', () => {
      const unconfiguredProvider = new DefaultAiDraftProvider();
      expect(unconfiguredProvider.name).toBe('StandardAiDraftProvider');
      expect(unconfiguredProvider.isConfigured()).toBe(false);
    });

    it('throws DraftProviderNotConfiguredError when attempting to draft without credentials', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: new DefaultAiDraftProvider(),
      });

      await expect(
        service.generateDraft({
          opportunityId: highRelevanceOpportunity.id,
          profile: testProfile,
        }),
      ).rejects.toThrow(DraftProviderNotConfiguredError);

      try {
        await service.generateDraft({
          opportunityId: highRelevanceOpportunity.id,
          profile: testProfile,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(DraftProviderNotConfiguredError);
        const draftErr = err as DraftProviderNotConfiguredError;
        expect(draftErr.message).toContain('is not configured');
        expect(draftErr.message).toContain('Mock or placeholder credentials are not permitted');
      }
    });

    it('does not invent fake credentials or present a mock as a real live draft', () => {
      const provider = new DefaultAiDraftProvider();
      expect(provider.isConfigured()).toBe(false);
      const mockProvider = new MockDraftProvider();
      expect(mockProvider.name).toBe('MockDraftProvider');
    });
  });

  describe('No-Send Guarantees & Human Review Boundary', () => {
    it('confirms hasAutomatedDispatchCapability() is false', () => {
      const service = new ReplyDraftingService();
      expect(service.hasAutomatedDispatchCapability()).toBe(false);
    });

    it('refuses to transition opportunity to RESPONDED via drafting service', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({ opportunityRepository: repository });

      await expect(
        service.setReviewStatus(highRelevanceOpportunity.id, 'RESPONDED' as unknown as 'REVIEWED'),
      ).rejects.toThrow(ManualResponseWorkflowRequiredError);
    });

    it('transitions opportunity from NEW to REVIEWED upon drafting, never RESPONDED', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: new MockDraftProvider(),
      });

      await service.generateDraft({
        opportunityId: highRelevanceOpportunity.id,
        profile: testProfile,
      });

      const updated = await repository.findById(highRelevanceOpportunity.id);
      expect(updated?.status).toBe('REVIEWED');
      expect(updated?.status).not.toBe('RESPONDED');
      expect(updated?.manualResponseAudit).toBeUndefined();
    });

    it('allows transitioning between NEW, REVIEWED, and SKIPPED', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({ opportunityRepository: repository });

      const skipped = await service.setReviewStatus(highRelevanceOpportunity.id, 'SKIPPED');
      expect(skipped.status).toBe('SKIPPED');

      const reviewed = await service.setReviewStatus(highRelevanceOpportunity.id, 'REVIEWED');
      expect(reviewed.status).toBe('REVIEWED');
    });
  });

  describe('UI Service Actions & Review Data', () => {
    it('returns complete review payload for future UI', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({
        opportunityRepository: repository,
        provider: new MockDraftProvider(),
      });

      await service.generateDraft({
        opportunityId: highRelevanceOpportunity.id,
        profile: testProfile,
      });

      const reviewData = await service.getReviewData(highRelevanceOpportunity.id, testProfile);
      expect(reviewData.opportunity.id).toBe(highRelevanceOpportunity.id);
      expect(reviewData.candidate.platform).toBe('Hacker News');
      expect(reviewData.sourcePermalink).toBe(highRelevanceCandidate.sourcePermalink);
      expect(reviewData.relevanceScore).toBe(82);
      expect(reviewData.relevanceAssessment.isLowRelevance).toBe(false);
      expect(reviewData.draft).not.toBeNull();
      expect(reviewData.isDraftProviderConfigured).toBe(true);
      expect(reviewData.revisionCount).toBe(0);
      expect(reviewData.status).toBe('REVIEWED');
    });

    it('returns original source link directly', async () => {
      const repository = new InMemoryOpportunityRepository([highRelevanceOpportunity]);
      const service = new ReplyDraftingService({ opportunityRepository: repository });

      const link = await service.getOriginalSourceLink(highRelevanceOpportunity.id);
      expect(link).toBe(highRelevanceCandidate.sourcePermalink);
    });
  });
});
