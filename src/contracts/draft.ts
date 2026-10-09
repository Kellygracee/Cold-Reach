import { z } from 'zod';
import { nonBlankString } from './profile.js';

export const RevisionHistoryItemSchema = z.object({
  id: nonBlankString('Revision ID'),
  editedAt: z
    .string()
    .datetime({ message: 'Revision editedAt must be a valid ISO 8601 timestamp' }),
  editedBy: z.literal('USER', {
    errorMap: () => ({ message: 'Revisions must be made by a human user (USER)' }),
  }),
  previousText: z.string(),
  newText: nonBlankString('New revision text'),
  changeSummary: z.string().trim().optional(),
});

export type RevisionHistoryItem = z.infer<typeof RevisionHistoryItemSchema>;

export const DraftReplySchema = z.object({
  id: nonBlankString('Draft ID'),
  replyText: nonBlankString('Reply text'),
  valueAngle: nonBlankString('Value angle'),
  transparencyNote: nonBlankString('Transparency note'),
  revisionHistory: z.array(RevisionHistoryItemSchema).default([]),
  createdAt: z.string().datetime({ message: 'Draft createdAt must be a valid ISO 8601 timestamp' }),
  updatedAt: z.string().datetime({ message: 'Draft updatedAt must be a valid ISO 8601 timestamp' }),
});

export type DraftReply = z.infer<typeof DraftReplySchema>;
