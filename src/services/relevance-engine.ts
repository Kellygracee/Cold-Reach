import { ConversationItem } from '../contracts/conversation.js';
import { WhyMatchedExplanation } from '../contracts/opportunity.js';
import { ProductProfile } from '../contracts/profile.js';
import { QueryExpansionResult, QueryTerm } from '../contracts/query.js';
import { detectExclusionConflicts, normalizeQueryTerm } from './query-expansion.js';

export interface CandidateEvaluation {
  relevanceScore: number;
  whyMatched: WhyMatchedExplanation;
  matchedQueryTerms: string[];
  matchedProblems: string[];
  matchedAudience: string[];
  hasExclusionConflict: boolean;
  conflictingTopics: string[];
}

export interface EvaluateCandidateOptions {
  profile: ProductProfile;
  candidate: ConversationItem;
  queryTerms?: string[] | QueryTerm[] | QueryExpansionResult;
}

/**
 * Extracts normalized query terms from various supported inputs.
 */
function extractQueryStrings(
  input?: string[] | QueryTerm[] | QueryExpansionResult,
  fallbackProfile?: ProductProfile,
): string[] {
  if (!input) {
    // Fall back to seed keywords and pain points from profile
    const seeds = fallbackProfile?.seedKeywords ?? [];
    const painPoints = fallbackProfile?.customerPainPointPhrases ?? [];
    return [...seeds, ...painPoints].map(normalizeQueryTerm).filter(Boolean);
  }

  if (Array.isArray(input)) {
    return input
      .map((item) => (typeof item === 'string' ? item : item.term))
      .map(normalizeQueryTerm)
      .filter(Boolean);
  }

  // QueryExpansionResult
  if ('clusters' in input && Array.isArray(input.clusters)) {
    const list: string[] = [];
    for (const cluster of input.clusters) {
      for (const term of cluster.terms) {
        if (!term.isFiltered) {
          list.push(term.term);
        }
      }
    }
    return Array.from(new Set(list));
  }

  return [];
}

/**
 * Deterministic, explainable engine for evaluating conversation relevance against a product profile.
 */
