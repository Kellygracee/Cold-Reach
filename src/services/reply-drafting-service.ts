import {
  CopyDraftOptions,
  CopyDraftResult,
  DraftGenerationProvider,
  DraftNotFoundError,
  DraftProviderNotConfiguredError,
  EditDraftParams,
  GenerateDraftParams,
  LowScoreOverrideRequiredError,
  ManualResponseWorkflowRequiredError,
  OpportunityReviewData,
} from '../contracts/draft-provider.js';
import { DraftReply, DraftReplySchema, RevisionHistoryItem } from '../contracts/draft.js';
import { Opportunity, OpportunitySchema, OpportunityStatus } from '../contracts/opportunity.js';
import { ProductProfile, ProductProfileSchema } from '../contracts/profile.js';
import { DefaultAiDraftProvider } from '../providers/default-ai-draft-provider.js';
import {
  InMemoryOpportunityRepository,
  OpportunityRepository,
} from '../storage/opportunity-repository.js';
import { ProfileRepository } from '../storage/profile-repository.js';
import { DraftPromptBuilder } from './draft-prompt-builder.js';
import { OpportunityNotFoundError } from './opportunity-service.js';
import { ProfileValidationError } from './profile-service.js';

export interface ReplyDraftingServiceOptions {
  opportunityRepository?: OpportunityRepository;
  profileRepository?: ProfileRepository;
  provider?: DraftGenerationProvider;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

/**
 * Service orchestrating contextual reply drafting, human editing with revision history,
 * low-relevance threshold confirmation, and reviewer actions (review, edit, copy, open source).
 *
 * Guarantees:
 * - Strictly zero automated posting, messaging, or sending.
 * - Opportunities are never marked RESPONDED by this service.
 * - Drafts are strictly grounded in the profile and conversation without unverified claims.
 */
export class ReplyDraftingService {
  private readonly opportunityRepository: OpportunityRepository;
  private readonly profileRepository?: ProfileRepository;
  private readonly provider: DraftGenerationProvider;

  constructor(options?: ReplyDraftingServiceOptions) {
    this.opportunityRepository =
      options?.opportunityRepository ?? new InMemoryOpportunityRepository();
    this.profileRepository = options?.profileRepository;
    this.provider = options?.provider ?? new DefaultAiDraftProvider();
  }

  /**
   * Returns the injected draft provider's name and configuration status.
   */
  getProviderStatus(): { name: string; isConfigured: boolean } {
    return {
      name: this.provider.name,
      isConfigured: this.provider.isConfigured(),
    };
  }

