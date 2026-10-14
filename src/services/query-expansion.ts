import { ProductProfile, ProductProfileSchema } from '../contracts/profile.js';
import {
  QueryCluster,
  QueryClusterType,
  QueryExpansionResult,
  QuerySource,
  QuerySourceField,
  QueryTerm,
} from '../contracts/query.js';
import { ProfileValidationError } from './profile-service.js';

export interface QueryExpansionOptions {
  includeFilteredInClusters?: boolean;
}

/**
 * Escapes characters for safe usage in regular expressions.
 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converts a string into a URL-friendly slug.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * Normalizes query string for deduplication and display.
 */
export function normalizeQueryTerm(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether a candidate search term conflicts with any excluded topics.
 * Employs word-boundary checks for single tokens and phrase matching for multi-word exclusions.
 */
export function detectExclusionConflicts(
  term: string,
  excludedTopics: string[],
): { hasConflict: boolean; conflictingTopics: string[] } {
  const normalizedTerm = normalizeQueryTerm(term);
  const conflicts: string[] = [];

  for (const rawTopic of excludedTopics) {
    const topic = normalizeQueryTerm(rawTopic);
    if (!topic) continue;

    const words = topic.split(' ').filter(Boolean);
    if (words.length > 1) {
      // Multi-word phrase: match entire phrase or all tokens
      if (normalizedTerm.includes(topic)) {
        conflicts.push(rawTopic);
      } else {
        const allWordsPresent = words.every((w) => {
          const wordRegex = new RegExp(`(^|[^a-z0-9])${escapeRegex(w)}([^a-z0-9]|$)`, 'i');
          return wordRegex.test(normalizedTerm);
        });
        if (allWordsPresent) {
          conflicts.push(rawTopic);
        }
      }
    } else {
      // Single token: word-boundary match to avoid false substrings (e.g. 'free' in 'freelance')
      const singleWord = words[0];
      if (singleWord) {
        const regex = new RegExp(`(^|[^a-z0-9])${escapeRegex(singleWord)}s?([^a-z0-9]|$)`, 'i');
        if (regex.test(normalizedTerm)) {
          conflicts.push(rawTopic);
        }
      }
    }
  }

  return {
    hasConflict: conflicts.length > 0,
    conflictingTopics: Array.from(new Set(conflicts)),
  };
}

/**
 * Cleans problem strings by removing common filler starters.
 */
function extractCoreProblem(problemText: string): string {
  let cleaned = problemText
    .replace(/^[0-9]+[.)]\s*/, '')
    .replace(/^[-*•]\s*/, '')
    .trim();

  const fillers = [
    /^hours spent manually\s+/i,
    /^hours spent\s+/i,
    /^too much time spent\s+/i,
    /^too much time\s+/i,
    /^difficulty finding\s+/i,
    /^difficulty with\s+/i,
    /^difficulty\s+/i,
    /^struggling with\s+/i,
    /^struggle to\s+/i,
    /^unable to\s+/i,
    /^lack of\s+/i,
    /^trouble with\s+/i,
    /^frustrated with\s+/i,
    /^frustration with\s+/i,
    /^manually\s+/i,
    /^waste of time\s+/i,
    /^hard to\s+/i,
  ];

  for (const filler of fillers) {
    cleaned = cleaned.replace(filler, '').trim();
  }

  return normalizeQueryTerm(cleaned);
}

/**
 * Extracts target audience persona phrases from customer descriptions.
 */
function extractAudiencePersonas(description: string): string[] {
  const parts = description.split(/,|\band\b|\bor\b/i);
  const personas: string[] = [];

  for (const rawPart of parts) {
    // Strip trailing qualifying clauses
    let part = rawPart
      .replace(/\b(publishing|looking|seeking|who|that|with|managing|trying)\b.*$/i, '')
      .trim();

    part = normalizeQueryTerm(part);
    if (part.length >= 3 && !personas.includes(part)) {
      personas.push(part);
    }
  }

  return personas.slice(0, 3);
}

/**
 * Extracts core capability keywords from product descriptions or value propositions.
 */
