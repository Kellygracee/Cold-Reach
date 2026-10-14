import { z } from 'zod';
import { ConversationItemSchema, SourceProvenance, SourceProvenanceEnum } from './conversation.js';
import { nonBlankString } from './profile.js';
import { QueryTerm } from './query.js';

export const ProviderStateSchema = z.enum(['READY', 'NOT_CONFIGURED', 'UNSUPPORTED']);
export type ProviderState = z.infer<typeof ProviderStateSchema>;

export interface ProviderStatus {
  state: ProviderState;
  configured: boolean;
  reason?: string;
}

export class ProviderError extends Error {
  public readonly code: string;
  public readonly providerName: string;

  constructor(message: string, code: string, providerName: string) {
    super(`[${providerName}] ${message}`);
    this.name = 'ProviderError';
    this.code = code;
    this.providerName = providerName;
  }
}

export class ProviderConfigurationError extends ProviderError {
  public readonly state: ProviderState;

  constructor(message: string, providerName: string, state: ProviderState = 'NOT_CONFIGURED') {
    super(message, state, providerName);
    this.name = 'ProviderConfigurationError';
    this.state = state;
  }
}

export class ProviderAuthenticationError extends ProviderError {
  constructor(message: string, providerName: string) {
    super(message, 'AUTHENTICATION_FAILED', providerName);
    this.name = 'ProviderAuthenticationError';
  }
}

export class ProviderRateLimitError extends ProviderError {
  public readonly retryAfterSeconds?: number;

  constructor(message: string, providerName: string, retryAfterSeconds?: number) {
    super(message, 'RATE_LIMITED', providerName);
    this.name = 'ProviderRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(message: string, providerName: string) {
    super(message, 'TIMEOUT', providerName);
    this.name = 'ProviderTimeoutError';
  }
}

export class ProviderMalformedResponseError extends ProviderError {
  constructor(message: string, providerName: string) {
    super(message, 'MALFORMED_RESPONSE', providerName);
    this.name = 'ProviderMalformedResponseError';
  }
}

export class ProviderNetworkError extends ProviderError {
  constructor(message: string, providerName: string) {
    super(message, 'NETWORK_ERROR', providerName);
    this.name = 'ProviderNetworkError';
  }
}

export class ProviderSecurityError extends ProviderError {
  constructor(message: string, providerName: string) {
    super(message, 'SECURITY_VIOLATION', providerName);
    this.name = 'ProviderSecurityError';
  }
}

export const ConversationSearchFilterSchema = z.object({
  queryTerms: z
    .array(nonBlankString('Query term'))
    .min(1, 'At least one query term is required for search'),
  excludedTopics: z.array(nonBlankString('Excluded topic')).default([]),
  platform: z
    .union([nonBlankString('Platform'), z.array(nonBlankString('Platform item'))])
    .optional(),
  since: z.string().datetime({ message: 'since must be a valid ISO 8601 timestamp' }).optional(),
  until: z.string().datetime({ message: 'until must be a valid ISO 8601 timestamp' }).optional(),
  authorAlias: nonBlankString('Author alias').optional(),
  minRelevanceScore: z.number().min(0).max(100).optional(),
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export type ConversationSearchParams = z.infer<typeof ConversationSearchFilterSchema>;

/**
 * Permissive input accepting query terms as string[], QueryTerm[], or a single string.
 */
export interface SearchInput {
  queryTerms?: string[] | QueryTerm[];
  query?: string;
  excludedTopics?: string[];
  platform?: string | string[];
  since?: string;
  until?: string;
  authorAlias?: string;
  minRelevanceScore?: number;
  limit?: number;
  offset?: number;
}

export const ConversationSearchResultItemSchema = z.object({
  conversation: ConversationItemSchema,
  relevanceScore: z.number().min(0).max(100),
  matchedTerms: z
    .array(nonBlankString('Matched term'))
    .min(1, 'At least one matched term is required'),
});

export type ConversationSearchResultItem = z.infer<typeof ConversationSearchResultItemSchema>;

export const ConversationSearchResultSchema = z.object({
  items: z.array(ConversationSearchResultItemSchema),
  totalMatches: z.number().int().min(0),
  providerName: nonBlankString('Provider name'),
  sourceProvenance: SourceProvenanceEnum,
  providerStatus: ProviderStateSchema.optional(),
  statusReason: z.string().optional(),
});

export type ConversationSearchResult = z.infer<typeof ConversationSearchResultSchema>;

/**
 * Typed interface for searching conversations from any source (demo fixtures or live integrations).
 */
export interface ConversationProvider {
  readonly name: string;
  readonly provenance: SourceProvenance;
  getStatus?(): ProviderStatus;
  search(input: SearchInput): Promise<ConversationSearchResult>;
}
