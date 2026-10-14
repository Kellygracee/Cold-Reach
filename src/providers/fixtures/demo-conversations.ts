import { ConversationItem } from '../../contracts/conversation.js';

/**
 * Curated, fictional conversation fixtures for DemoProvider search.
 * Strictly labeled with sourceProvenance: 'DEMO'.
 * Authors and excerpts are fictional.
 */
export const DEMO_CONVERSATION_FIXTURES: ConversationItem[] = [
  {
    id: 'conv-demo-001',
    platform: 'reddit',
    authorAlias: 'audio_artisan_99',
    contentExcerpt:
      'Any recommendations for a podcast transcription tool that can handle multiple speakers accurately? I spend hours manually editing show notes.',
    sourcePermalink:
      'https://reddit.com/r/podcasting/comments/abc101/podcast_transcription_recommendations',
    timestamp: '2026-10-12T14:30:00.000Z',
    matchedKeywords: ['podcast transcription', 'transcription tool'],
    sourceProvenance: 'DEMO',
  },
  {
    id: 'conv-demo-002',
    platform: 'twitter',
    authorAlias: 'pod_host_dan',
    contentExcerpt:
      'Finding good clips from a 60-minute interview takes too long. Is there software to generate viral audiograms and highlight clips automatically?',
    sourcePermalink: 'https://twitter.com/pod_host_dan/status/1900000000000002',
    timestamp: '2026-10-13T09:15:00.000Z',
    matchedKeywords: ['audiogram', 'clip generator', 'finding good clips'],
    sourceProvenance: 'DEMO',
  },
  {
    id: 'conv-demo-003',
    platform: 'hackernews',
    authorAlias: 'indie_creator_maya',
    contentExcerpt:
      'Ask HN: What is the best podcast transcription workflow you use in 2026? Most SaaS tools are either too slow or too expensive.',
    sourcePermalink: 'https://news.ycombinator.com/item?id=9900003',
    timestamp: '2026-10-13T16:45:00.000Z',
    matchedKeywords: ['best podcast transcription', 'podcast transcription workflow'],
    sourceProvenance: 'DEMO',
  },
  {
    id: 'conv-demo-004',
    platform: 'reddit',
    authorAlias: 'media_agency_sam',
    contentExcerpt:
      'Our media agencies manage 15 weekly podcasts. We are drowning in manual transcription and clip generation work. Need a solid team solution.',
    sourcePermalink:
      'https://reddit.com/r/AudioPost/comments/abc104/media_agency_workflow_solutions',
    timestamp: '2026-10-14T08:00:00.000Z',
    matchedKeywords: ['media agencies', 'clip generation', 'podcast transcription'],
    sourceProvenance: 'DEMO',
  },
  {
    id: 'conv-demo-005',
    platform: 'linkedin',
    authorAlias: 'growth_hacker_jen',
    contentExcerpt:
      'Tired of cold outreach follow up tracking taking too long. Leads are constantly slipping through the cracks because we rely on manual spreadsheets.',
    sourcePermalink: 'https://linkedin.com/posts/growth-jen_cold-outreach-crm-activity-770005',
    timestamp: '2026-10-11T11:20:00.000Z',
    matchedKeywords: ['cold outreach', 'follow up email', 'leads slipping through the cracks'],
    sourceProvenance: 'DEMO',
  },
  {
    id: 'conv-demo-006',
    platform: 'twitter',
    authorAlias: 'saas_rep_leo',
    contentExcerpt:
      'Looking for a cold outreach tool with automated follow up sequences. What do B2B sales development reps recommend right now?',
    sourcePermalink: 'https://twitter.com/saas_rep_leo/status/1900000000000006',
    timestamp: '2026-10-12T18:00:00.000Z',
    matchedKeywords: ['cold outreach', 'sales automation', 'follow up'],
    sourceProvenance: 'DEMO',
  },
  {
    id: 'conv-demo-007',
    platform: 'reddit',
    authorAlias: 'workflow_guru_alex',
    contentExcerpt:
      'How to automate podcast transcription without sacrificing accuracy? Audio transcription takes too long when doing interviews with guests.',
    sourcePermalink:
      'https://reddit.com/r/podcasting/comments/abc107/how_to_automate_podcast_transcription',
    timestamp: '2026-10-14T10:30:00.000Z',
    matchedKeywords: ['automate podcast transcription', 'audio transcription takes too long'],
    sourceProvenance: 'DEMO',
  },
  {
    id: 'conv-demo-008',
    platform: 'hackernews',
    authorAlias: 'devops_lead_carl',
    contentExcerpt:
      'Credential sharing across remote engineering teams is painful. Plaintext passwords in Slack keep causing security headaches.',
    sourcePermalink: 'https://news.ycombinator.com/item?id=9900008',
    timestamp: '2026-10-10T12:00:00.000Z',
    matchedKeywords: ['credential sync', 'password manager'],
    sourceProvenance: 'DEMO',
  },
  {
    id: 'conv-demo-009',
    platform: 'reddit',
    authorAlias: 'legal_paralegal_pat',
    contentExcerpt:
      'We have thousands of unsearchable scanned PDFs. Cant search scans easily and need an OCR document indexer.',
    sourcePermalink:
      'https://reddit.com/r/legaltech/comments/abc109/unsearchable_scanned_pdf_indexing',
    timestamp: '2026-10-09T15:10:00.000Z',
    matchedKeywords: ['pdf search', 'ocr', 'unsearchable pdfs'],
    sourceProvenance: 'DEMO',
  },
  // --- Negative fixtures containing excluded topics to test filtering ---
  {
    id: 'conv-demo-010',
    platform: 'reddit',
    authorAlias: 'crypto_trader_bob',
    contentExcerpt:
      'Best cryptocurrency podcast transcription software for tracking DeFi alpha and meme coin discussions daily.',
    sourcePermalink:
      'https://reddit.com/r/cryptocurrency/comments/abc110/crypto_podcast_transcription',
    timestamp: '2026-10-13T20:00:00.000Z',
    matchedKeywords: ['podcast transcription', 'cryptocurrency'],
    sourceProvenance: 'DEMO',
  },
  {
    id: 'conv-demo-011',
    platform: 'twitter',
    authorAlias: 'political_pundit_tim',
    contentExcerpt:
      'Our political commentary podcast needs an audiogram clip generator for heated election debates.',
    sourcePermalink: 'https://twitter.com/political_tim/status/1900000000000011',
    timestamp: '2026-10-14T12:00:00.000Z',
    matchedKeywords: ['audiogram', 'clip generator', 'political commentary'],
    sourceProvenance: 'DEMO',
  },
  {
    id: 'conv-demo-012',
    platform: 'reddit',
    authorAlias: 'mass_spammer_bot',
    contentExcerpt:
      'How to mass spamming 50,000 cold outreach emails a day without getting domain blacklisted immediately?',
    sourcePermalink: 'https://reddit.com/r/blackhat/comments/abc112/mass_spamming_cold_outreach',
    timestamp: '2026-10-13T22:30:00.000Z',
    matchedKeywords: ['cold outreach', 'mass spamming'],
    sourceProvenance: 'DEMO',
  },
];