function extractCapabilityPhrases(text: string): string[] {
  let cleaned = text
    .replace(/^(automates|helps|enables|simplifies|accelerates|provides|platform for)\s+/i, '')
    .replace(/\b(for|with|by)\b.*$/i, '')
    .trim();

  const parts = cleaned
    .split(/\band\b|,/i)
    .map(normalizeQueryTerm)
    .filter((p) => p.length >= 3);

  return parts.length > 0 ? parts : cleaned.length >= 3 ? [normalizeQueryTerm(cleaned)] : [];
}

/**
 * Deterministic query expansion engine for conversation-led marketing search.
 */
export class QueryExpansionEngine {
  /**
   * Generates search term clusters deterministically from a ProductProfile.
   */
  static expand(profileInput: unknown, options: QueryExpansionOptions = {}): QueryExpansionResult {
    const parseResult = ProductProfileSchema.safeParse(profileInput);
    if (!parseResult.success) {
      const messages = parseResult.error.errors.map(
        (e) => `${e.path.join('.') || 'root'}: ${e.message}`,
      );
      throw new ProfileValidationError(
        `Cannot expand queries on invalid profile: ${messages.join('; ')}`,
        parseResult.error.issues,
      );
    }

    const profile: ProductProfile = parseResult.data;
    const excludedTopics = profile.excludedTopics ?? [];

    // Internal maps to store candidates per cluster, keyed by normalized term
    const clusterMap: Record<QueryClusterType, Map<string, QueryTerm>> = {
      seed_terms: new Map(),
      pain_points: new Map(),
      solution_seeking: new Map(),
      audience_context: new Map(),
    };

    const filteredTerms: QueryTerm[] = [];

    const addCandidate = (
      cluster: QueryClusterType,
      rawTerm: string,
      source: QuerySource,
      reason: string,
      sourceField?: QuerySourceField,
    ) => {
      const term = normalizeQueryTerm(rawTerm);
      if (!term || term.length < 2) return;

      const { hasConflict, conflictingTopics } = detectExclusionConflicts(term, excludedTopics);

      const baseSlug = `${cluster}-${source.toLowerCase()}-${slugify(term)}`;
      let id = baseSlug;
      let counter = 1;
      const targetMap = clusterMap[cluster];
      while (Array.from(targetMap.values()).some((t) => t.id === id)) {
        id = `${baseSlug}-${counter++}`;
      }

      let isFiltered = false;
      let finalReason = reason;
      let conflictReason: string | undefined;

      if (hasConflict) {
        if (source === 'USER') {
          // USER TERMS: MUST NEVER BE SILENTLY DISCARDED
          isFiltered = false;
          conflictReason = `Conflicts with excluded topic(s): "${conflictingTopics.join(', ')}"`;
          finalReason = `${reason} (Warning: ${conflictReason})`;
        } else {
          // APP TERMS: Filtered or clearly flagged
          isFiltered = true;
          conflictReason = `Filtered out: conflicts with excluded topic(s): "${conflictingTopics.join(', ')}"`;
          finalReason = `Suggested term filtered (${conflictReason})`;
        }
      }

      const queryTerm: QueryTerm = {
        id,
        term,
        source,
        cluster,
        reason: finalReason,
        sourceField,
        hasConflict,
        conflictingExcludedTopics: conflictingTopics,
        isFiltered,
        conflictReason,
      };

      if (isFiltered) {
        filteredTerms.push(queryTerm);
        if (options.includeFilteredInClusters) {
          targetMap.set(term, queryTerm);
        }
      } else {
        // If an app term was already present and a user term arrives, user term takes precedence
        const existing = targetMap.get(term);
        if (!existing || (existing.source === 'APP' && source === 'USER')) {
          targetMap.set(term, queryTerm);
        }
      }
    };

    // 1. Process Seed Keywords
    const seedKeywords = profile.seedKeywords ?? [];
    for (const seed of seedKeywords) {
      // Direct User Seed Term
      addCandidate('seed_terms', seed, 'USER', 'User-specified seed keyword', 'seedKeywords');

      // Solution-seeking intent variations
      addCandidate(
        'solution_seeking',
        `best ${seed}`,
        'APP',
        `Recommendation query derived from seed keyword "${seed}"`,
        'seedKeywords',
      );
      addCandidate(
        'solution_seeking',
        `${seed} recommendations`,
        'APP',
        `Recommendation inquiry derived from seed keyword "${seed}"`,
        'seedKeywords',
      );
      addCandidate(
        'solution_seeking',
        `${seed} tool`,
        'APP',
        `Tool search derived from seed keyword "${seed}"`,
        'seedKeywords',
      );
      addCandidate(
        'solution_seeking',
        `${seed} software`,
        'APP',
        `Software search derived from seed keyword "${seed}"`,
        'seedKeywords',
      );
      addCandidate(
        'solution_seeking',
        `${seed} alternatives`,
        'APP',
        `Alternative search derived from seed keyword "${seed}"`,
        'seedKeywords',
      );
      addCandidate(
        'solution_seeking',
        `how to ${seed}`,
        'APP',
        `Workflow inquiry derived from seed keyword "${seed}"`,
        'seedKeywords',
      );

      // Pain point expressions from seed
      addCandidate(
        'pain_points',
        `${seed} takes too long`,
        'APP',
        `Pain-point query derived from seed keyword "${seed}"`,
        'seedKeywords',
      );
      addCandidate(
        'pain_points',
        `struggling with ${seed}`,
        'APP',
        `Frustration query derived from seed keyword "${seed}"`,
        'seedKeywords',
      );
    }

    // 2. Process Customer Pain-Point Phrases
    const painPhrases = profile.customerPainPointPhrases ?? [];
    for (const phrase of painPhrases) {
      // Direct User Pain Point
      addCandidate(
        'pain_points',
        phrase,
        'USER',
        'User-specified customer pain-point phrase',
        'customerPainPointPhrases',
      );

      // Conversational variations
      addCandidate(
        'pain_points',
        `tired of ${phrase}`,
        'APP',
        `Conversational complaint derived from pain point "${phrase}"`,
        'customerPainPointPhrases',
      );
      addCandidate(
        'pain_points',
        `anyone else struggle with ${phrase}`,
        'APP',
        `Community inquiry derived from pain point "${phrase}"`,
        'customerPainPointPhrases',
      );
      addCandidate(
        'solution_seeking',
        `how to fix ${phrase}`,
        'APP',
        `Solution search derived from pain point "${phrase}"`,
        'customerPainPointPhrases',
      );
      addCandidate(
        'solution_seeking',
        `solution for ${phrase}`,
        'APP',
        `Solution search derived from pain point "${phrase}"`,
        'customerPainPointPhrases',
      );
    }

    // 3. Process Problems Solved
    const problems = profile.problemsSolved ?? [];
    for (const prob of problems) {
      const core = extractCoreProblem(prob);
      if (!core) continue;

      addCandidate(
        'pain_points',
        `struggling with ${core}`,
        'APP',
        `Frustration expression derived from problem solved: "${prob}"`,
        'problemsSolved',
      );
      addCandidate(
        'pain_points',
        `too much time ${core}`,
        'APP',
        `Time-drain complaint derived from problem solved: "${prob}"`,
        'problemsSolved',
      );
      addCandidate(
        'pain_points',
        `hate ${core}`,
        'APP',
        `Conversational venting derived from problem solved: "${prob}"`,
        'problemsSolved',
      );
      addCandidate(
        'solution_seeking',
        `how to automate ${core}`,
        'APP',
        `Automation inquiry derived from problem solved: "${prob}"`,
        'problemsSolved',
      );
      addCandidate(
        'solution_seeking',
        `tool to ${core}`,
        'APP',
        `Tool discovery derived from problem solved: "${prob}"`,
        'problemsSolved',
      );
      addCandidate(
        'solution_seeking',
        `best way to ${core}`,
        'APP',
        `Workflow advice query derived from problem solved: "${prob}"`,
        'problemsSolved',
      );
    }

    // 4. Process Product Description / Value Proposition
    const productDescText = profile.productDescription ?? profile.valueProposition;
    if (productDescText) {
      const capabilities = extractCapabilityPhrases(productDescText);
      for (const cap of capabilities) {
        addCandidate(
          'solution_seeking',
          `automate ${cap}`,
          'APP',
          `Solution search derived from product value proposition`,
          'productDescription',
        );
        addCandidate(
          'solution_seeking',
          `software for ${cap}`,
          'APP',
          `Software search derived from product value proposition`,
          'productDescription',
        );
      }
    }

    // 5. Process Ideal Customer Context
    const audiencePersonas = extractAudiencePersonas(profile.idealCustomerDescription);
    const topSeeds = seedKeywords.slice(0, 3);
    const topProblems = problems.slice(0, 2).map(extractCoreProblem).filter(Boolean);

    for (const persona of audiencePersonas) {
      addCandidate(
        'audience_context',
        `tools for ${persona}`,
        'APP',
        `Audience toolkit query derived from ideal customer profile "${persona}"`,
        'idealCustomerDescription',
      );

      for (const seed of topSeeds) {
        addCandidate(
          'audience_context',
          `${seed} for ${persona}`,
          'APP',
          `Audience query combining persona "${persona}" with seed keyword "${seed}"`,
          'idealCustomerDescription',
        );
        addCandidate(
          'audience_context',
          `${persona} ${seed} workflow`,
          'APP',
          `Workflow inquiry combining persona "${persona}" with seed keyword "${seed}"`,
          'idealCustomerDescription',
        );
      }

      for (const probCore of topProblems) {
        addCandidate(
          'audience_context',
          `how do ${persona} ${probCore}`,
          'APP',
          `Workflow discussion combining persona "${persona}" with problem "${probCore}"`,
          'idealCustomerDescription',
        );
      }
    }

    // Sort terms deterministically: USER first, then alphabetically by term
    const sortTerms = (terms: QueryTerm[]): QueryTerm[] => {
      return [...terms].sort((a, b) => {
        if (a.source !== b.source) {
          return a.source === 'USER' ? -1 : 1;
        }
        return a.term.localeCompare(b.term);
      });
    };

    const clusterDefinitions: Array<{
      id: QueryClusterType;
      name: string;
      description: string;
    }> = [
      {
        id: 'seed_terms',
        name: 'Core Seed Terms',
        description: 'Direct user seed keywords and closely anchored search terms',
      },
      {
        id: 'pain_points',
        name: 'Pain Points & Frustrations',
        description:
          'Conversational phrases used when expressing bottlenecks, venting, or difficulties',
      },
      {
        id: 'solution_seeking',
        name: 'Solution Seeking & Recommendations',
        description:
          'Queries asking for tool recommendations, alternatives, software, and how-to solutions',
      },
      {
        id: 'audience_context',
        name: 'Audience & Contextual Queries',
        description: 'Queries pairing ideal customer personas with workflows and tooling needs',
      },
    ];

    const clusters: QueryCluster[] = clusterDefinitions.map((def) => {
      const terms = sortTerms(Array.from(clusterMap[def.id].values()));
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        terms,
      };
    });

