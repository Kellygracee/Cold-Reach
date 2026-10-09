import { z } from 'zod';

/**
 * Validates a non-blank string (rejects empty or whitespace-only strings).
 */
export const nonBlankString = (fieldName: string) =>
  z.string().trim().min(1, `${fieldName} cannot be blank or empty`);

/**
 * Schema for a product profile and ideal customer profile (ICP).
 */
export const ProductProfileSchema = z.object({
  id: nonBlankString('Profile ID'),
  productName: nonBlankString('Product name'),
  valueProposition: nonBlankString('Value proposition'),
  problemsSolved: z
    .array(nonBlankString('Problem solved item'))
    .min(1, 'At least one problem solved must be specified'),
  idealCustomerDescription: nonBlankString('Ideal customer description'),
  excludedTopics: z.array(nonBlankString('Excluded topic item')).default([]),
  toneGuidelines: z
    .array(nonBlankString('Tone guideline item'))
    .min(1, 'At least one tone guideline must be specified'),
  createdAt: z.string().datetime({ message: 'createdAt must be a valid ISO 8601 timestamp' }),
  updatedAt: z.string().datetime({ message: 'updatedAt must be a valid ISO 8601 timestamp' }),
});

export type ProductProfile = z.infer<typeof ProductProfileSchema>;
