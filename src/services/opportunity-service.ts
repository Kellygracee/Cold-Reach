import { ConversationItem } from '../contracts/conversation.js';
import { Opportunity, OpportunitySchema } from '../contracts/opportunity.js';
import { ProductProfile, ProductProfileSchema } from '../contracts/profile.js';
import { QueryExpansionResult, QueryTerm } from '../contracts/query.js';
import {
  InMemoryOpportunityRepository,
  OpportunityFilter,
  OpportunityRepository,
} from '../storage/opportunity-repository.js';
import { ProfileValidationError } from './profile-service.js';
import { RelevanceAnalysisEngine } from './relevance-engine.js';

export class OpportunityNotFoundError extends Error {
  constructor(id: string) {
    super(`Opportunity with ID "${id}" was not found.`);
    this.name = 'OpportunityNotFoundError';
  }
}

export interface AttributeOpportunityParams {
  profile: ProductProfile;
  candidate: ConversationItem;
  queryTerms?: string[] | QueryTerm[] | QueryExpansionResult;
}

export interface AttributeBatchParams {
  profile: ProductProfile;
  candidates: ConversationItem[];
  queryTerms?: string[] | QueryTerm[] | QueryExpansionResult;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Service to analyze relevance, attribute conversation opportunities, and handle deduplication.
 */
export class OpportunityService {
  private readonly repository: OpportunityRepository;

  constructor(repository?: OpportunityRepository) {
    this.repository = repository ?? new InMemoryOpportunityRepository();
  }

  /**
   * Evaluates a candidate conversation against a product profile, producing or updating
   * a deduplicated Opportunity record.
   */
  async attributeOpportunity(params: AttributeOpportunityParams): Promise<Opportunity> {
    const { profile, candidate, queryTerms } = params;

    // Validate profile input
    const profileParsed = ProductProfileSchema.safeParse(profile);
    if (!profileParsed.success) {
      throw new ProfileValidationError(
        'Cannot attribute opportunity: provided product profile is invalid or incomplete.',
        profileParsed.error.issues,
      );
    }

    const evaluation = RelevanceAnalysisEngine.evaluate({
      profile: profileParsed.data,
      candidate,
      queryTerms,
    });

    const now = new Date().toISOString();

    // Check for existing opportunity by conversation ID or permalink for deduplication
    const existingById = await this.repository.findByConversationId(candidate.id);
    const existingByPermalink = existingById
      ? null
      : await this.repository.findByPermalink(candidate.sourcePermalink);

    const existing = existingById ?? existingByPermalink;

    if (existing) {
      // Deduplicated Update: preserve existing ID, createdAt, status, and reply draft state
      const updatedOpportunity: Opportunity = {
        ...existing,
        conversation: {
          ...candidate,
          matchedKeywords:
            evaluation.matchedQueryTerms.length > 0
              ? evaluation.matchedQueryTerms
              : candidate.matchedKeywords,
        },
        relevanceScore: evaluation.relevanceScore,
        whyMatched: evaluation.whyMatched,
        updatedAt: now,
      };

      const validated = OpportunitySchema.parse(updatedOpportunity);
      return this.repository.update(existing.id, validated);
    }

    // New Opportunity: starts in NEW with reply drafting not started (null)
    const newOpportunityId = `opp-${slugify(candidate.platform)}-${slugify(candidate.id)}`;

    const newOpportunity: Opportunity = {
      id: newOpportunityId,
      conversation: {
        ...candidate,
        matchedKeywords:
          evaluation.matchedQueryTerms.length > 0
            ? evaluation.matchedQueryTerms
            : candidate.matchedKeywords,
      },
      relevanceScore: evaluation.relevanceScore,
      whyMatched: evaluation.whyMatched,
      replyDraft: null,
      status: 'NEW',
      statusHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    const validated = OpportunitySchema.parse(newOpportunity);
    return this.repository.save(validated);
  }

  /**
   * Attributes a batch of candidate conversations, deduplicating within the batch and repository.
   * Returns opportunities sorted by relevanceScore DESC, timestamp DESC, id ASC.
   */
  async attributeBatch(params: AttributeBatchParams): Promise<Opportunity[]> {
    const { profile, candidates, queryTerms } = params;

    // Deduplicate candidates within the incoming batch by ID and Permalink
    const seenIds = new Set<string>();
    const seenPermalinks = new Set<string>();
    const deduplicatedCandidates: ConversationItem[] = [];

    for (const c of candidates) {
      if (seenIds.has(c.id) || seenPermalinks.has(c.sourcePermalink)) {
        continue;
      }
      seenIds.add(c.id);
      seenPermalinks.add(c.sourcePermalink);
      deduplicatedCandidates.push(c);
    }

    const opportunities: Opportunity[] = [];
    for (const candidate of deduplicatedCandidates) {
      const opp = await this.attributeOpportunity({
        profile,
        candidate,
        queryTerms,
      });
      opportunities.push(opp);
    }

    // Deterministic sort: relevanceScore DESC, timestamp DESC, id ASC
    opportunities.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      const timeDiff =
        new Date(b.conversation.timestamp).getTime() - new Date(a.conversation.timestamp).getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return a.id.localeCompare(b.id);
    });

    return opportunities;
  }

  async getOpportunity(id: string): Promise<Opportunity> {
    const opp = await this.repository.findById(id);
    if (!opp) {
      throw new OpportunityNotFoundError(id);
    }
    return opp;
  }

  async findOpportunity(id: string): Promise<Opportunity | null> {
    return this.repository.findById(id);
  }

  async listOpportunities(filter?: OpportunityFilter): Promise<Opportunity[]> {
    return this.repository.findAll(filter);
  }

  async updateOpportunity(id: string, updates: Partial<Opportunity>): Promise<Opportunity> {
    const existing = await this.getOpportunity(id);
    const merged = {
      ...existing,
      ...updates,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    };
    const validated = OpportunitySchema.parse(merged);
    return this.repository.update(id, validated);
  }

  async deleteOpportunity(id: string): Promise<boolean> {
    return this.repository.delete(id);
  }
}
