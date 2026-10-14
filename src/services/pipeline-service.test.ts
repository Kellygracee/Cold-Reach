import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Opportunity } from '../contracts/opportunity.js';
import {
  AuditImmutabilityError,
  InvalidStatusTransitionError,
  MissingManualResponseAuditError,
} from '../contracts/pipeline.js';
import {
  FileOpportunityRepository,
  InMemoryOpportunityRepository,
} from '../storage/opportunity-repository.js';
import { PipelineService } from './pipeline-service.js';

describe('Phase 6: Opportunity Tracking and Pipeline Service', () => {
  const sampleOpportunity: Opportunity = {
    id: 'opp-hn-101',
    conversation: {
      id: 'hn-101',
      platform: 'Hacker News',
      authorAlias: 'tech_lead_dan',
      contentExcerpt: 'We are evaluating speech transcription tools for our weekly podcast.',
      sourcePermalink: 'https://news.ycombinator.com/item?id=101',
      timestamp: '2026-03-01T12:00:00.000Z',
      matchedKeywords: ['speech transcription'],
      sourceProvenance: 'LIVE',
    },
    relevanceScore: 85,
    whyMatched: {
      summary: 'Matches transcription problem solved',
      matchedNeeds: ['Speech transcription speed'],
      relevanceRationale: 'High alignment with audio transcription workflow.',
      contextSnippet: 'evaluating speech transcription tools',
    },
    replyDraft: null,
    status: 'NEW',
    statusHistory: [],
    createdAt: '2026-03-01T12:05:00.000Z',
    updatedAt: '2026-03-01T12:05:00.000Z',
  };

  const createTestDataset = (): Opportunity[] => [
    {
      ...sampleOpportunity,
      id: 'opp-1',
      relevanceScore: 90,
      status: 'NEW',
      conversation: {
        ...sampleOpportunity.conversation,
        id: 'c-1',
        platform: 'Hacker News',
        sourceProvenance: 'LIVE',
      },
    },
    {
      ...sampleOpportunity,
      id: 'opp-2',
      relevanceScore: 75,
      status: 'REVIEWED',
      conversation: {
        ...sampleOpportunity.conversation,
        id: 'c-2',
        platform: 'Reddit',
        sourceProvenance: 'LIVE',
      },
      createdAt: '2026-03-02T10:00:00.000Z',
    },
    {
      ...sampleOpportunity,
      id: 'opp-3',
      relevanceScore: 35,
      status: 'SKIPPED',
      conversation: {
        ...sampleOpportunity.conversation,
        id: 'c-3',
        platform: 'Bluesky',
        sourceProvenance: 'LIVE',
      },
      createdAt: '2026-03-03T10:00:00.000Z',
    },
    {
      ...sampleOpportunity,
      id: 'opp-4',
      relevanceScore: 88,
      status: 'RESPONDED',
      conversation: {
        ...sampleOpportunity.conversation,
        id: 'c-4',
        platform: 'Hacker News',
        sourceProvenance: 'DEMO',
      },
      manualResponseAudit: {
        markedSentAt: '2026-03-04T12:00:00.000Z',
        manualDispatchConfirmed: true,
        dispatchMethod: 'MANUAL_EXTERNAL_POST',
        operatorNotes: 'Manually commented via browser.',
      },
      createdAt: '2026-03-04T10:00:00.000Z',
    },
  ];

  describe('Valid Status Transitions & History Tracking', () => {
    it('transitions from NEW to REVIEWED with statusHistory tracking', async () => {
      const repo = new InMemoryOpportunityRepository([sampleOpportunity]);
      const service = new PipelineService(repo);

      const updated = await service.transitionStatus({
        opportunityId: sampleOpportunity.id,
        toStatus: 'REVIEWED',
        reason: 'Reviewed conversation and prepared draft',
        userReviewNotes: 'Good candidate for manual follow-up',
      });

      expect(updated.status).toBe('REVIEWED');
      expect(updated.userReviewNotes).toBe('Good candidate for manual follow-up');
      expect(updated.statusHistory).toHaveLength(1);
      expect(updated.statusHistory[0].fromStatus).toBe('NEW');
      expect(updated.statusHistory[0].toStatus).toBe('REVIEWED');
      expect(updated.statusHistory[0].changedBy).toBe('USER');
      expect(updated.statusHistory[0].reason).toBe('Reviewed conversation and prepared draft');
      expect(new Date(updated.statusHistory[0].timestamp).getTime()).not.toBeNaN();
    });

    it('transitions from NEW to SKIPPED', async () => {
      const repo = new InMemoryOpportunityRepository([sampleOpportunity]);
      const service = new PipelineService(repo);

      const updated = await service.transitionStatus({
        opportunityId: sampleOpportunity.id,
        toStatus: 'SKIPPED',
        reason: 'User already solved problem',
      });

      expect(updated.status).toBe('SKIPPED');
      expect(updated.statusHistory).toHaveLength(1);
      expect(updated.statusHistory[0].toStatus).toBe('SKIPPED');
    });

    it('transitions from REVIEWED to SKIPPED', async () => {
      const reviewedOpp: Opportunity = { ...sampleOpportunity, status: 'REVIEWED' };
      const repo = new InMemoryOpportunityRepository([reviewedOpp]);
      const service = new PipelineService(repo);

      const updated = await service.transitionStatus({
        opportunityId: reviewedOpp.id,
        toStatus: 'SKIPPED',
        reason: 'Decided not to pursue after second review',
      });

      expect(updated.status).toBe('SKIPPED');
    });

    it('transitions from REVIEWED to NEW (re-queue)', async () => {
      const reviewedOpp: Opportunity = { ...sampleOpportunity, status: 'REVIEWED' };
      const repo = new InMemoryOpportunityRepository([reviewedOpp]);
      const service = new PipelineService(repo);

      const updated = await service.transitionStatus({
        opportunityId: reviewedOpp.id,
        toStatus: 'NEW',
        reason: 'Reset back to triage queue',
      });

      expect(updated.status).toBe('NEW');
    });

    it('transitions from SKIPPED to NEW (re-open)', async () => {
      const skippedOpp: Opportunity = { ...sampleOpportunity, status: 'SKIPPED' };
      const repo = new InMemoryOpportunityRepository([skippedOpp]);
      const service = new PipelineService(repo);

      const updated = await service.transitionStatus({
        opportunityId: skippedOpp.id,
        toStatus: 'NEW',
        reason: 'Reopened by operator',
      });

      expect(updated.status).toBe('NEW');
    });

    it('transitions from SKIPPED to REVIEWED (re-open directly to reviewed)', async () => {
      const skippedOpp: Opportunity = { ...sampleOpportunity, status: 'SKIPPED' };
      const repo = new InMemoryOpportunityRepository([skippedOpp]);
      const service = new PipelineService(repo);

      const updated = await service.transitionStatus({
        opportunityId: skippedOpp.id,
        toStatus: 'REVIEWED',
        reason: 'Reopened directly for drafting',
      });

      expect(updated.status).toBe('REVIEWED');
    });

    it('handles idempotent transition with review notes update without appending duplicate history', async () => {
      const reviewedOpp: Opportunity = { ...sampleOpportunity, status: 'REVIEWED' };
      const repo = new InMemoryOpportunityRepository([reviewedOpp]);
      const service = new PipelineService(repo);

      const updated = await service.transitionStatus({
        opportunityId: reviewedOpp.id,
        toStatus: 'REVIEWED',
        userReviewNotes: 'Updated operator notes only',
      });

      expect(updated.status).toBe('REVIEWED');
      expect(updated.userReviewNotes).toBe('Updated operator notes only');
      expect(updated.statusHistory).toHaveLength(0);
    });
  });

  describe('Invalid Status Transitions', () => {
    it('blocks transitioning from SKIPPED to RESPONDED directly', async () => {
      const skippedOpp: Opportunity = { ...sampleOpportunity, status: 'SKIPPED' };
      const repo = new InMemoryOpportunityRepository([skippedOpp]);
      const service = new PipelineService(repo);

      await expect(
        service.transitionStatus({
          opportunityId: skippedOpp.id,
          toStatus: 'RESPONDED',
          manualResponseAudit: {
            markedSentAt: new Date().toISOString(),
            manualDispatchConfirmed: true,
            dispatchMethod: 'MANUAL_EXTERNAL_POST',
          },
        }),
      ).rejects.toThrow(InvalidStatusTransitionError);
    });

    it('blocks transitioning away from terminal RESPONDED state to NEW, REVIEWED, or SKIPPED', async () => {
      const respondedOpp: Opportunity = {
        ...sampleOpportunity,
        status: 'RESPONDED',
        manualResponseAudit: {
          markedSentAt: '2026-03-01T14:00:00.000Z',
          manualDispatchConfirmed: true,
          dispatchMethod: 'MANUAL_EXTERNAL_POST',
          operatorNotes: 'Outreach completed outside app.',
        },
      };
      const repo = new InMemoryOpportunityRepository([respondedOpp]);
      const service = new PipelineService(repo);

      for (const targetStatus of ['NEW', 'REVIEWED', 'SKIPPED'] as const) {
        await expect(
          service.transitionStatus({
            opportunityId: respondedOpp.id,
            toStatus: targetStatus,
          }),
        ).rejects.toThrow(AuditImmutabilityError);
      }
    });
  });

  describe('Manual Response Auditing Requirements & Immutability', () => {
    it('requires complete manualResponseAudit record when transitioning to RESPONDED', async () => {
      const reviewedOpp: Opportunity = { ...sampleOpportunity, status: 'REVIEWED' };
      const repo = new InMemoryOpportunityRepository([reviewedOpp]);
      const service = new PipelineService(repo);

      await expect(
        service.transitionStatus({
          opportunityId: reviewedOpp.id,
          toStatus: 'RESPONDED',
        }),
      ).rejects.toThrow(MissingManualResponseAuditError);
    });

    it('rejects transition to RESPONDED if manualDispatchConfirmed is not true', async () => {
      const reviewedOpp: Opportunity = { ...sampleOpportunity, status: 'REVIEWED' };
      const repo = new InMemoryOpportunityRepository([reviewedOpp]);
      const service = new PipelineService(repo);

      await expect(
        service.transitionStatus({
          opportunityId: reviewedOpp.id,
          toStatus: 'RESPONDED',
          manualResponseAudit: {
            markedSentAt: new Date().toISOString(),
            manualDispatchConfirmed: false as unknown as true,
            dispatchMethod: 'MANUAL_EXTERNAL_POST',
          },
        }),
      ).rejects.toThrow(MissingManualResponseAuditError);
    });

    it('records manual response via recordManualResponse helper', async () => {
      const reviewedOpp: Opportunity = { ...sampleOpportunity, status: 'REVIEWED' };
      const repo = new InMemoryOpportunityRepository([reviewedOpp]);
      const service = new PipelineService(repo);

      const responded = await service.recordManualResponse({
        opportunityId: reviewedOpp.id,
        operatorNotes: 'Copied draft and replied on Hacker News thread via web browser.',
        userReviewNotes: 'Positive feedback received.',
        manualDispatchConfirmed: true,
      });

      expect(responded.status).toBe('RESPONDED');
      expect(responded.manualResponseAudit).toBeDefined();
      expect(responded.manualResponseAudit?.dispatchMethod).toBe('MANUAL_EXTERNAL_POST');
      expect(responded.manualResponseAudit?.manualDispatchConfirmed).toBe(true);
      expect(responded.manualResponseAudit?.operatorNotes).toContain('replied on Hacker News');
      expect(responded.userReviewNotes).toBe('Positive feedback received.');
      expect(responded.statusHistory).toHaveLength(1);
      expect(responded.statusHistory[0].toStatus).toBe('RESPONDED');
    });

    it('enforces audit immutability by blocking modifications to existing response audit', async () => {
      const respondedOpp: Opportunity = {
        ...sampleOpportunity,
        status: 'RESPONDED',
        manualResponseAudit: {
          markedSentAt: '2026-03-01T14:00:00.000Z',
          manualDispatchConfirmed: true,
          dispatchMethod: 'MANUAL_EXTERNAL_POST',
          operatorNotes: 'Initial outreach audit note.',
        },
      };
      const repo = new InMemoryOpportunityRepository([respondedOpp]);
      const service = new PipelineService(repo);

      // Attempting to overwrite markedSentAt must throw AuditImmutabilityError
      await expect(
        service.transitionStatus({
          opportunityId: respondedOpp.id,
          toStatus: 'RESPONDED',
          manualResponseAudit: {
            markedSentAt: '2026-03-02T10:00:00.000Z', // Different timestamp!
            manualDispatchConfirmed: true,
            dispatchMethod: 'MANUAL_EXTERNAL_POST',
          },
        }),
      ).rejects.toThrow(AuditImmutabilityError);
    });

    it('allows updating userReviewNotes on an already responded opportunity without mutating audit', async () => {
      const respondedOpp: Opportunity = {
        ...sampleOpportunity,
        status: 'RESPONDED',
        manualResponseAudit: {
          markedSentAt: '2026-03-01T14:00:00.000Z',
          manualDispatchConfirmed: true,
          dispatchMethod: 'MANUAL_EXTERNAL_POST',
          operatorNotes: 'Initial outreach audit note.',
        },
      };
      const repo = new InMemoryOpportunityRepository([respondedOpp]);
      const service = new PipelineService(repo);

      const updated = await service.updateReviewNotes(
        respondedOpp.id,
        'Author replied positively and requested early access.',
      );

      expect(updated.status).toBe('RESPONDED');
      expect(updated.userReviewNotes).toBe('Author replied positively and requested early access.');
      expect(updated.manualResponseAudit?.markedSentAt).toBe('2026-03-01T14:00:00.000Z');
    });
  });

  describe('Persistence of Status History & Review Notes across Disk Restarts', () => {
    it('persists status history, review notes, and response audit in FileOpportunityRepository', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cold-reach-pipeline-test-'));
      const filePath = path.join(tempDir, 'opportunities.json');

      try {
        const fileRepo1 = new FileOpportunityRepository(filePath);
        await fileRepo1.save(sampleOpportunity);

        const service1 = new PipelineService(fileRepo1);
        await service1.transitionStatus({
          opportunityId: sampleOpportunity.id,
          toStatus: 'REVIEWED',
          reason: 'Prepared reply draft',
          userReviewNotes: 'High priority lead',
        });

        await service1.recordManualResponse({
          opportunityId: sampleOpportunity.id,
          operatorNotes: 'Outreach posted manually outside app',
          manualDispatchConfirmed: true,
        });

        // Instantiate fresh repository pointing to the same file to simulate restart
        const fileRepo2 = new FileOpportunityRepository(filePath);
        const service2 = new PipelineService(fileRepo2);

        const loaded = await service2.getOpportunity(sampleOpportunity.id);
        expect(loaded.status).toBe('RESPONDED');
        expect(loaded.userReviewNotes).toBe('High priority lead');
        expect(loaded.statusHistory).toHaveLength(2);
        expect(loaded.statusHistory[0].toStatus).toBe('REVIEWED');
        expect(loaded.statusHistory[1].toStatus).toBe('RESPONDED');
        expect(loaded.manualResponseAudit?.dispatchMethod).toBe('MANUAL_EXTERNAL_POST');
        expect(loaded.manualResponseAudit?.manualDispatchConfirmed).toBe(true);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Filterable Pipeline Queries & Metrics', () => {
    it('computes accurate pipeline metrics over stored records', async () => {
      const repo = new InMemoryOpportunityRepository(createTestDataset());
      const service = new PipelineService(repo);

      const metrics = await service.getPipelineMetrics();

      expect(metrics.totalOpportunities).toBe(4);
      expect(metrics.statusBreakdown).toEqual({
        new: 1,
        reviewed: 1,
        skipped: 1,
        responded: 1,
      });

      // Conversion rates
      expect(metrics.conversionRates.responseRateOverTotal).toBe(0.25); // 1 / 4
      expect(metrics.conversionRates.responseRateOverReviewed).toBe(0.5); // 1 / (1 + 1)
      expect(metrics.conversionRates.skipRate).toBe(0.25); // 1 / 4

      // Platform breakdown
      expect(metrics.platformBreakdown).toEqual({
        'Hacker News': 2,
        Reddit: 1,
        Bluesky: 1,
      });

      // Provenance breakdown
      expect(metrics.provenanceBreakdown).toEqual({
        live: 3,
        demo: 1,
      });

      // Relevance distribution
      expect(metrics.relevanceDistribution.minScore).toBe(35);
      expect(metrics.relevanceDistribution.maxScore).toBe(90);
      expect(metrics.relevanceDistribution.tiers.high).toBe(3); // 90, 75, 88
      expect(metrics.relevanceDistribution.tiers.low).toBe(1); // 35

      // Zero automated dispatch guarantee
      expect(metrics.auditSummary.appDispatchedCount).toBe(0);
      expect(metrics.auditSummary.totalRespondedOutsideApp).toBe(1);
      expect(metrics.auditSummary.manualDispatchConfirmedCount).toBe(1);
      expect(metrics.auditSummary.manualExternalPostMethodCount).toBe(1);
    });

    it('filters pipeline metrics by status', async () => {
      const repo = new InMemoryOpportunityRepository(createTestDataset());
      const service = new PipelineService(repo);

      const metrics = await service.getPipelineMetrics({ status: 'RESPONDED' });
      expect(metrics.filteredCount).toBe(1);
      expect(metrics.statusBreakdown.responded).toBe(1);
      expect(metrics.statusBreakdown.new).toBe(0);
    });

    it('filters pipeline metrics by multiple statuses', async () => {
      const repo = new InMemoryOpportunityRepository(createTestDataset());
      const service = new PipelineService(repo);

      const metrics = await service.getPipelineMetrics({ status: ['NEW', 'REVIEWED'] });
      expect(metrics.filteredCount).toBe(2);
      expect(metrics.statusBreakdown.new).toBe(1);
      expect(metrics.statusBreakdown.reviewed).toBe(1);
      expect(metrics.statusBreakdown.skipped).toBe(0);
    });

    it('filters pipeline metrics by platform', async () => {
      const repo = new InMemoryOpportunityRepository(createTestDataset());
      const service = new PipelineService(repo);

      const metrics = await service.getPipelineMetrics({ platform: 'Reddit' });
      expect(metrics.filteredCount).toBe(1);
      expect(metrics.platformBreakdown['Reddit']).toBe(1);
    });

    it('filters pipeline metrics by provenance', async () => {
      const repo = new InMemoryOpportunityRepository(createTestDataset());
      const service = new PipelineService(repo);

      const metrics = await service.getPipelineMetrics({ provenance: 'DEMO' });
      expect(metrics.filteredCount).toBe(1);
      expect(metrics.provenanceBreakdown.demo).toBe(1);
      expect(metrics.provenanceBreakdown.live).toBe(0);
    });

    it('filters pipeline metrics by relevance range', async () => {
      const repo = new InMemoryOpportunityRepository(createTestDataset());
      const service = new PipelineService(repo);

      const metrics = await service.getPipelineMetrics({
        relevanceRange: { min: 80, max: 100 },
      });
      expect(metrics.filteredCount).toBe(2); // opp-1 (90), opp-4 (88)
      expect(metrics.relevanceDistribution.minScore).toBe(88);
      expect(metrics.relevanceDistribution.maxScore).toBe(90);
    });

    it('filters pipeline metrics by date range', async () => {
      const repo = new InMemoryOpportunityRepository(createTestDataset());
      const service = new PipelineService(repo);

      const metrics = await service.getPipelineMetrics({
        dateRange: {
          startDate: '2026-03-02T00:00:00.000Z',
          endDate: '2026-03-03T23:59:59.000Z',
        },
      });

      expect(metrics.filteredCount).toBe(2); // opp-2 (March 2), opp-3 (March 3)
    });
  });
});
