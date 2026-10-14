import { validateIsoTimestamp } from '../contracts/integrity.js';
import { Opportunity, OpportunitySchema, StatusHistoryEntry } from '../contracts/opportunity.js';
import {
  ALLOWED_STATUS_TRANSITIONS,
  AuditImmutabilityError,
  InvalidStatusTransitionError,
  MissingManualResponseAuditError,
  PipelineMetrics,
  PipelineMetricsFilter,
  RecordManualResponseParams,
  TransitionStatusParams,
} from '../contracts/pipeline.js';
import {
  InMemoryOpportunityRepository,
  OpportunityFilter,
  OpportunityRepository,
} from '../storage/opportunity-repository.js';
import { OpportunityNotFoundError } from './opportunity-service.js';

export class PipelineService {
  private readonly repository: OpportunityRepository;

  constructor(repository?: OpportunityRepository) {
    this.repository = repository ?? new InMemoryOpportunityRepository();
  }

  /**
   * Transitions an opportunity's status according to the state machine rules:
   * - NEW -> REVIEWED, SKIPPED, RESPONDED
   * - REVIEWED -> RESPONDED, SKIPPED, NEW
   * - SKIPPED -> NEW, REVIEWED
   * - RESPONDED -> (terminal state, immutable audit record)
   *
   * Transitions to RESPONDED require manualDispatchConfirmed: true and dispatchMethod: MANUAL_EXTERNAL_POST.
   * Records a StatusHistoryEntry and persists operator notes.
   */
  async transitionStatus(params: TransitionStatusParams): Promise<Opportunity> {
    const { opportunityId, toStatus, reason, userReviewNotes, manualResponseAudit } = params;

    const opportunity = await this.repository.findById(opportunityId);
    if (!opportunity) {
      throw new OpportunityNotFoundError(opportunityId);
    }

    const fromStatus = opportunity.status;

    // Terminal State & Audit Immutability Guard:
    if (fromStatus === 'RESPONDED') {
      if (toStatus !== 'RESPONDED') {
        throw new AuditImmutabilityError(
          `Cannot transition opportunity "${opportunityId}" away from terminal state RESPONDED. Response audit records are immutable.`,
        );
      }
      // If already RESPONDED and someone attempts to alter manualResponseAudit:
      if (manualResponseAudit) {
        const ex = opportunity.manualResponseAudit!;
        if (
          ex.markedSentAt !== manualResponseAudit.markedSentAt ||
          ex.dispatchMethod !== manualResponseAudit.dispatchMethod ||
          ex.manualDispatchConfirmed !== manualResponseAudit.manualDispatchConfirmed
        ) {
          throw new AuditImmutabilityError(
            `Cannot modify manualResponseAudit record on opportunity "${opportunityId}". Audit records are strictly immutable.`,
          );
        }
      }
      // If updating review notes on already RESPONDED opportunity:
      if (userReviewNotes !== undefined && userReviewNotes !== opportunity.userReviewNotes) {
        return this.updateReviewNotes(opportunityId, userReviewNotes);
      }
      return opportunity;
    }

    // Idempotent transition (same status)
    if (toStatus === fromStatus) {
      if (userReviewNotes !== undefined && userReviewNotes !== opportunity.userReviewNotes) {
        return this.updateReviewNotes(opportunityId, userReviewNotes);
      }
      return opportunity;
    }

    // Validate allowed transition
    const allowed = ALLOWED_STATUS_TRANSITIONS[fromStatus];
    if (!allowed.includes(toStatus)) {
      throw new InvalidStatusTransitionError(fromStatus, toStatus);
    }

    // Transition to RESPONDED audit requirements
    if (toStatus === 'RESPONDED') {
      if (!manualResponseAudit) {
        throw new MissingManualResponseAuditError(
          'Transition to RESPONDED requires a complete manualResponseAudit record with manualDispatchConfirmed: true and dispatchMethod: "MANUAL_EXTERNAL_POST".',
        );
      }

      if (manualResponseAudit.manualDispatchConfirmed !== true) {
        throw new MissingManualResponseAuditError(
          'manualDispatchConfirmed must be true. Automated dispatch is strictly prohibited.',
        );
      }

      if (manualResponseAudit.dispatchMethod !== 'MANUAL_EXTERNAL_POST') {
        throw new MissingManualResponseAuditError(
          'dispatchMethod must be "MANUAL_EXTERNAL_POST" to confirm human action outside the application.',
        );
      }

      if (!validateIsoTimestamp(manualResponseAudit.markedSentAt)) {
        throw new Error('Invalid markedSentAt timestamp for manual response audit.');
      }
    }

    const now = new Date().toISOString();
    const historyId = `sh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const historyEntry: StatusHistoryEntry = {
      id: historyId,
      fromStatus,
      toStatus,
      timestamp: now,
      reason: reason?.trim() || undefined,
      changedBy: 'USER',
    };

    const updatedOpportunity: Opportunity = {
      ...opportunity,
      status: toStatus,
      manualResponseAudit: toStatus === 'RESPONDED' ? manualResponseAudit : undefined,
      userReviewNotes:
        userReviewNotes !== undefined
          ? userReviewNotes.trim() || undefined
          : opportunity.userReviewNotes,
      statusHistory: [...(opportunity.statusHistory ?? []), historyEntry],
      updatedAt: now,
    };

    const validated = OpportunitySchema.parse(updatedOpportunity);
    return this.repository.update(opportunity.id, validated);
  }

  /**
   * Helper to confirm and record a manual external response.
   * Strictly records that outreach was completed manually outside the application.
   */
  async recordManualResponse(params: RecordManualResponseParams): Promise<Opportunity> {
    const { opportunityId, markedSentAt, operatorNotes, userReviewNotes, manualDispatchConfirmed } =
      params;

    if (manualDispatchConfirmed !== true) {
      throw new MissingManualResponseAuditError(
        'manualDispatchConfirmed must be true. Automated dispatch is strictly prohibited.',
      );
    }

    const sentTimestamp = markedSentAt ?? new Date().toISOString();

    return this.transitionStatus({
      opportunityId,
      toStatus: 'RESPONDED',
      reason: 'Manual response sent externally by human operator',
      userReviewNotes,
      manualResponseAudit: {
        markedSentAt: sentTimestamp,
        manualDispatchConfirmed: true,
        dispatchMethod: 'MANUAL_EXTERNAL_POST',
        operatorNotes: operatorNotes?.trim() || undefined,
      },
    });
  }

  /**
   * Updates user review notes on an opportunity without changing its status.
   */
  async updateReviewNotes(opportunityId: string, notes: string): Promise<Opportunity> {
    const opportunity = await this.repository.findById(opportunityId);
    if (!opportunity) {
      throw new OpportunityNotFoundError(opportunityId);
    }

    const trimmedNotes = notes.trim();
    const updated = {
      ...opportunity,
      userReviewNotes: trimmedNotes.length > 0 ? trimmedNotes : undefined,
      updatedAt: new Date().toISOString(),
    };

    const validated = OpportunitySchema.parse(updated);
    return this.repository.update(opportunity.id, validated);
  }

  /**
   * Retrieves an opportunity by ID or throws OpportunityNotFoundError.
   */
  async getOpportunity(opportunityId: string): Promise<Opportunity> {
    const opportunity = await this.repository.findById(opportunityId);
    if (!opportunity) {
      throw new OpportunityNotFoundError(opportunityId);
    }
    return opportunity;
  }

  /**
   * Lists opportunities matching optional filters, sorted by relevance score DESC.
   */
  async listOpportunities(filter?: PipelineMetricsFilter): Promise<Opportunity[]> {
    const repoFilter: OpportunityFilter | undefined = filter
      ? {
          status: filter.status,
          minScore: filter.relevanceRange?.min,
          maxScore: filter.relevanceRange?.max,
          platform: filter.platform,
          provenance: filter.provenance,
          startDate: filter.dateRange?.startDate,
          endDate: filter.dateRange?.endDate,
          dateField: filter.dateRange?.field,
        }
      : undefined;

    const items = await this.repository.findAll(repoFilter);

    // Deterministic ordering: relevanceScore DESC, updatedAt DESC, id ASC
    items.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      const timeDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

    return items;
  }

  /**
   * Retrieves audit history entries for an opportunity.
   */
  async getStatusHistory(opportunityId: string): Promise<StatusHistoryEntry[]> {
    const opportunity = await this.getOpportunity(opportunityId);
    return opportunity.statusHistory ?? [];
  }

  /**
   * Computes comprehensive, filterable pipeline metrics grounded strictly in stored records.
   */
  async getPipelineMetrics(filter?: PipelineMetricsFilter): Promise<PipelineMetrics> {
    const items = await this.listOpportunities(filter);
    const total = items.length;

    let newCount = 0;
    let reviewedCount = 0;
    let skippedCount = 0;
    let respondedCount = 0;

    let demoCount = 0;
    let liveCount = 0;

    const platformBreakdown: Record<string, number> = {};

    let scoreSum = 0;
    let minScore = total > 0 ? 100 : 0;
    let maxScore = 0;

    let highTier = 0; // >= 70
    let mediumTier = 0; // 40 <= score < 70
    let lowTier = 0; // < 40

    let manualDispatchConfirmedCount = 0;
    let manualExternalPostCount = 0;

    for (const item of items) {
      // Status breakdown
      if (item.status === 'NEW') newCount++;
      else if (item.status === 'REVIEWED') reviewedCount++;
      else if (item.status === 'SKIPPED') skippedCount++;
      else if (item.status === 'RESPONDED') respondedCount++;

      // Provenance breakdown
      if (item.conversation.sourceProvenance === 'DEMO') demoCount++;
      else if (item.conversation.sourceProvenance === 'LIVE') liveCount++;

      // Platform breakdown
      const platformKey = item.conversation.platform;
      platformBreakdown[platformKey] = (platformBreakdown[platformKey] ?? 0) + 1;

      // Relevance metrics
      scoreSum += item.relevanceScore;
      if (item.relevanceScore < minScore) minScore = item.relevanceScore;
      if (item.relevanceScore > maxScore) maxScore = item.relevanceScore;

      if (item.relevanceScore >= 70) highTier++;
      else if (item.relevanceScore >= 40) mediumTier++;
      else lowTier++;

      // Audit tracking
      if (item.manualResponseAudit) {
        if (item.manualResponseAudit.manualDispatchConfirmed) manualDispatchConfirmedCount++;
        if (item.manualResponseAudit.dispatchMethod === 'MANUAL_EXTERNAL_POST') {
          manualExternalPostCount++;
        }
      }
    }

    const averageScore = total > 0 ? Number((scoreSum / total).toFixed(1)) : 0;
    const responseRateOverTotal = total > 0 ? Number((respondedCount / total).toFixed(4)) : 0;
    const reviewAndResponded = reviewedCount + respondedCount;
    const responseRateOverReviewed =
      reviewAndResponded > 0 ? Number((respondedCount / reviewAndResponded).toFixed(4)) : 0;
    const skipRate = total > 0 ? Number((skippedCount / total).toFixed(4)) : 0;

    return {
      totalOpportunities: total,
      statusBreakdown: {
        new: newCount,
        reviewed: reviewedCount,
        skipped: skippedCount,
        responded: respondedCount,
      },
      conversionRates: {
        responseRateOverTotal,
        responseRateOverReviewed,
        skipRate,
      },
      platformBreakdown,
      provenanceBreakdown: {
        demo: demoCount,
        live: liveCount,
      },
      relevanceDistribution: {
        averageScore,
        minScore,
        maxScore,
        tiers: {
          high: highTier,
          medium: mediumTier,
          low: lowTier,
        },
      },
      auditSummary: {
        totalRespondedOutsideApp: respondedCount,
        appDispatchedCount: 0, // Compliance guarantee: strictly 0
        manualDispatchConfirmedCount,
        manualExternalPostMethodCount: manualExternalPostCount,
      },
      filteredCount: total,
    };
  }
}
