import { z } from 'zod';
import { nonBlankString } from './profile.js';

export const SourceProvenanceEnum = z.enum(['DEMO', 'LIVE'], {
  errorMap: () => ({ message: 'Source provenance must be explicitly DEMO or LIVE' }),
});

export type SourceProvenance = z.infer<typeof SourceProvenanceEnum>;

export const ValidUrlSchema = z
  .string()
  .trim()
  .url({ message: 'Source permalink must be a valid URL' })
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Source permalink must use http or https protocol' },
  );

export const ConversationItemSchema = z.object({
  id: nonBlankString('Conversation ID'),
  platform: nonBlankString('Platform identifier'),
  authorAlias: nonBlankString('Author alias'),
  contentExcerpt: nonBlankString('Content excerpt'),
  sourcePermalink: ValidUrlSchema,
  timestamp: z.string().datetime({ message: 'Timestamp must be a valid ISO 8601 format' }),
  matchedKeywords: z
    .array(nonBlankString('Matched keyword'))
    .min(1, 'At least one matched keyword is required'),
  sourceProvenance: SourceProvenanceEnum,
});

export type ConversationItem = z.infer<typeof ConversationItemSchema>;