    const activeTerms = clusters.flatMap((c) => c.terms);
    const flaggedTerms = activeTerms.filter((t) => t.hasConflict);

    return {
      profileId: profile.id,
      generatedAt: new Date().toISOString(),
      clusters,
      totalTermsCount: activeTerms.length + filteredTerms.length,
      activeTermsCount: activeTerms.length,
      flaggedTermsCount: flaggedTerms.length,
      filteredTermsCount: filteredTerms.length,
      filteredTerms: sortTerms(filteredTerms),
    };
  }

  /**
   * Adds a custom or reviewed search term to an existing expansion result.
   */
  static addTerm(
    result: QueryExpansionResult,
    clusterId: QueryClusterType,
    termText: string,
    options: {
      source?: QuerySource;
      reason?: string;
      excludedTopics?: string[];
    } = {},
  ): QueryExpansionResult {
    const term = normalizeQueryTerm(termText);
    const source = options.source ?? 'USER';
    const reason = options.reason ?? 'Custom user-added term';
    const excludedTopics = options.excludedTopics ?? [];

    const { hasConflict, conflictingTopics } = detectExclusionConflicts(term, excludedTopics);

    const baseSlug = `${clusterId}-${source.toLowerCase()}-${slugify(term)}`;
    const newTerm: QueryTerm = {
      id: `${baseSlug}-${Date.now()}`,
      term,
      source,
      cluster: clusterId,
      reason: hasConflict
        ? `${reason} (Warning: Conflicts with excluded topic(s): "${conflictingTopics.join(', ')}")`
        : reason,
      hasConflict,
      conflictingExcludedTopics: conflictingTopics,
      isFiltered: false,
      conflictReason: hasConflict
        ? `Conflicts with excluded topic(s): "${conflictingTopics.join(', ')}"`
        : undefined,
    };

    const updatedClusters = result.clusters.map((cluster) => {
      if (cluster.id !== clusterId) return cluster;
      // Filter duplicate if term already exists
      const existingFiltered = cluster.terms.filter((t) => t.term !== term);
      return {
        ...cluster,
        terms: [...existingFiltered, newTerm],
      };
    });

    const activeTerms = updatedClusters.flatMap((c) => c.terms);
    return {
      ...result,
      clusters: updatedClusters,
      totalTermsCount: activeTerms.length + result.filteredTerms.length,
      activeTermsCount: activeTerms.length,
      flaggedTermsCount: activeTerms.filter((t) => t.hasConflict).length,
    };
  }

  /**
   * Removes a search term by ID from an existing expansion result.
   */
  static removeTerm(result: QueryExpansionResult, termId: string): QueryExpansionResult {
    const updatedClusters = result.clusters.map((cluster) => ({
      ...cluster,
      terms: cluster.terms.filter((t) => t.id !== termId),
    }));

    const updatedFiltered = result.filteredTerms.filter((t) => t.id !== termId);
    const activeTerms = updatedClusters.flatMap((c) => c.terms);

    return {
      ...result,
      clusters: updatedClusters,
      filteredTerms: updatedFiltered,
      totalTermsCount: activeTerms.length + updatedFiltered.length,
      activeTermsCount: activeTerms.length,
      flaggedTermsCount: activeTerms.filter((t) => t.hasConflict).length,
      filteredTermsCount: updatedFiltered.length,
    };
  }

  /**
   * Updates an existing search term text or cluster.
   */
  static updateTerm(
    result: QueryExpansionResult,
    termId: string,
    updates: { term?: string; cluster?: QueryClusterType },
  ): QueryExpansionResult {
    let foundTerm: QueryTerm | undefined;

    // Locate the term
    for (const cluster of result.clusters) {
      const match = cluster.terms.find((t) => t.id === termId);
      if (match) {
        foundTerm = { ...match };
        break;
      }
    }

    if (!foundTerm) {
      throw new Error(`Term with ID "${termId}" not found in expansion clusters.`);
    }

    const newClusterId = updates.cluster ?? foundTerm.cluster;
    const newTermText = updates.term ? normalizeQueryTerm(updates.term) : foundTerm.term;

    const modifiedTerm: QueryTerm = {
      ...foundTerm,
      term: newTermText,
      cluster: newClusterId,
      reason: updates.term
        ? `${foundTerm.reason} (Edited by user to "${newTermText}")`
        : foundTerm.reason,
    };

    const withoutOld = this.removeTerm(result, termId);
    return this.addTerm(withoutOld, newClusterId, modifiedTerm.term, {
      source: modifiedTerm.source,
      reason: modifiedTerm.reason,
      excludedTopics: modifiedTerm.conflictingExcludedTopics,
    });
  }

  /**
   * Returns a flat list of all active, non-filtered search query strings.
   */
  static getActiveTermStrings(result: QueryExpansionResult): string[] {
    const set = new Set<string>();
    for (const cluster of result.clusters) {
      for (const term of cluster.terms) {
        if (!term.isFiltered) {
          set.add(term.term);
        }
      }
    }
    return Array.from(set);
  }
}
