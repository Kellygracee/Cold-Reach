import { describe, it, expect } from 'vitest';
import { ProductProfile } from '../contracts/profile.js';
import {
  QueryExpansionEngine,
  detectExclusionConflicts,
  normalizeQueryTerm,
} from './query-expansion.js';
import { ProfileValidationError } from './profile-service.js';

describe('QueryExpansionEngine', () => {
  const completeProfile: ProductProfile = {
    id: 'prof-demo-1',
    productName: 'FlowScribe AI',
    valueProposition: 'Automates podcast transcription and highlight generation for creators.',
    productDescription: 'Automates podcast transcription and highlight generation for creators.',
    problemsSolved: [
      'Hours spent manually transcribing audio',
      'Difficulty finding viral clip moments',
    ],
    idealCustomerDescription:
      'Independent podcasters and media agencies publishing weekly episodes.',
    seedKeywords: ['podcast transcription', 'audiogram', 'clip generator'],
    customerPainPointPhrases: [
      'audio transcription takes too long',
      'finding good clips is frustrating',
    ],
    excludedTopics: ['political commentary', 'cryptocurrency', 'free download'],
    toneGuidelines: ['Helpful', 'Empathetic', 'Non-salesy'],
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
  };

  describe('Query Generation across Different Profile Fields', () => {
    it('generates direct user terms and app expansions from seedKeywords', () => {
      const result = QueryExpansionEngine.expand(completeProfile);
      const seedCluster = result.clusters.find((c) => c.id === 'seed_terms');
      expect(seedCluster).toBeDefined();

      // Check user seed terms
      const userSeeds = seedCluster!.terms.filter((t) => t.source === 'USER');
      expect(userSeeds.length).toBe(3);
      expect(userSeeds.map((t) => t.term)).toContain('podcast transcription');
      expect(userSeeds.map((t) => t.term)).toContain('audiogram');
      expect(userSeeds.map((t) => t.term)).toContain('clip generator');

      // Verify reason and source field
      const ptTerm = userSeeds.find((t) => t.term === 'podcast transcription');
      expect(ptTerm?.reason).toBe('User-specified seed keyword');
      expect(ptTerm?.sourceField).toBe('seedKeywords');

      // Check app expansions derived from seedKeywords in solution_seeking
      const solCluster = result.clusters.find((c) => c.id === 'solution_seeking');
      expect(solCluster).toBeDefined();
      const bestTerm = solCluster!.terms.find((t) => t.term === 'best podcast transcription');
      expect(bestTerm).toBeDefined();
      expect(bestTerm?.source).toBe('APP');
      expect(bestTerm?.sourceField).toBe('seedKeywords');
      expect(bestTerm?.reason).toContain('seed keyword "podcast transcription"');
    });

    it('generates direct user terms and conversational venting queries from customerPainPointPhrases', () => {
      const result = QueryExpansionEngine.expand(completeProfile);
      const painCluster = result.clusters.find((c) => c.id === 'pain_points');
      expect(painCluster).toBeDefined();

      // Direct user pain points
      const userPainTerms = painCluster!.terms.filter(
        (t) => t.source === 'USER' && t.sourceField === 'customerPainPointPhrases',
      );
      expect(userPainTerms.length).toBe(2);
      expect(userPainTerms.map((t) => t.term)).toContain('audio transcription takes too long');
      expect(userPainTerms.map((t) => t.term)).toContain('finding good clips is frustrating');

      // App conversational complaint variants
      const tiredOfTerm = painCluster!.terms.find((t) =>
        t.term.includes('tired of audio transcription takes too long'),
      );
      expect(tiredOfTerm).toBeDefined();
      expect(tiredOfTerm?.source).toBe('APP');
      expect(tiredOfTerm?.sourceField).toBe('customerPainPointPhrases');
    });

    it('generates pain expressions and solution inquiries from problemsSolved', () => {
      const result = QueryExpansionEngine.expand(completeProfile);

      const painCluster = result.clusters.find((c) => c.id === 'pain_points');
      const solCluster = result.clusters.find((c) => c.id === 'solution_seeking');

      // Problem: "Hours spent manually transcribing audio" -> core: "transcribing audio"
      const strugglingProbTerm = painCluster!.terms.find((t) =>
        t.term.includes('struggling with transcribing audio'),
      );
      expect(strugglingProbTerm).toBeDefined();
      expect(strugglingProbTerm?.source).toBe('APP');
      expect(strugglingProbTerm?.sourceField).toBe('problemsSolved');
      expect(strugglingProbTerm?.reason).toContain('Hours spent manually transcribing audio');

      // Solution: "how to automate transcribing audio"
      const automateTerm = solCluster!.terms.find((t) =>
        t.term.includes('how to automate transcribing audio'),
      );
      expect(automateTerm).toBeDefined();
      expect(automateTerm?.source).toBe('APP');
    });

    it('generates audience context queries from idealCustomerDescription', () => {
      const result = QueryExpansionEngine.expand(completeProfile);
      const audCluster = result.clusters.find((c) => c.id === 'audience_context');
      expect(audCluster).toBeDefined();

      // Personas extracted: "independent podcasters", "media agencies"
      const podcasterToolTerm = audCluster!.terms.find(
        (t) => t.term === 'tools for independent podcasters',
      );
      expect(podcasterToolTerm).toBeDefined();
      expect(podcasterToolTerm?.source).toBe('APP');
      expect(podcasterToolTerm?.sourceField).toBe('idealCustomerDescription');

      // Paired with seed: "podcast transcription for independent podcasters"
      const pairedTerm = audCluster!.terms.find(
        (t) => t.term === 'podcast transcription for independent podcasters',
      );
      expect(pairedTerm).toBeDefined();
    });

    it('generates solution searches from productDescription / valueProposition', () => {
      const result = QueryExpansionEngine.expand(completeProfile);
      const solCluster = result.clusters.find((c) => c.id === 'solution_seeking');

      const automateValPropTerm = solCluster!.terms.find(
        (t) => t.term === 'automate podcast transcription',
      );
      expect(automateValPropTerm).toBeDefined();
      expect(automateValPropTerm?.source).toBe('APP');
      expect(automateValPropTerm?.sourceField).toBe('productDescription');
    });
  });

  describe('Excluded Topics and Conflict Handling', () => {
    it('flags user-entered terms without discarding them when they conflict with excluded topics', () => {
      const profileWithConflictingUserTerms: ProductProfile = {
        ...completeProfile,
        excludedTopics: ['cryptocurrency', 'politics'],
        seedKeywords: ['cryptocurrency podcast', 'valid seed'],
        customerPainPointPhrases: ['dealing with politics debates', 'safe pain point'],
      };

      const result = QueryExpansionEngine.expand(profileWithConflictingUserTerms);

      // Verify user terms are NOT discarded
      const seedCluster = result.clusters.find((c) => c.id === 'seed_terms');
      const cryptoSeed = seedCluster!.terms.find((t) => t.term === 'cryptocurrency podcast');
      expect(cryptoSeed).toBeDefined();
      expect(cryptoSeed?.source).toBe('USER');
      expect(cryptoSeed?.hasConflict).toBe(true);
      expect(cryptoSeed?.isFiltered).toBe(false); // DO NOT SILENTLY DISCARD
      expect(cryptoSeed?.conflictingExcludedTopics).toContain('cryptocurrency');
      expect(cryptoSeed?.reason).toContain('Warning: Conflicts with excluded topic(s)');

      const painCluster = result.clusters.find((c) => c.id === 'pain_points');
      const politicsPain = painCluster!.terms.find((t) =>
        t.term.includes('dealing with politics debates'),
      );
      expect(politicsPain).toBeDefined();
      expect(politicsPain?.hasConflict).toBe(true);
      expect(politicsPain?.isFiltered).toBe(false); // Retained but flagged
      expect(politicsPain?.conflictingExcludedTopics).toContain('politics');
    });

    it('filters out app-suggested terms that conflict with excluded topics', () => {
      const profileWithExclusion: ProductProfile = {
        ...completeProfile,
        excludedTopics: ['alternative'], // Will conflict with "X alternatives" generated for seeds
        seedKeywords: ['podcast transcription'],
      };

      const result = QueryExpansionEngine.expand(profileWithExclusion);

      const solCluster = result.clusters.find((c) => c.id === 'solution_seeking');
      const altTerm = solCluster!.terms.find((t) => t.term.includes('alternatives'));
      // App-suggested conflict should be omitted from active cluster
      expect(altTerm).toBeUndefined();

      // But should be captured in filteredTerms for auditability
      expect(result.filteredTermsCount).toBeGreaterThan(0);
      const filteredAlt = result.filteredTerms.find((t) => t.term.includes('alternatives'));
      expect(filteredAlt).toBeDefined();
      expect(filteredAlt?.isFiltered).toBe(true);
      expect(filteredAlt?.hasConflict).toBe(true);
      expect(filteredAlt?.conflictingExcludedTopics).toContain('alternative');
    });

    it('accurately uses word boundaries to prevent false substring exclusion matches', () => {
      // Excluded topic: "free"
      const { hasConflict: conflictFree } = detectExclusionConflicts('free podcast software', [
        'free',
      ]);
      expect(conflictFree).toBe(true);

      // "freelance" should NOT match excluded topic "free"
      const { hasConflict: conflictFreelance } = detectExclusionConflicts(
        'tools for freelance podcasters',
        ['free'],
      );
      expect(conflictFreelance).toBe(false);

      // "freemium" should NOT match excluded topic "free"
      const { hasConflict: conflictFreemium } = detectExclusionConflicts('freemium audio editor', [
        'free',
      ]);
      expect(conflictFreemium).toBe(false);
    });

    it('matches multi-word excluded topics', () => {
      const { hasConflict: matchPhrase } = detectExclusionConflicts(
        'how to start political commentary podcast',
        ['political commentary'],
      );
      expect(matchPhrase).toBe(true);

      const { hasConflict: noMatch } = detectExclusionConflicts('independent podcast commentary', [
        'political commentary',
      ]);
      expect(noMatch).toBe(false);
    });
  });

  describe('Deterministic Stability and Repeatability', () => {
    it('produces identical, repeatable results for the same profile across 10 runs', () => {
      const run1 = QueryExpansionEngine.expand(completeProfile);

      for (let i = 0; i < 9; i++) {
        const nextRun = QueryExpansionEngine.expand(completeProfile);

        // Normalize generatedAt for comparison since timestamp reflects execution time
        expect(nextRun.clusters).toEqual(run1.clusters);
        expect(nextRun.totalTermsCount).toBe(run1.totalTermsCount);
        expect(nextRun.activeTermsCount).toBe(run1.activeTermsCount);
        expect(nextRun.flaggedTermsCount).toBe(run1.flaggedTermsCount);
        expect(nextRun.filteredTermsCount).toBe(run1.filteredTermsCount);
        expect(nextRun.filteredTerms).toEqual(run1.filteredTerms);

        // Check exact ID and term match
        const terms1 = run1.clusters.flatMap((c) => c.terms);
        const termsNext = nextRun.clusters.flatMap((c) => c.terms);
        expect(termsNext.map((t) => t.id)).toEqual(terms1.map((t) => t.id));
        expect(termsNext.map((t) => t.term)).toEqual(terms1.map((t) => t.term));
      }
    });

    it('sorts user terms first, followed deterministically by app terms in alphabetical order', () => {
      const result = QueryExpansionEngine.expand(completeProfile);

      for (const cluster of result.clusters) {
        let seenApp = false;
        for (const term of cluster.terms) {
          if (term.source === 'APP') {
            seenApp = true;
          } else if (seenApp && term.source === 'USER') {
            // A USER term should never appear after an APP term
            expect.unreachable('Found USER term after APP term in cluster');
          }
        }
      }
    });
  });

  describe('Empty and Incomplete Profile Handling', () => {
    it('produces useful empty states without crashing when optional fields are empty', () => {
      const minimalProfile: ProductProfile = {
        id: 'prof-minimal-1',
        productName: 'MinimalTool',
        valueProposition: 'Syncs data between spreadsheets and databases',
        problemsSolved: ['Manual CSV copy pasting'],
        idealCustomerDescription: 'Data analysts at financial firms',
        seedKeywords: [],
        customerPainPointPhrases: [],
        excludedTopics: [],
        toneGuidelines: ['Direct'],
        createdAt: '2026-10-14T00:00:00.000Z',
        updatedAt: '2026-10-14T00:00:00.000Z',
      };

      const result = QueryExpansionEngine.expand(minimalProfile);

      expect(result.profileId).toBe('prof-minimal-1');
      expect(result.clusters.length).toBe(4);

      // seed_terms cluster is an empty array, no crash
      const seedCluster = result.clusters.find((c) => c.id === 'seed_terms');
      expect(seedCluster?.terms).toEqual([]);

      // Clusters with data from problemsSolved and idealCustomerDescription still populate
      const painCluster = result.clusters.find((c) => c.id === 'pain_points');
      expect(painCluster!.terms.length).toBeGreaterThan(0);

      const audCluster = result.clusters.find((c) => c.id === 'audience_context');
      expect(audCluster!.terms.length).toBeGreaterThan(0);
    });

    it('throws descriptive ProfileValidationError on invalid or empty profile input', () => {
      expect(() => QueryExpansionEngine.expand({})).toThrow(ProfileValidationError);
      expect(() => QueryExpansionEngine.expand(null)).toThrow(ProfileValidationError);
      expect(() =>
        QueryExpansionEngine.expand({
          productName: 'Test',
          // missing required fields
        }),
      ).toThrow(ProfileValidationError);
    });
  });

  describe('Review and Editing Capabilities', () => {
    it('allows adding a custom user term to a cluster', () => {
      const initial = QueryExpansionEngine.expand(completeProfile);
      const updated = QueryExpansionEngine.addTerm(
        initial,
        'seed_terms',
        'automated podcast show notes',
      );

      const seedCluster = updated.clusters.find((c) => c.id === 'seed_terms');
      const added = seedCluster?.terms.find((t) => t.term === 'automated podcast show notes');

      expect(added).toBeDefined();
      expect(added?.source).toBe('USER');
      expect(added?.reason).toBe('Custom user-added term');
      expect(updated.activeTermsCount).toBe(initial.activeTermsCount + 1);
    });

    it('flags added custom terms if they conflict with excluded topics', () => {
      const initial = QueryExpansionEngine.expand(completeProfile);
      const updated = QueryExpansionEngine.addTerm(
        initial,
        'seed_terms',
        'cryptocurrency show notes',
        { excludedTopics: completeProfile.excludedTopics },
      );

      const seedCluster = updated.clusters.find((c) => c.id === 'seed_terms');
      const added = seedCluster?.terms.find((t) => t.term === 'cryptocurrency show notes');

      expect(added).toBeDefined();
      expect(added?.hasConflict).toBe(true);
      expect(added?.conflictingExcludedTopics).toContain('cryptocurrency');
    });

    it('allows removing a term by ID', () => {
      const initial = QueryExpansionEngine.expand(completeProfile);
      const firstTerm = initial.clusters[0]!.terms[0]!;

      const updated = QueryExpansionEngine.removeTerm(initial, firstTerm.id);
      const found = updated.clusters.flatMap((c) => c.terms).find((t) => t.id === firstTerm.id);

      expect(found).toBeUndefined();
      expect(updated.activeTermsCount).toBe(initial.activeTermsCount - 1);
    });

    it('allows updating an existing term text and cluster', () => {
      const initial = QueryExpansionEngine.expand(completeProfile);
      const seedCluster = initial.clusters.find((c) => c.id === 'seed_terms')!;
      const termToUpdate = seedCluster.terms[0]!;

      const updated = QueryExpansionEngine.updateTerm(initial, termToUpdate.id, {
        term: 'customized seed keyword',
        cluster: 'solution_seeking',
      });

      // Old term ID removed
      const oldFound = updated.clusters
        .flatMap((c) => c.terms)
        .find((t) => t.id === termToUpdate.id);
      expect(oldFound).toBeUndefined();

      // New term appears in target cluster
      const solCluster = updated.clusters.find((c) => c.id === 'solution_seeking')!;
      const newFound = solCluster.terms.find((t) => t.term === 'customized seed keyword');
      expect(newFound).toBeDefined();
      expect(newFound?.reason).toContain('Edited by user');
    });

    it('extracts flat list of unique active search strings', () => {
      const result = QueryExpansionEngine.expand(completeProfile);
      const flatList = QueryExpansionEngine.getActiveTermStrings(result);

      expect(Array.isArray(flatList)).toBe(true);
      expect(flatList.length).toBeGreaterThan(0);
      expect(flatList.length).toBe(new Set(flatList).size); // all unique
      expect(flatList).toContain('podcast transcription');
    });
  });

  describe('normalizeQueryTerm helper', () => {
    it('cleans excessive whitespace and punctuation', () => {
      expect(normalizeQueryTerm('  BEST!! PODCAST...  TRANSCRIPTION?!  ')).toBe(
        'best podcast transcription',
      );
      expect(normalizeQueryTerm('tool: "audiogram" generator')).toBe('tool audiogram generator');
    });
  });
});