export class RelevanceAnalysisEngine {
  /**
   * Evaluates a candidate ConversationItem against a ProductProfile and query terms.
   * Produces a bounded [0, 100] relevance score and structured whyMatched evidence.
   */
  static evaluate(options: EvaluateCandidateOptions): CandidateEvaluation {
    const { profile, candidate } = options;
    const excerpt = candidate.contentExcerpt;
    const normalizedExcerpt = normalizeQueryTerm(excerpt);

    const queryTerms = extractQueryStrings(options.queryTerms, profile);
    const excludedTopics = profile.excludedTopics ?? [];

    // 1. Conflict Check with Excluded Topics
    const { hasConflict, conflictingTopics } = detectExclusionConflicts(excerpt, excludedTopics);

    // 2. Direct Problem / Pain Point Alignment (0 to 35 points)
    const problems = profile.problemsSolved ?? [];
    const painPoints = profile.customerPainPointPhrases ?? [];
    const allProfileProblems = [...problems, ...painPoints];

    const matchedProblems: string[] = [];
    let problemScore = 0;

    for (const prob of allProfileProblems) {
      const normalizedProb = normalizeQueryTerm(prob);
      const probWords = normalizedProb
        .split(' ')
        .filter(
          (w) => w.length > 3 && !['with', 'from', 'that', 'this', 'have', 'more'].includes(w),
        );

      if (probWords.length === 0) continue;

      // Check phrase match or token matches
      if (normalizedExcerpt.includes(normalizedProb)) {
        matchedProblems.push(prob);
        problemScore = Math.max(problemScore, 35);
      } else {
        const matchingWords = probWords.filter((w) => {
          const regex = new RegExp(`(^|[^a-z0-9])${w}s?([^a-z0-9]|$)`, 'i');
          return regex.test(normalizedExcerpt);
        });

        if (matchingWords.length >= Math.min(2, probWords.length)) {
          matchedProblems.push(prob);
          const partialScore = Math.min(30, 15 + matchingWords.length * 5);
          problemScore = Math.max(problemScore, partialScore);
        }
      }
    }

    // 3. Query Terms Match (0 to 30 points)
    const matchedQueryTerms: string[] = [];
    for (const term of queryTerms) {
      const normalizedTerm = normalizeQueryTerm(term);
      if (normalizedTerm.includes(' ')) {
        if (normalizedExcerpt.includes(normalizedTerm)) {
          matchedQueryTerms.push(term);
        }
      } else {
        const regex = new RegExp(`(^|[^a-z0-9])${normalizedTerm}s?([^a-z0-9]|$)`, 'i');
        if (regex.test(normalizedExcerpt)) {
          matchedQueryTerms.push(term);
        }
      }
    }

    let queryScore = 0;
    if (matchedQueryTerms.length > 0) {
      queryScore = Math.min(30, 15 + (matchedQueryTerms.length - 1) * 5);
      // Multi-word exact query match bonus
      if (matchedQueryTerms.some((t) => t.includes(' '))) {
        queryScore = Math.min(30, queryScore + 5);
      }
    }

    // 4. Intent & Urgency Signals (0 to 20 points)
    let intentScore = 0;
    if (excerpt.includes('?')) {
      intentScore += 5;
    }

    const recommendationWords = [
      'recommend',
      'recommendations',
      'looking for',
      'alternative',
      'alternatives',
      'best tool',
      'best software',
      'any tool',
      'what tool',
      'suggestion',
      'suggestions',
    ];
    if (recommendationWords.some((w) => normalizedExcerpt.includes(w))) {
      intentScore += 15;
    }

    const painVentingWords = [
      'takes too long',
      'struggling',
      'struggle',
      'hate',
      'tired of',
      'drowning in',
      'frustrating',
      'painful',
      'headaches',
      'waste of time',
    ];
    if (painVentingWords.some((w) => normalizedExcerpt.includes(w))) {
      intentScore += 10;
    }

    intentScore = Math.min(20, intentScore);

    // 5. Target Audience Alignment (0 to 15 points)
    const matchedAudience: string[] = [];
    let audienceScore = 0;
    const icp = profile.idealCustomerDescription ?? '';
    const icpWords = normalizeQueryTerm(icp)
      .split(' ')
      .filter((w) => w.length >= 4 && !['teams', 'with', 'weekly', 'publishing'].includes(w));

    const expandedIcpWords = [...icpWords];
    if (icpWords.includes('independent')) {
      expandedIcpWords.push('indie');
    }

    const authorAndExcerpt =
      `${candidate.authorAlias.replace(/[_\-.]/g, ' ')} ${normalizedExcerpt}`.toLowerCase();
    for (const rawWord of expandedIcpWords) {
      const stem = rawWord.replace(/(?:ers?|ies|s)$/i, '');
      const regex = new RegExp(
        `(^|[^a-z0-9])(${rawWord}|${stem}(?:s|er|ers|ies)?)([^a-z0-9]|$)`,
        'i',
      );
      if (regex.test(authorAndExcerpt)) {
        matchedAudience.push(rawWord);
      }
    }

    if (matchedAudience.length > 0) {
      audienceScore = Math.min(15, 10 + (matchedAudience.length - 1) * 5);
    }

    // 6. Aggregate Score
    let rawScore = problemScore + queryScore + intentScore + audienceScore;

    // Apply exclusion penalty
    if (hasConflict) {
      // Severe penalty when excluded topics conflict; clamp to at most 15
      rawScore = Math.min(15, Math.max(0, rawScore - 60));
    }

    // Candidate length penalty if very sparse
    if (excerpt.length < 30 && rawScore > 20) {
      rawScore -= 10;
    }

    const finalScore = Math.min(100, Math.max(0, Math.round(rawScore)));

    // 7. Construct Structured WhyMatched Evidence
    const contextSnippet = excerpt.length > 250 ? `${excerpt.slice(0, 247)}...` : excerpt;

    let summary: string;
    let relevanceRationale: string;
    const matchedNeeds: string[] =
      matchedProblems.length > 0
        ? matchedProblems.slice(0, 3)
        : matchedQueryTerms.length > 0
          ? matchedQueryTerms.slice(0, 3).map((t) => `Discussion related to "${t}"`)
          : ['General industry discussion'];

    if (hasConflict) {
      summary = `Low relevance: Discussion conflicts with user-excluded topic(s): "${conflictingTopics.join(', ')}".`;
      relevanceRationale = `Although certain keywords matched, this conversation mentions excluded topics (${conflictingTopics.join(', ')}). Excluded topics are heavily penalized to protect brand reputation.`;
    } else if (finalScore >= 70) {
      summary = `${candidate.authorAlias} on ${candidate.platform} expresses an active need or bottleneck that directly aligns with ${profile.productName}.`;
      const problemPhrase = matchedProblems[0] ?? matchedQueryTerms[0] ?? 'core workflow';
      relevanceRationale = `The author states: "${contextSnippet}". This directly matches the problem "${problemPhrase}" which ${profile.productName} solves via its value proposition: "${profile.valueProposition}".`;
    } else if (finalScore >= 40) {
      summary = `${candidate.authorAlias} on ${candidate.platform} is discussing topics relevant to ${profile.productName}, representing a moderate engagement opportunity.`;
      const termPhrase = matchedQueryTerms.join(', ') || 'relevant keywords';
      relevanceRationale = `The conversation references ${termPhrase}. While not explicitly asking for a direct solution, ${profile.productName} provides relevant capabilities (${profile.valueProposition}) that could add value to this discussion.`;
    } else {
      summary = `Low relevance: ${candidate.authorAlias} mentions peripheral terms without expressing an urgent need solved by ${profile.productName}.`;
      relevanceRationale = `The post references keywords but lacks buying signals or active pain points addressed by ${profile.productName}. Score communicates low relevance without discarding the record.`;
    }

    const whyMatched: WhyMatchedExplanation = {
      summary,
      matchedNeeds,
      relevanceRationale,
      contextSnippet,
    };

    return {
      relevanceScore: finalScore,
      whyMatched,
      matchedQueryTerms,
      matchedProblems,
      matchedAudience,
      hasExclusionConflict: hasConflict,
      conflictingTopics,
    };
  }
}
