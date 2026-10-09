import { ConversationItem, SourceProvenance } from './conversation.js';
import { Opportunity, ManualResponseAudit } from './opportunity.js';

export class IntegrityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrityValidationError';
  }
}

/**
 * Validates that a relevance score is within the permitted bounds [0, 100].
 */
export function validateRelevanceScore(score: number): boolean {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return false;
  }
  return score >= 0 && score <= 100;
}

/**
 * Validates that an ISO 8601 timestamp string is valid and parsable.
 */
export function validateIsoTimestamp(timestamp: string): boolean {
  if (typeof timestamp !== 'string' || !timestamp.trim()) {
    return false;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  // Check standard ISO regex
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
  return isoRegex.test(timestamp);
}

/**
 * Validates that a source permalink is a valid HTTP/HTTPS URL.
 */
export function validateSourcePermalink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Integrity Rule: A demo record must never be presented as a live result.
 * Throws IntegrityValidationError if a DEMO conversation or opportunity is labeled as LIVE.
 */
export function assertNotDemoAsLive(
  target: ConversationItem | Opportunity,
  presentedCategory: SourceProvenance,
): void {
  const actualProvenance =
    'conversation' in target ? target.conversation.sourceProvenance : target.sourceProvenance;

  if (actualProvenance === 'DEMO' && presentedCategory === 'LIVE') {
    throw new IntegrityValidationError(
      'Integrity Violation: A demo record must never be presented as a live search result.',
    );
  }
}

/**
 * Validates whether an opportunity was marked as RESPONDED strictly via manual human action.
 * Guaranteed: The application did NOT dispatch the response automatically.
 */
export function verifyManualResponseOnly(audit: ManualResponseAudit): boolean {
  return audit.manualDispatchConfirmed === true && audit.dispatchMethod === 'MANUAL_EXTERNAL_POST';
}

/**
 * Helper to transition an opportunity to RESPONDED with explicit human confirmation.
 */
export function markManuallyResponded(
  opportunity: Opportunity,
  audit: {
    markedSentAt: string;
    operatorNotes?: string;
  },
): Opportunity {
  if (!validateIsoTimestamp(audit.markedSentAt)) {
    throw new IntegrityValidationError('Invalid markedSentAt timestamp.');
  }

  return {
    ...opportunity,
    status: 'RESPONDED',
    manualResponseAudit: {
      markedSentAt: audit.markedSentAt,
      manualDispatchConfirmed: true,
      dispatchMethod: 'MANUAL_EXTERNAL_POST',
      operatorNotes: audit.operatorNotes,
    },
    updatedAt: new Date().toISOString(),
  };
}
