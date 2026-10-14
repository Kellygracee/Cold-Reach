import { z } from 'zod';
import { nonBlankString } from './profile.js';
import { ConversationItemSchema } from './conversation.js';
import { DraftReplySchema } from './draft.js';

export const OpportunityStatusEnum = z.enum(['NEW', 'REVIEWED', 'SKIPPED', 'RESPONDED'], {
  errorMap: () => ({ message: 'Status must be one of: NEW, REVIEWED, SKIPPED, RESPONDED' }),
});

export type OpportunityStatus = z.infer<typeof OpportunityStatusEnum>;

/**
 * Relevance score must be between 0 and 100 inclusive.
 */
export const RelevanceScoreSchema = z
  .number({
    required_error: 'Relevance score is required',
    invalid_type_error: 'Relevance score must be a number',
  })
  .min(0, 'Relevance score cannot be below 0')
  .max(100, 'Relevance score cannot be above 100');

export const WhyMatchedExplanationSchema = z.object({
  summary: nonBlankString('Why matched summary'),
  matchedNeeds: z
    .array(nonBlankString('Matched need item'))
    .min(1, 'At least one matched need or pain point is required'),
  relevanceRationale: nonBlankString('Relevance rationale'),
  contextSnippet: nonBlankString('Context snippet'),
});

export type WhyMatchedExplanation = z.infer<typeof WhyMatchedExplanationSchema>;

/**
 * Audit record confirming manual human action when an opportunity is marked RESPONDED.
 * Strictly guarantees that the application did not send any message automatically.
 */
export const ManualResponseAuditSchema = z.object({
  markedSentAt: z.string().datetime({ message: 'markedSentAt must be a valid ISO 8601 timestamp' }),
  manualDispatchConfirmed: z.literal(true, {
    errorMap: () => ({
      message: 'manualDispatchConfirmed must be true. Automated dispatch is prohibited.',
    }),
  }),
  dispatchMethod: z.literal('MANUAL_EXTERNAL_POST', {
    errorMap: () => ({
      message: 'dispatchMethod must be MANUAL_EXTERNAL_POST to verify human action.',
    }),
  }),
  operatorNotes: z.string().trim().optional(),
});

export type ManualResponseAudit = z.infer<typeof ManualResponseAuditSchema>;

export const StatusHistoryEntrySchema = z.object({
  id: nonBlankString('Status history ID'),
  fromStatus: OpportunityStatusEnum.nullable(),
  toStatus: OpportunityStatusEnum,
  timestamp: z
    .string()
    .datetime({ message: 'Status change timestamp must be a valid ISO 8601 string' }),
  reason: z.string().trim().optional(),
  changedBy: z.literal('USER', {
    errorMap: () => ({
      message: 'Status transitions must be performed by a human operator (USER)',
    }),
  }),
});

export type StatusHistoryEntry = z.infer<typeof StatusHistoryEntrySchema>;

export const OpportunityBaseSchema = z.object({
  id: nonBlankString('Opportunity ID'),
  conversation: ConversationItemSchema,
  relevanceScore: RelevanceScoreSchema,
  whyMatched: WhyMatchedExplanationSchema,
  replyDraft: DraftReplySchema.nullable().default(null),
  status: OpportunityStatusEnum,
  manualResponseAudit: ManualResponseAuditSchema.optional(),
  userReviewNotes: z.string().trim().optional(),
  statusHistory: z.array(StatusHistoryEntrySchema).default([]),
  createdAt: z
    .string()
    .datetime({ message: 'Opportunity createdAt must be a valid ISO 8601 timestamp' }),
  updatedAt: z
    .string()
    .datetime({ message: 'Opportunity updatedAt must be a valid ISO 8601 timestamp' }),
});

export const OpportunitySchema = OpportunityBaseSchema.superRefine((data, ctx) => {
  // Integrity rule: If status is RESPONDED, manualResponseAudit must be present and verified.
  if (data.status === 'RESPONDED') {
    if (!data.manualResponseAudit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'RESPONDED status requires manualResponseAudit confirming that the user manually sent the reply.',
        path: ['manualResponseAudit'],
      });
    }
  }

  // Integrity rule: If status is not RESPONDED, manualResponseAudit should not be populated.
  if (data.status !== 'RESPONDED' && data.manualResponseAudit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'manualResponseAudit cannot be set unless the opportunity status is RESPONDED.',
      path: ['manualResponseAudit'],
    });
  }
});

export type Opportunity = z.infer<typeof OpportunitySchema>;
