import {
  DraftGenerationProvider,
  DraftPrompt,
  GeneratedDraftContent,
} from '../contracts/draft-provider.js';
import { DraftPromptBuilder } from '../services/draft-prompt-builder.js';

export interface MockDraftProviderOptions {
  customReplyGenerator?: (prompt: DraftPrompt) => GeneratedDraftContent;
}

/**
 * Deterministic test and evaluation provider for contextual reply drafting.
 * Explicitly named MockDraftProvider to ensure it is never confused with a live AI model.
 *
 * Implements strict grounding rules:
 * - Answers the conversation first with direct helpful insight.
 * - Mentions product only when relevant, referencing only explicit profile fields.
 * - Never hallucinates features, metrics, or pricing.
 * - Never makes inferences about author credentials or handles.
 * - Includes required transparency note.
 */
export class MockDraftProvider implements DraftGenerationProvider {
  readonly name = 'MockDraftProvider';
  private readonly customReplyGenerator?: (prompt: DraftPrompt) => GeneratedDraftContent;

  constructor(options?: MockDraftProviderOptions) {
    this.customReplyGenerator = options?.customReplyGenerator;
  }

  isConfigured(): boolean {
    return true;
  }

  async generateDraft(prompt: DraftPrompt): Promise<GeneratedDraftContent> {
    if (this.customReplyGenerator) {
      return this.customReplyGenerator(prompt);
    }

    const { profile, whyMatched, relevanceScore } = prompt.context;
    const valueAngle = DraftPromptBuilder.buildValueAngle(prompt.context);
    const transparencyNote = DraftPromptBuilder.buildTransparencyNote(profile);

    // Answer the conversation first with direct, practical workflow advice
    const primaryNeed =
      whyMatched.matchedNeeds[0] ?? profile.problemsSolved[0] ?? 'workflow efficiency';
    const answerFirst = [
      `A practical approach to handling ${primaryNeed.toLowerCase()} is to break down the immediate bottleneck and streamline the repetitive steps first.`,
      `For example, establishing clear review checkpoints can often cut down wasted turnaround time significantly.`,
    ].join(' ');

    // Mention product only when relevant without unsupported claims
    let productMention = '';
    if (relevanceScore >= 40) {
      productMention = ` If you are also looking at tooling for this, my team is working on ${profile.productName}, which is built specifically to address ${profile.valueProposition.toLowerCase()}.`;
    }

    const replyText = `${answerFirst}${productMention}`;

    return {
      replyText,
      valueAngle,
      transparencyNote,
    };
  }
}
