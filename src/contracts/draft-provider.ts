import { ConversationItem } from './conversation.js';
import { DraftReply } from './draft.js';
import { Opportunity, OpportunityStatus, WhyMatchedExplanation } from './opportunity.js';
import { ProductProfile } from './profile.js';

export class DraftProviderNotConfiguredError extends Error {
  public readonly providerName: string;

  constructor(providerName: string, reason?: string) {
    const detail = reason ? `: ${reason}` : '';
    super(
      `AI Draft Provider "${providerName}" is not configured${detail}. To enable live AI draft generation, configure the appropriate provider credentials or inject an active DraftGenerationProvider. Mock or placeholder credentials are not permitted.`,
    );
    this.name = 'DraftProviderNotConfiguredError';
    this.providerName = providerName;
  }
}

export class LowScoreOverrideRequiredError extends Error {
  public readonly relevanceScore: number;
  public readonly threshold: number;
  public readonly warning: string;

  constructor(relevanceScore: number, threshold = 40) {
    const warning = `Warning: This opportunity has a relevance score of ${relevanceScore} (below the recommended threshold of ${threshold}). Contextual drafting on low-relevance conversations risks appearing off-topic or unsolicited. To proceed with drafting, provide explicit confirmation (allowLowScoreOverride: true).`;
    super(warning);
    this.name = 'LowScoreOverrideRequiredError';
    this.relevanceScore = relevanceScore;
    this.threshold = threshold;
    this.warning = warning;
  }
}

export class DraftNotFoundError extends Error {
  constructor(opportunityId: string) {
    super(`No reply draft exists for opportunity "${opportunityId}".`);
    this.name = 'DraftNotFoundError';
  }
}

export class ManualResponseWorkflowRequiredError extends Error {
  constructor() {
    super(
      'Cannot mark opportunity as RESPONDED through the drafting service. Transitioning to RESPONDED requires an explicit manual response workflow with human dispatch audit.',
    );
    this.name = 'ManualResponseWorkflowRequiredError';
  }
}

export interface DraftPromptContext {
  profile: ProductProfile;
  conversation: ConversationItem;
  whyMatched: WhyMatchedExplanation;
  relevanceScore: number;
}

export interface DraftPrompt {
  systemPrompt: string;
  userPrompt: string;
  context: DraftPromptContext;
}

export interface GeneratedDraftContent {
  replyText: string;
  valueAngle: string;
  transparencyNote: string;
}

export interface DraftGenerationProvider {
  readonly name: string;
  isConfigured(): boolean;
  generateDraft(prompt: DraftPrompt): Promise<GeneratedDraftContent>;
}

export interface GenerateDraftParams {
  opportunityId: string;
  profile?: ProductProfile;
  profileId?: string;
  allowLowScoreOverride?: boolean;
}

export interface EditDraftParams {
  newText: string;
  changeSummary?: string;
}

export interface CopyDraftOptions {
  includeTransparencyNote?: boolean;
}

export interface CopyDraftResult {
  opportunityId: string;
  platform: string;
  replyText: string;
  transparencyNote: string;
  clipboardText: string;
  sourcePermalink: string;
  characterCount: number;
}

export interface OpportunityReviewData {
  opportunity: Opportunity;
  candidate: ConversationItem;
  profile: ProductProfile;
  whyMatched: WhyMatchedExplanation;
  relevanceScore: number;
  relevanceAssessment: {
    score: number;
    isLowRelevance: boolean;
    warning?: string;
  };
  draft: DraftReply | null;
  sourcePermalink: string;
  isDraftProviderConfigured: boolean;
  providerName: string;
  revisionCount: number;
  status: OpportunityStatus;
}
