import { z } from 'zod';

/**
 * Validates a non-blank string (rejects empty or whitespace-only strings).
 */
export const nonBlankString = (fieldName: string) =>
  z.string().trim().min(1, `${fieldName} cannot be blank or empty`);

/**
 * Schema for a product profile and ideal customer profile (ICP).
 * Extended in Phase 2 to support search setup (seed keywords and pain-point phrases),
 * while maintaining 100% backward compatibility with Phase 1 data.
 */
export const ProductProfileSchema = z.object({
  id: nonBlankString('Profile ID'),
  productName: nonBlankString('Product name'),
  valueProposition: nonBlankString('Value proposition'),
  productDescription: nonBlankString('Product description').optional(),
  problemsSolved: z
    .array(nonBlankString('Problem solved item'))
    .min(1, 'At least one problem solved must be specified'),
  idealCustomerDescription: nonBlankString('Ideal customer description'),
  seedKeywords: z.array(nonBlankString('Seed keyword item')).default([]),
  customerPainPointPhrases: z.array(nonBlankString('Customer pain point phrase item')).default([]),
  excludedTopics: z.array(nonBlankString('Excluded topic item')).default([]),
  toneGuidelines: z
    .array(nonBlankString('Tone guideline item'))
    .min(1, 'At least one tone guideline must be specified'),
  createdAt: z.string().datetime({ message: 'createdAt must be a valid ISO 8601 timestamp' }),
  updatedAt: z.string().datetime({ message: 'updatedAt must be a valid ISO 8601 timestamp' }),
});

export type ProductProfile = z.infer<typeof ProductProfileSchema>;

/**
 * Input schema for creating a new product profile.
 * ID and timestamps are automatically managed if omitted.
 */
export const CreateProductProfileInputSchema = z
  .object({
    id: nonBlankString('Profile ID').optional(),
    productName: nonBlankString('Product name'),
    valueProposition: nonBlankString('Value proposition').optional(),
    productDescription: nonBlankString('Product description').optional(),
    problemsSolved: z
      .array(nonBlankString('Problem solved item'))
      .min(1, 'At least one problem solved must be specified'),
    idealCustomerDescription: nonBlankString('Ideal customer description'),
    seedKeywords: z.array(nonBlankString('Seed keyword item')).default([]),
    customerPainPointPhrases: z
      .array(nonBlankString('Customer pain point phrase item'))
      .default([]),
    excludedTopics: z.array(nonBlankString('Excluded topic item')).default([]),
    toneGuidelines: z
      .array(nonBlankString('Tone guideline item'))
      .min(1, 'At least one tone guideline must be specified'),
  })
  .refine((data) => Boolean(data.valueProposition || data.productDescription), {
    message: 'Either valueProposition or productDescription must be specified',
    path: ['valueProposition'],
  });

export type CreateProductProfileInput = z.infer<typeof CreateProductProfileInputSchema>;

/**
 * Input schema for updating an existing product profile.
 */
export const UpdateProductProfileInputSchema = z.object({
  productName: nonBlankString('Product name').optional(),
  valueProposition: nonBlankString('Value proposition').optional(),
  productDescription: nonBlankString('Product description').optional(),
  problemsSolved: z
    .array(nonBlankString('Problem solved item'))
    .min(1, 'At least one problem solved must be specified')
    .optional(),
  idealCustomerDescription: nonBlankString('Ideal customer description').optional(),
  seedKeywords: z.array(nonBlankString('Seed keyword item')).optional(),
  customerPainPointPhrases: z.array(nonBlankString('Customer pain point phrase item')).optional(),
  excludedTopics: z.array(nonBlankString('Excluded topic item')).optional(),
  toneGuidelines: z
    .array(nonBlankString('Tone guideline item'))
    .min(1, 'At least one tone guideline must be specified')
    .optional(),
});

export type UpdateProductProfileInput = z.infer<typeof UpdateProductProfileInputSchema>;
