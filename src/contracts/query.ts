import { z } from 'zod';
import { nonBlankString } from './profile.js';

export const QuerySourceSchema = z.enum(['USER', 'APP']);
export type QuerySource = z.infer<typeof QuerySourceSchema>;

export const QueryClusterTypeSchema = z.enum([
  'seed_terms',
  'pain_points',
  'solution_seeking',
  'audience_context',
]);
export type QueryClusterType = z.infer<typeof QueryClusterTypeSchema>;

export const QuerySourceFieldSchema = z.enum([
  'seedKeywords',
  'customerPainPointPhrases',
  'problemsSolved',
  'productDescription',
  'valueProposition',
  'idealCustomerDescription',
]);
export type QuerySourceField = z.infer<typeof QuerySourceFieldSchema>;

export const QueryTermSchema = z.object({
  id: nonBlankString('Query term ID'),
  term: nonBlankString('Query term text'),
  source: QuerySourceSchema,
  cluster: QueryClusterTypeSchema,
  reason: nonBlankString('Generation reason'),
  sourceField: QuerySourceFieldSchema.optional(),
  hasConflict: z.boolean().default(false),
  conflictingExcludedTopics: z.array(z.string()).default([]),
  isFiltered: z.boolean().default(false),
  conflictReason: z.string().optional(),
});
export type QueryTerm = z.infer<typeof QueryTermSchema>;

export const QueryClusterSchema = z.object({
  id: QueryClusterTypeSchema,
  name: nonBlankString('Cluster name'),
  description: nonBlankString('Cluster description'),
  terms: z.array(QueryTermSchema),
});
export type QueryCluster = z.infer<typeof QueryClusterSchema>;

export const QueryExpansionResultSchema = z.object({
  profileId: nonBlankString('Profile ID'),
  generatedAt: z.string().datetime({ message: 'generatedAt must be a valid ISO 8601 timestamp' }),
  clusters: z.array(QueryClusterSchema),
  totalTermsCount: z.number().int().min(0),
  activeTermsCount: z.number().int().min(0),
  flaggedTermsCount: z.number().int().min(0),
  filteredTermsCount: z.number().int().min(0),
  filteredTerms: z.array(QueryTermSchema).default([]),
});
export type QueryExpansionResult = z.infer<typeof QueryExpansionResultSchema>;
