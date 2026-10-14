import crypto from 'node:crypto';
import { z } from 'zod';
import {
  ProductProfile,
  ProductProfileSchema,
  CreateProductProfileInput,
  CreateProductProfileInputSchema,
  UpdateProductProfileInput,
  UpdateProductProfileInputSchema,
} from '../contracts/profile.js';
import { InMemoryProfileRepository, ProfileRepository } from '../storage/profile-repository.js';

export class ProfileValidationError extends Error {
  public readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[] = []) {
    super(message);
    this.name = 'ProfileValidationError';
    this.issues = issues;
  }
}

export class ProfileNotFoundError extends Error {
  constructor(id: string) {
    super(`ProductProfile with ID "${id}" was not found.`);
    this.name = 'ProfileNotFoundError';
  }
}

export interface ProfileValidationResult {
  isValid: boolean;
  profile?: ProductProfile;
  errors?: string[];
}

/**
 * Service to create, read, update, and validate ProductProfile records.
 */
export class ProfileService {
  private readonly repository: ProfileRepository;

  constructor(repository?: ProfileRepository) {
    this.repository = repository ?? new InMemoryProfileRepository();
  }

  /**
   * Validates a raw object against ProductProfileSchema without throwing.
   * Useful for UI forms, bulk imports, and empty/incomplete profile checks.
   */
  validateProfile(raw: unknown): ProfileValidationResult {
    const result = ProductProfileSchema.safeParse(raw);
    if (result.success) {
      return { isValid: true, profile: result.data };
    }
    return {
      isValid: false,
      errors: result.error.errors.map((e) => `${e.path.join('.') || 'root'}: ${e.message}`),
    };
  }

  /**
   * Creates a new ProductProfile, applying validation and automated metadata (ID, timestamps).
   */
  async createProfile(input: unknown): Promise<ProductProfile> {
    const parseResult = CreateProductProfileInputSchema.safeParse(input);
    if (!parseResult.success) {
      const messages = parseResult.error.errors.map(
        (e) => `${e.path.join('.') || 'root'}: ${e.message}`,
      );
      throw new ProfileValidationError(
        `Failed to create profile: ${messages.join('; ')}`,
        parseResult.error.issues,
      );
    }

    const data: CreateProductProfileInput = parseResult.data;
    const now = new Date().toISOString();

    const valueProp = data.valueProposition ?? data.productDescription!;
    const productDesc = data.productDescription ?? data.valueProposition!;

    const candidateProfile: ProductProfile = {
      id: data.id ?? `prof-${crypto.randomUUID()}`,
      productName: data.productName,
      valueProposition: valueProp,
      productDescription: productDesc,
      problemsSolved: data.problemsSolved,
      idealCustomerDescription: data.idealCustomerDescription,
      seedKeywords: data.seedKeywords,
      customerPainPointPhrases: data.customerPainPointPhrases,
      excludedTopics: data.excludedTopics,
      toneGuidelines: data.toneGuidelines,
      createdAt: now,
      updatedAt: now,
    };

    const finalParsed = ProductProfileSchema.safeParse(candidateProfile);
    if (!finalParsed.success) {
      throw new ProfileValidationError(
        'Validation failed for finalized profile record.',
        finalParsed.error.issues,
      );
    }

    return this.repository.save(finalParsed.data);
  }

  /**
   * Retrieves a ProductProfile by ID. Throws ProfileNotFoundError if missing.
   */
  async getProfile(id: string): Promise<ProductProfile> {
    const profile = await this.repository.findById(id);
    if (!profile) {
      throw new ProfileNotFoundError(id);
    }
    return profile;
  }

  /**
   * Finds a ProductProfile by ID, returning null if missing.
   */
  async findProfile(id: string): Promise<ProductProfile | null> {
    return this.repository.findById(id);
  }

  /**
   * Lists all stored ProductProfiles.
   */
  async listProfiles(): Promise<ProductProfile[]> {
    return this.repository.findAll();
  }

  /**
   * Updates an existing ProductProfile with partial updates.
   */
  async updateProfile(id: string, updates: unknown): Promise<ProductProfile> {
    const existing = await this.getProfile(id);

    const parseResult = UpdateProductProfileInputSchema.safeParse(updates);
    if (!parseResult.success) {
      const messages = parseResult.error.errors.map(
        (e) => `${e.path.join('.') || 'root'}: ${e.message}`,
      );
      throw new ProfileValidationError(
        `Failed to update profile "${id}": ${messages.join('; ')}`,
        parseResult.error.issues,
      );
    }

    const updateData: UpdateProductProfileInput = parseResult.data;
    const now = new Date().toISOString();

    const merged = {
      ...existing,
      ...updateData,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: now,
    };

    // If valueProposition was updated but productDescription was not, synchronize if needed
    if (updateData.valueProposition && !updateData.productDescription) {
      merged.productDescription = updateData.valueProposition;
    } else if (updateData.productDescription && !updateData.valueProposition) {
      merged.valueProposition = updateData.productDescription;
    }

    const finalParsed = ProductProfileSchema.safeParse(merged);
    if (!finalParsed.success) {
      throw new ProfileValidationError(
        `Profile "${id}" became invalid after merging updates.`,
        finalParsed.error.issues,
      );
    }

    return this.repository.update(id, finalParsed.data);
  }

  /**
   * Deletes a ProductProfile by ID.
   */
  async deleteProfile(id: string): Promise<boolean> {
    return this.repository.delete(id);
  }
}
