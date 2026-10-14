import { DraftPrompt, DraftPromptContext } from '../contracts/draft-provider.js';
import { ProductProfile } from '../contracts/profile.js';

/**
 * Builds grounded, deterministic prompts for contextual reply generation.
 * Enforces strict boundaries:
 * 1. Answering the conversation first with helpful domain advice.
 * 2. Mentioning the product only when directly relevant.
 * 3. Never making unsupported claims (strictly grounded in profile).
 * 4. Never inferring details from author handles or unavailable bios.
 * 5. Requiring standardized transparency notes disclosing product affiliation.
 */
export class DraftPromptBuilder {
  /**
   * Generates a standardized transparency disclosure note grounded in the product profile.
   */
  static buildTransparencyNote(profile: ProductProfile): string {
    return `Transparency: I am affiliated with ${profile.productName} (${profile.valueProposition}).`;
  }

  /**
   * Determines the relevant value angle from whyMatched evidence or profile value proposition.
   */
  static buildValueAngle(context: DraftPromptContext): string {
    const matchedNeed = context.whyMatched.matchedNeeds?.[0];
    if (matchedNeed && matchedNeed.trim().length > 0) {
      return matchedNeed;
    }
    return context.profile.valueProposition;
  }

  /**
   * Builds the system instructions for the LLM.
   */
  static buildSystemPrompt(): string {
    return [
      'You are a helpful domain peer drafting a thoughtful, contextual reply in an online community discussion.',
      '',
      'CRITICAL COMPLIANCE RULES:',
      "1. ANSWER FIRST: Address the author's specific question or discussion point directly with practical, actionable value before mentioning any tool or product.",
      '2. MENTION PRODUCT ONLY WHEN DIRECTLY RELEVANT: Only mention the product if it directly and naturally addresses a problem or need raised by the author. If peripheral, focus purely on helpful community guidance without pushing the product.',
      '3. STRICTLY GROUNDED (NO HALLUCINATIONS): Use ONLY features, capabilities, problems solved, and value propositions explicitly listed in the provided Product Profile. Do NOT invent features, benchmarks, customer testimonials, pricing, or certifications.',
      "4. NO HANDLE OR BIO INFERENCES: Use ONLY information present in the conversation excerpt text. Do NOT guess or infer the author's profession, audience size, credentials, or personal background from their handle or username.",
      '5. TONE GUIDELINES: Follow the specified tone guidelines strictly (e.g., humble, peer-to-peer, transparent, non-salesy).',
      '6. TRANSPARENCY NOTE: You must include the provided transparency note disclosing your affiliation with the product.',
      '7. NO AUTOMATED DISPATCH: This text is a draft intended solely for human review and manual editing.',
    ].join('\n');
  }

  /**
   * Builds the user prompt containing structured verified context.
   */
  static buildUserPrompt(context: DraftPromptContext): string {
    const { profile, conversation, whyMatched, relevanceScore } = context;

    const sections = [
      'Please draft a contextual reply based on the following verified information:',
      '',
      '--- PRODUCT PROFILE ---',
      `Product Name: ${profile.productName}`,
      `Value Proposition: ${profile.valueProposition}`,
      profile.productDescription ? `Product Description: ${profile.productDescription}` : '',
      `Problems Solved:\n${profile.problemsSolved.map((p) => `- ${p}`).join('\n')}`,
      `Ideal Customer Description: ${profile.idealCustomerDescription}`,
      `Tone Guidelines: ${profile.toneGuidelines.join(', ')}`,
      profile.excludedTopics.length > 0
        ? `Excluded Topics (Do NOT mention): ${profile.excludedTopics.join(', ')}`
        : '',
      '',
      '--- CONVERSATION CONTEXT ---',
      `Platform: ${conversation.platform}`,
      `Author Handle: ${conversation.authorAlias} (Note: do NOT guess background or audience from handle)`,
      `Conversation Excerpt: "${conversation.contentExcerpt}"`,
      `Relevance Score: ${relevanceScore}/100`,
      `Matched Needs: ${whyMatched.matchedNeeds.join(', ')}`,
      `Context Snippet: "${whyMatched.contextSnippet}"`,
      `Relevance Rationale: ${whyMatched.relevanceRationale}`,
      '',
      '--- REQUIRED OUTPUT STRUCTURE ---',
      'Provide your response as a valid JSON object matching this schema:',
      '{',
      '  "replyText": "Helpful answer to the conversation first, mentioning the product only if directly relevant, strictly grounded in the profile without hallucinations.",',
      `  "valueAngle": "${DraftPromptBuilder.buildValueAngle(context)}",`,
      `  "transparencyNote": "${DraftPromptBuilder.buildTransparencyNote(profile)}"`,
      '}',
    ];

    return sections.filter((s) => s.length > 0).join('\n');
  }

  /**
   * Combines system and user prompts into a structured DraftPrompt.
   */
  static buildPrompt(context: DraftPromptContext): DraftPrompt {
    return {
      systemPrompt: DraftPromptBuilder.buildSystemPrompt(),
      userPrompt: DraftPromptBuilder.buildUserPrompt(context),
      context,
    };
  }
}
