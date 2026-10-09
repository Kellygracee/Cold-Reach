import { describe, it, expect } from 'vitest';
import { ProductProfileSchema } from './profile.js';
import { ConversationItemSchema } from './conversation.js';
import { DraftReplySchema } from './draft.js';
import { OpportunitySchema } from './opportunity.js';
import {
  validateRelevanceScore,
  validateIsoTimestamp,
  validateSourcePermalink,
  assertNotDemoAsLive,
  verifyManualResponseOnly,
  markManuallyResponded,
  IntegrityValidationError,
} from './integrity.js';

describe('ProductProfile Data Contract', () => {
  const validProfile = {
    id: 'prof-101',
    productName: 'FlowScribe AI',
    valueProposition: 'Automates podcast transcription and highlight generation for creators.',
    problemsSolved: [
      'Hours spent manually transcribing audio',
      'Difficulty finding viral clip moments',
    ],
    idealCustomerDescription:
      'Independent podcasters and media agencies publishing weekly episodes.',
    excludedTopics: ['Political commentary', 'Cryptocurrency scams'],
    toneGuidelines: ['Helpful', 'Empathetic', 'Non-salesy', 'Concise'],
    createdAt: '2026-10-09T10:00:00.000Z',
    updatedAt: '2026-10-09T10:00:00.000Z',
  };

  it('validates a complete and well-formed product profile', () => {
    const parsed = ProductProfileSchema.parse(validProfile);
    expect(parsed.productName).toBe('FlowScribe AI');
    expect(parsed.problemsSolved.length).toBe(2);
  });

  it('rejects blank or whitespace-only product name', () => {
    expect(() =>
      ProductProfileSchema.parse({
        ...validProfile,
        productName: '   ',
      }),
    ).toThrow(/Product name cannot be blank/);
  });

  it('rejects empty problems solved list', () => {
    expect(() =>
      ProductProfileSchema.parse({
        ...validProfile,
        problemsSolved: [],
      }),
    ).toThrow(/At least one problem solved must be specified/);
  });

  it('rejects empty tone guidelines list', () => {
    expect(() =>
      ProductProfileSchema.parse({
        ...validProfile,
        toneGuidelines: [],
      }),
    ).toThrow(/At least one tone guideline must be specified/);
  });

  it('rejects invalid timestamp for createdAt', () => {
    expect(() =>
      ProductProfileSchema.parse({
        ...validProfile,
        createdAt: 'invalid-date',
      }),
    ).toThrow(/createdAt must be a valid ISO 8601 timestamp/);
  });
});

describe('ConversationItem Data Contract & Provenance', () => {
  const validConversation = {
    id: 'conv-550',
    platform: 'reddit',
    authorAlias: 'audio_creator_99',
    contentExcerpt: 'Any tool to quickly transcribe 2 hours of audio without paying $50/mo?',
    sourcePermalink: 'https://reddit.com/r/podcasting/comments/abc123/transcription_help',
    timestamp: '2026-10-09T11:30:00.000Z',
    matchedKeywords: ['transcribe', 'podcast audio', 'transcription tool'],
    sourceProvenance: 'LIVE' as const,
  };

  it('accepts valid LIVE conversation item', () => {
    const parsed = ConversationItemSchema.parse(validConversation);
    expect(parsed.sourceProvenance).toBe('LIVE');
    expect(parsed.sourcePermalink).toBe(
      'https://reddit.com/r/podcasting/comments/abc123/transcription_help',
    );
  });

  it('accepts valid DEMO conversation item', () => {
    const parsed = ConversationItemSchema.parse({
      ...validConversation,
      sourceProvenance: 'DEMO',
    });
    expect(parsed.sourceProvenance).toBe('DEMO');
  });

  it('rejects missing or ambiguous provenance', () => {
    expect(() =>
      ConversationItemSchema.parse({
        ...validConversation,
        sourceProvenance: 'MOCK',
      }),
    ).toThrow(/Source provenance must be explicitly DEMO or LIVE/);

    expect(() =>
      ConversationItemSchema.parse({
        ...validConversation,
        sourceProvenance: undefined,
      }),
    ).toThrow(/Source provenance must be explicitly DEMO or LIVE/);
  });

  it('rejects malformed or non-HTTP permalink URLs', () => {
    expect(() =>
      ConversationItemSchema.parse({
        ...validConversation,
        sourcePermalink: 'not-a-valid-url',
      }),
    ).toThrow(/Source permalink must be a valid URL/);

    expect(() =>
      ConversationItemSchema.parse({
        ...validConversation,
        sourcePermalink: 'ftp://files.example.com/item',
      }),
    ).toThrow(/Source permalink must use http or https protocol/);
  });

  it('rejects blank platform or author alias', () => {
    expect(() =>
      ConversationItemSchema.parse({
        ...validConversation,
        platform: '',
      }),
    ).toThrow(/Platform identifier cannot be blank/);

    expect(() =>
      ConversationItemSchema.parse({
        ...validConversation,
        authorAlias: '   ',
      }),
    ).toThrow(/Author alias cannot be blank/);
  });
});

