import { SourceProvenance } from './conversation.js';
import { OpportunityStatus } from './opportunity.js';

/**
 * Allowed status transitions for opportunities.
 * - NEW can transition to REVIEWED (reviewed by operator), SKIPPED (dismissed), or RESPONDED (with manual audit).
 * - REVIEWED can transition to RESPONDED (external manual post made), SKIPPED (abandoned), or NEW (re-queued).
 * - SKIPPED can transition to NEW or REVIEWED (reopened).
 * - RESPONDED is a terminal audit state: external outreach has occurred in the wild and the audit record is immutable.
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<OpportunityStatus, readonly OpportunityStatus[]> = {
  NEW: ['REVIEWED', 'SKIPPED', 'RESPONDED'],
  REVIEWED: ['RESPONDED', 'SKIPPED', 'NEW'],
  SKIPPED: ['NEW', 'REVIEWED'],
  RESPONDED: [], // Terminal audit state
} as const;

export class InvalidStatusTransitionError extends Error {
  public readonly fromStatus: OpportunityStatus;
  public readonly toStatus: OpportunityStatus;

  constructor(fromStatus: OpportunityStatus, toStatus: OpportunityStatus, reason?: string) {
    const detail = reason ? `: ${reason}` : '';
    super(
      `Invalid status transition from "${fromStatus}" to "${toStatus}"${detail}. Allowed transitions from "${fromStatus}": [${ALLOWED_STATUS_TRANSITIONS[fromStatus].join(', ') || 'none (terminal state)'}].`,
    );
    this.name = 'InvalidStatusTransitionError';
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

export class AuditImmutabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditImmutabilityError';
  }
}

export class MissingManualResponseAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingManualResponseAuditError';
  }
}

export interface TransitionStatusParams {
  opportunityId: string;
  toStatus: OpportunityStatus;
  reason?: string;
  userReviewNotes?: string;
  manualResponseAudit?: {
    markedSentAt: string;
    manualDispatchConfirmed: true;
    dispatchMethod: 'MANUAL_EXTERNAL_POST';
    operatorNotes?: string;
  };
}

export interface RecordManualResponseParams {
  opportunityId: string;
  markedSentAt?: string;
  operatorNotes?: string;
  userReviewNotes?: string;
  manualDispatchConfirmed: true;
}

export interface PipelineMetricsFilter {
  status?: OpportunityStatus | OpportunityStatus[];
  dateRange?: {
    startDate?: string;
    endDate?: string;
    field?: 'createdAt' | 'updatedAt' | 'markedSentAt';
  };
  platform?: string | string[];
  provenance?: SourceProvenance | SourceProvenance[];
  relevanceRange?: {
    min?: number;
    max?: number;
  };
}

export interface PipelineMetrics {
  totalOpportunities: number;
  statusBreakdown: {
    new: number;
    reviewed: number;
    skipped: number;
    responded: number;
  };
  conversionRates: {
    responseRateOverTotal: number;
    responseRateOverReviewed: number;
    skipRate: number;
  };
  platformBreakdown: Record<string, number>;
  provenanceBreakdown: {
    demo: number;
    live: number;
  };
  relevanceDistribution: {
    averageScore: number;
    minScore: number;
    maxScore: number;
    tiers: {
      high: number; // >= 70
      medium: number; // 40 <= score < 70
      low: number; // < 40
    };
  };
  auditSummary: {
    totalRespondedOutsideApp: number;
    appDispatchedCount: 0; // Strictly zero automated dispatches
    manualDispatchConfirmedCount: number;
    manualExternalPostMethodCount: number;
  };
  filteredCount: number;
}