  /**
   * Generates a contextual reply draft grounded in the conversation and product profile.
   *
   * Threshold rules:
   * - Relevance score < 40 requires explicit user confirmation (allowLowScoreOverride: true).
   * - Missing provider configuration returns DraftProviderNotConfiguredError.
   * - Transitions opportunity from NEW to REVIEWED (never to RESPONDED).
   */
  async generateDraft(params: GenerateDraftParams): Promise<DraftReply> {
    const { opportunityId, allowLowScoreOverride } = params;

    const opportunity = await this.opportunityRepository.findById(opportunityId);
    if (!opportunity) {
      throw new OpportunityNotFoundError(opportunityId);
    }

    // Low-relevance gating (< 40)
    if (opportunity.relevanceScore < 40 && !allowLowScoreOverride) {
      throw new LowScoreOverrideRequiredError(opportunity.relevanceScore, 40);
    }

    // Resolve product profile
    let profile: ProductProfile | undefined = params.profile;
    if (!profile && params.profileId && this.profileRepository) {
      const found = await this.profileRepository.findById(params.profileId);
      if (found) {
        profile = found;
      }
    }

    if (!profile && this.profileRepository) {
      const all = await this.profileRepository.findAll();
      if (all.length > 0) {
        profile = all[0];
      }
    }

    if (!profile) {
      throw new ProfileValidationError(
        'Cannot generate draft: a valid ProductProfile is required.',
        [],
      );
    }

    const validatedProfile = ProductProfileSchema.parse(profile);

    // Verify draft generation provider is configured
    if (!this.provider.isConfigured()) {
      throw new DraftProviderNotConfiguredError(this.provider.name);
    }

    // Build grounded prompt
    const prompt = DraftPromptBuilder.buildPrompt({
      profile: validatedProfile,
      conversation: opportunity.conversation,
      whyMatched: opportunity.whyMatched,
      relevanceScore: opportunity.relevanceScore,
    });

    const generated = await this.provider.generateDraft(prompt);

    const now = new Date().toISOString();
    const draftId = `draft-${slugify(opportunity.id)}-${Date.now()}`;

    const newDraft: DraftReply = {
      id: draftId,
      replyText: generated.replyText.trim(),
      valueAngle: generated.valueAngle.trim(),
      transparencyNote: generated.transparencyNote.trim(),
      revisionHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    const validatedDraft = DraftReplySchema.parse(newDraft);

    // Update opportunity: transition from NEW to REVIEWED (never RESPONDED)
    const newStatus: OpportunityStatus =
      opportunity.status === 'NEW' ? 'REVIEWED' : opportunity.status;

    const statusHistory = [...(opportunity.statusHistory ?? [])];
    if (opportunity.status === 'NEW') {
      statusHistory.push({
        id: `sh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromStatus: 'NEW',
        toStatus: 'REVIEWED',
        timestamp: now,
        reason: 'Generated initial contextual reply draft',
        changedBy: 'USER',
      });
    }

    const updatedOpportunity: Opportunity = {
      ...opportunity,
      replyDraft: validatedDraft,
      status: newStatus,
      statusHistory,
      updatedAt: now,
    };

    const validatedOpportunity = OpportunitySchema.parse(updatedOpportunity);
    await this.opportunityRepository.update(opportunity.id, validatedOpportunity);

    return validatedDraft;
  }

  /**
   * Edits an existing draft reply, preserving human edit revision history.
   */
  async editDraft(opportunityId: string, params: EditDraftParams): Promise<DraftReply> {
    const opportunity = await this.opportunityRepository.findById(opportunityId);
    if (!opportunity) {
      throw new OpportunityNotFoundError(opportunityId);
    }

    if (!opportunity.replyDraft) {
      throw new DraftNotFoundError(opportunityId);
    }

    const newText = params.newText.trim();
    if (!newText) {
      throw new Error('New revision text cannot be blank or empty');
    }

    // If text unchanged, return existing draft
    if (newText === opportunity.replyDraft.replyText) {
      return opportunity.replyDraft;
    }

    const now = new Date().toISOString();
    const revisionId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const revision: RevisionHistoryItem = {
      id: revisionId,
      editedAt: now,
      editedBy: 'USER',
      previousText: opportunity.replyDraft.replyText,
      newText,
      changeSummary: params.changeSummary?.trim() || undefined,
    };

    const updatedDraft: DraftReply = {
      ...opportunity.replyDraft,
      replyText: newText,
      revisionHistory: [...opportunity.replyDraft.revisionHistory, revision],
      updatedAt: now,
    };

    const validatedDraft = DraftReplySchema.parse(updatedDraft);

    const updatedOpportunity: Opportunity = {
      ...opportunity,
      replyDraft: validatedDraft,
      status: opportunity.status === 'NEW' ? 'REVIEWED' : opportunity.status,
      updatedAt: now,
    };

    const validatedOpportunity = OpportunitySchema.parse(updatedOpportunity);
    await this.opportunityRepository.update(opportunity.id, validatedOpportunity);

    return validatedDraft;
  }

  /**
   * Formats draft reply content for clipboard copy in the future UI.
   * Includes the transparency disclosure note by default.
   */
  async copyDraft(opportunityId: string, options?: CopyDraftOptions): Promise<CopyDraftResult> {
    const opportunity = await this.opportunityRepository.findById(opportunityId);
    if (!opportunity) {
      throw new OpportunityNotFoundError(opportunityId);
    }

    if (!opportunity.replyDraft) {
      throw new DraftNotFoundError(opportunityId);
    }

    const includeTransparency = options?.includeTransparencyNote !== false;
    const clipboardText = includeTransparency
      ? `${opportunity.replyDraft.replyText}\n\n${opportunity.replyDraft.transparencyNote}`
      : opportunity.replyDraft.replyText;

    return {
      opportunityId: opportunity.id,
      platform: opportunity.conversation.platform,
      replyText: opportunity.replyDraft.replyText,
      transparencyNote: opportunity.replyDraft.transparencyNote,
      clipboardText,
      sourcePermalink: opportunity.conversation.sourcePermalink,
      characterCount: clipboardText.length,
    };
  }

  /**
   * Provides complete bundle of data for human review UI.
   */
  async getReviewData(
    opportunityId: string,
    profile?: ProductProfile,
  ): Promise<OpportunityReviewData> {
    const opportunity = await this.opportunityRepository.findById(opportunityId);
    if (!opportunity) {
      throw new OpportunityNotFoundError(opportunityId);
    }

    const isLowRelevance = opportunity.relevanceScore < 40;
    const warning = isLowRelevance
      ? `Relevance score (${opportunity.relevanceScore}) is below recommended threshold of 40.`
      : undefined;

    return {
      opportunity,
      candidate: opportunity.conversation,
      profile: profile ?? ({} as ProductProfile),
      whyMatched: opportunity.whyMatched,
      relevanceScore: opportunity.relevanceScore,
      relevanceAssessment: {
        score: opportunity.relevanceScore,
        isLowRelevance,
        warning,
      },
      draft: opportunity.replyDraft,
      sourcePermalink: opportunity.conversation.sourcePermalink,
      isDraftProviderConfigured: this.provider.isConfigured(),
      providerName: this.provider.name,
      revisionCount: opportunity.replyDraft ? opportunity.replyDraft.revisionHistory.length : 0,
      status: opportunity.status,
    };
  }

  /**
   * Updates an opportunity's review status (NEW, REVIEWED, SKIPPED).
   * Refuses to mark as RESPONDED, which strictly requires the manual response audit workflow.
   */
  async setReviewStatus(
    opportunityId: string,
    status: 'NEW' | 'REVIEWED' | 'SKIPPED',
  ): Promise<Opportunity> {
    if ((status as string) === 'RESPONDED') {
      throw new ManualResponseWorkflowRequiredError();
    }

    if (status !== 'NEW' && status !== 'REVIEWED' && status !== 'SKIPPED') {
      throw new Error(`Invalid review status: "${status}". Must be NEW, REVIEWED, or SKIPPED.`);
    }

    const opportunity = await this.opportunityRepository.findById(opportunityId);
    if (!opportunity) {
      throw new OpportunityNotFoundError(opportunityId);
    }

    const now = new Date().toISOString();
    const statusHistory = [...(opportunity.statusHistory ?? [])];
    if (status !== opportunity.status) {
      statusHistory.push({
        id: `sh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromStatus: opportunity.status,
        toStatus: status,
        timestamp: now,
        reason: `Reviewer set status to ${status}`,
        changedBy: 'USER',
      });
    }

    const updatedOpportunity: Opportunity = {
      ...opportunity,
      status,
      statusHistory,
      updatedAt: now,
    };

    const validatedOpportunity = OpportunitySchema.parse(updatedOpportunity);
    return this.opportunityRepository.update(opportunity.id, validatedOpportunity);
  }

  /**
   * Gets the original source permalink to open in an external browser.
   */
  async getOriginalSourceLink(opportunityId: string): Promise<string> {
    const opportunity = await this.opportunityRepository.findById(opportunityId);
    if (!opportunity) {
      throw new OpportunityNotFoundError(opportunityId);
    }
    return opportunity.conversation.sourcePermalink;
  }

  /**
   * Guaranteed: The reply drafting service does not have automated dispatch, messaging, or posting capabilities.
   */
  hasAutomatedDispatchCapability(): false {
    return false;
  }
}