describe('DraftReply Data Contract & Human Revisions', () => {
  const validDraft = {
    id: 'draft-901',
    replyText:
      'We run into this a lot with hour-long episodes. One trick is using local Whisper models if you have a decent GPU, or batch processing via API services.',
    valueAngle: 'Offer direct technical advice on cost-effective transcription options.',
    transparencyNote: 'Disclosing that I build FlowScribe AI if mentioning our tool in follow-up.',
    revisionHistory: [],
    createdAt: '2026-10-09T12:00:00.000Z',
    updatedAt: '2026-10-09T12:00:00.000Z',
  };

  it('validates initial draft reply', () => {
    const parsed = DraftReplySchema.parse(validDraft);
    expect(parsed.replyText).toContain('Whisper');
    expect(parsed.revisionHistory).toEqual([]);
  });

  it('records human editorial revisions', () => {
    const withRevision = {
      ...validDraft,
      revisionHistory: [
        {
          id: 'rev-1',
          editedAt: '2026-10-09T12:05:00.000Z',
          editedBy: 'USER' as const,
          previousText: validDraft.replyText,
          newText:
            'One trick is using local Whisper models or checking lightweight open tools before committing to high monthly subscriptions.',
          changeSummary: 'Softened phrasing to be even more educational',
        },
      ],
    };

    const parsed = DraftReplySchema.parse(withRevision);
    expect(parsed.revisionHistory.length).toBe(1);
    expect(parsed.revisionHistory[0]?.editedBy).toBe('USER');
  });

  it('rejects bot or automated revision attribution', () => {
    expect(() =>
      DraftReplySchema.parse({
        ...validDraft,
        revisionHistory: [
          {
            id: 'rev-2',
            editedAt: '2026-10-09T12:05:00.000Z',
            editedBy: 'BOT',
            previousText: 'old',
            newText: 'new text',
          },
        ],
      }),
    ).toThrow(/Revisions must be made by a human user/);
  });
});

describe('Opportunity Data Contract & Workflow State Machine', () => {
  const conversation = {
    id: 'conv-1',
    platform: 'hackernews',
    authorAlias: 'hn_founder',
    contentExcerpt: 'How do you extract quotes from audio interviews effectively?',
    sourcePermalink: 'https://news.ycombinator.com/item?id=39123456',
    timestamp: '2026-10-09T08:00:00.000Z',
    matchedKeywords: ['extract quotes', 'audio interviews'],
    sourceProvenance: 'LIVE' as const,
  };

  const validOpportunity = {
    id: 'opp-10',
    conversation,
    relevanceScore: 88,
    whyMatched: {
      summary: 'Founder asking about audio quote extraction workflow',
      matchedNeeds: ['Audio transcription speed', 'Key highlight extraction'],
      relevanceRationale:
        'The query maps directly to our highlight extraction and timestamped quote engine.',
      contextSnippet: 'How do you extract quotes from audio interviews effectively?',
    },
    replyDraft: null,
    status: 'NEW' as const,
    createdAt: '2026-10-09T08:05:00.000Z',
    updatedAt: '2026-10-09T08:05:00.000Z',
  };

  it('validates a NEW opportunity', () => {
    const parsed = OpportunitySchema.parse(validOpportunity);
    expect(parsed.status).toBe('NEW');
    expect(parsed.relevanceScore).toBe(88);
  });

  it('rejects relevance score below 0', () => {
    expect(() =>
      OpportunitySchema.parse({
        ...validOpportunity,
        relevanceScore: -5,
      }),
    ).toThrow(/Relevance score cannot be below 0/);
  });

  it('rejects relevance score above 100', () => {
    expect(() =>
      OpportunitySchema.parse({
        ...validOpportunity,
        relevanceScore: 101,
      }),
    ).toThrow(/Relevance score cannot be above 100/);
  });

  it('allows valid boundary relevance scores 0 and 100', () => {
    const zeroScore = OpportunitySchema.parse({
      ...validOpportunity,
      relevanceScore: 0,
    });
    expect(zeroScore.relevanceScore).toBe(0);

    const hundredScore = OpportunitySchema.parse({
      ...validOpportunity,
      relevanceScore: 100,
    });
    expect(hundredScore.relevanceScore).toBe(100);
  });

  it('allows valid statuses: NEW, REVIEWED, SKIPPED', () => {
    for (const status of ['NEW', 'REVIEWED', 'SKIPPED'] as const) {
      const parsed = OpportunitySchema.parse({
        ...validOpportunity,
        status,
      });
      expect(parsed.status).toBe(status);
    }
  });

  it('rejects RESPONDED status without manualResponseAudit', () => {
    expect(() =>
      OpportunitySchema.parse({
        ...validOpportunity,
        status: 'RESPONDED',
      }),
    ).toThrow(
      /RESPONDED status requires manualResponseAudit confirming that the user manually sent the reply/,
    );
  });

  it('rejects manualResponseAudit on non-RESPONDED status', () => {
    expect(() =>
      OpportunitySchema.parse({
        ...validOpportunity,
        status: 'NEW',
        manualResponseAudit: {
          markedSentAt: '2026-10-09T09:00:00.000Z',
          manualDispatchConfirmed: true,
          dispatchMethod: 'MANUAL_EXTERNAL_POST',
        },
      }),
    ).toThrow(/manualResponseAudit cannot be set unless the opportunity status is RESPONDED/);
  });

  it('validates RESPONDED status when user explicitly confirms manual posting', () => {
    const respondedOpportunity = OpportunitySchema.parse({
      ...validOpportunity,
      status: 'RESPONDED',
      manualResponseAudit: {
        markedSentAt: '2026-10-09T09:30:00.000Z',
        manualDispatchConfirmed: true,
        dispatchMethod: 'MANUAL_EXTERNAL_POST',
        operatorNotes: 'Copied reply and posted manually via Hacker News web client.',
      },
    });

    expect(respondedOpportunity.status).toBe('RESPONDED');
    expect(respondedOpportunity.manualResponseAudit?.dispatchMethod).toBe('MANUAL_EXTERNAL_POST');
    expect(respondedOpportunity.manualResponseAudit?.manualDispatchConfirmed).toBe(true);
  });
});

describe('Integrity Rules & Safety Guards', () => {
  it('validateRelevanceScore helper accurately enforces bounds', () => {
    expect(validateRelevanceScore(0)).toBe(true);
    expect(validateRelevanceScore(50)).toBe(true);
    expect(validateRelevanceScore(100)).toBe(true);
    expect(validateRelevanceScore(-1)).toBe(false);
    expect(validateRelevanceScore(101)).toBe(false);
    expect(validateRelevanceScore(NaN)).toBe(false);
  });

  it('validateIsoTimestamp validates correct ISO strings and rejects invalid dates', () => {
    expect(validateIsoTimestamp('2026-10-09T10:00:00.000Z')).toBe(true);
    expect(validateIsoTimestamp('2026-10-09T10:00:00Z')).toBe(true);
    expect(validateIsoTimestamp('invalid-timestamp')).toBe(false);
    expect(validateIsoTimestamp('')).toBe(false);
  });

  it('validateSourcePermalink enforces valid HTTP/HTTPS URLs', () => {
    expect(validateSourcePermalink('https://reddit.com/r/ask')).toBe(true);
    expect(validateSourcePermalink('http://example.org/post')).toBe(true);
    expect(validateSourcePermalink('ftp://ftp.example.org')).toBe(false);
    expect(validateSourcePermalink('invalid-url')).toBe(false);
  });

  it('assertNotDemoAsLive prevents presenting demo data as live results', () => {
    const demoItem = {
      id: 'demo-1',
      platform: 'reddit',
      authorAlias: 'demo_user',
      contentExcerpt: 'Sample demo question',
      sourcePermalink: 'https://example.com/demo',
      timestamp: '2026-10-09T10:00:00.000Z',
      matchedKeywords: ['demo'],
      sourceProvenance: 'DEMO' as const,
    };

    // Passing DEMO presented as DEMO is valid
    expect(() => assertNotDemoAsLive(demoItem, 'DEMO')).not.toThrow();

    // Passing DEMO presented as LIVE violates integrity
    expect(() => assertNotDemoAsLive(demoItem, 'LIVE')).toThrow(IntegrityValidationError);
  });

  it('markManuallyResponded helper transitions status with manual audit and forbids auto-dispatch', () => {
    const opportunity = {
      id: 'opp-22',
      conversation: {
        id: 'c-22',
        platform: 'reddit',
        authorAlias: 'creator',
        contentExcerpt: 'Need recommendations',
        sourcePermalink: 'https://reddit.com/r/startups/1',
        timestamp: '2026-10-09T09:00:00.000Z',
        matchedKeywords: ['recommendations'],
        sourceProvenance: 'LIVE' as const,
      },
      relevanceScore: 92,
      whyMatched: {
        summary: 'Recommendation request',
        matchedNeeds: ['Workflow recommendation'],
        relevanceRationale: 'Matches our feature set.',
        contextSnippet: 'Need recommendations',
      },
      replyDraft: null,
      status: 'REVIEWED' as const,
      createdAt: '2026-10-09T09:05:00.000Z',
      updatedAt: '2026-10-09T09:05:00.000Z',
    };

    const updated = markManuallyResponded(opportunity, {
      markedSentAt: '2026-10-09T09:15:00.000Z',
      operatorNotes: 'Human user posted reply manually in browser.',
    });

    expect(updated.status).toBe('RESPONDED');
    expect(updated.manualResponseAudit?.manualDispatchConfirmed).toBe(true);
    expect(updated.manualResponseAudit?.dispatchMethod).toBe('MANUAL_EXTERNAL_POST');
    expect(verifyManualResponseOnly(updated.manualResponseAudit!)).toBe(true);

    // Verify it parses against the schema
    expect(() => OpportunitySchema.parse(updated)).not.toThrow();
  });
});
