import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProfileService, ProfileValidationError, ProfileNotFoundError } from './profile-service.js';
import { InMemoryProfileRepository, FileProfileRepository } from '../storage/profile-repository.js';
import { ProductProfile } from '../contracts/profile.js';

describe('ProfileService', () => {
  let inMemoryRepo: InMemoryProfileRepository;
  let service: ProfileService;

  const validProfileInput = {
    productName: 'LeadPulse CRM',
    valueProposition: 'Automates cold outreach follow-ups for B2B sales development reps.',
    problemsSolved: [
      'Forgetting to follow up with hot prospects',
      'Hours spent logging CRM updates manually',
    ],
    idealCustomerDescription: 'B2B SaaS sales teams and agency founders.',
    seedKeywords: ['cold outreach', 'follow up email', 'sales automation'],
    customerPainPointPhrases: [
      'leads slipping through the cracks',
      'follow up tracking takes too long',
    ],
    excludedTopics: ['crypto', 'mlm schemes', 'mass spamming'],
    toneGuidelines: ['Professional', 'Value-oriented', 'Helpful'],
  };

  beforeEach(() => {
    inMemoryRepo = new InMemoryProfileRepository();
    service = new ProfileService(inMemoryRepo);
  });

  describe('Profile Creation', () => {
    it('creates a profile with auto-generated id and timestamps', async () => {
      const profile = await service.createProfile(validProfileInput);

      expect(profile.id).toBeDefined();
      expect(profile.id.startsWith('prof-')).toBe(true);
      expect(profile.productName).toBe('LeadPulse CRM');
      expect(profile.productDescription).toBe(validProfileInput.valueProposition);
      expect(profile.seedKeywords).toEqual(validProfileInput.seedKeywords);
      expect(profile.customerPainPointPhrases).toEqual(validProfileInput.customerPainPointPhrases);
      expect(profile.createdAt).toBeDefined();
      expect(profile.updatedAt).toBe(profile.createdAt);
    });

    it('creates a profile preserving a user-provided id', async () => {
      const profile = await service.createProfile({
        ...validProfileInput,
        id: 'prof-custom-123',
      });
      expect(profile.id).toBe('prof-custom-123');
    });

    it('creates a profile with productDescription when valueProposition is omitted', async () => {
      const { valueProposition: _, ...inputWithoutValueProp } = validProfileInput;
      const profile = await service.createProfile({
        ...inputWithoutValueProp,
        productDescription: 'Autonomous follow-up engine for deal closers',
      });
      expect(profile.productDescription).toBe('Autonomous follow-up engine for deal closers');
      expect(profile.valueProposition).toBe('Autonomous follow-up engine for deal closers');
    });

    it('defaults optional seedKeywords and customerPainPointPhrases to empty arrays', async () => {
      const { seedKeywords: _, customerPainPointPhrases: __, ...minimalInput } = validProfileInput;
      const profile = await service.createProfile(minimalInput);

      expect(profile.seedKeywords).toEqual([]);
      expect(profile.customerPainPointPhrases).toEqual([]);
    });

    it('fails creation when required fields are missing or empty', async () => {
      await expect(
        service.createProfile({
          ...validProfileInput,
          productName: '   ',
        }),
      ).rejects.toThrow(ProfileValidationError);

      await expect(
        service.createProfile({
          ...validProfileInput,
          problemsSolved: [],
        }),
      ).rejects.toThrow(/At least one problem solved must be specified/);

      await expect(
        service.createProfile({
          ...validProfileInput,
          toneGuidelines: [],
        }),
      ).rejects.toThrow(/At least one tone guideline must be specified/);
    });

    it('fails creation when both valueProposition and productDescription are missing', async () => {
      const { valueProposition: _, ...missingBoth } = validProfileInput;
      await expect(service.createProfile(missingBoth)).rejects.toThrow(ProfileValidationError);
    });
  });

  describe('Profile Retrieval and Listing', () => {
    it('retrieves an existing profile by ID', async () => {
      const created = await service.createProfile(validProfileInput);
      const found = await service.getProfile(created.id);

      expect(found).toEqual(created);
    });

    it('throws ProfileNotFoundError when getting a nonexistent profile', async () => {
      await expect(service.getProfile('nonexistent-id')).rejects.toThrow(ProfileNotFoundError);
    });

    it('findProfile returns null when not found', async () => {
      const result = await service.findProfile('nonexistent-id');
      expect(result).toBeNull();
    });

    it('lists all profiles', async () => {
      await service.createProfile(validProfileInput);
      await service.createProfile({
        ...validProfileInput,
        productName: 'Second Product',
      });

      const list = await service.listProfiles();
      expect(list.length).toBe(2);
    });
  });

  describe('Profile Updates', () => {
    it('updates specific fields of an existing profile', async () => {
      const created = await service.createProfile(validProfileInput);
      const updated = await service.updateProfile(created.id, {
        productName: 'LeadPulse CRM Pro',
        seedKeywords: ['ai follow up', 'sales engagement'],
      });

      expect(updated.productName).toBe('LeadPulse CRM Pro');
      expect(updated.seedKeywords).toEqual(['ai follow up', 'sales engagement']);
      expect(updated.problemsSolved).toEqual(created.problemsSolved); // preserved
      expect(updated.createdAt).toBe(created.createdAt); // immutable
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(created.updatedAt).getTime(),
      );
    });

    it('throws ProfileNotFoundError when updating nonexistent ID', async () => {
      await expect(
        service.updateProfile('unknown-id', { productName: 'New Name' }),
      ).rejects.toThrow(ProfileNotFoundError);
    });

    it('rejects update with invalid field values', async () => {
      const created = await service.createProfile(validProfileInput);
      await expect(
        service.updateProfile(created.id, {
          productName: '   ',
        }),
      ).rejects.toThrow(ProfileValidationError);

      await expect(
        service.updateProfile(created.id, {
          problemsSolved: [],
        }),
      ).rejects.toThrow(ProfileValidationError);
    });
  });

  describe('Profile Deletion', () => {
    it('deletes an existing profile and confirms removal', async () => {
      const created = await service.createProfile(validProfileInput);
      const deleted = await service.deleteProfile(created.id);
      expect(deleted).toBe(true);

      const found = await service.findProfile(created.id);
      expect(found).toBeNull();
    });

    it('returns false when deleting nonexistent profile', async () => {
      const deleted = await service.deleteProfile('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('Validation Method (Non-throwing)', () => {
    it('returns isValid: true for well-formed profiles', () => {
      const fullProfile: ProductProfile = {
        id: 'prof-valid-1',
        productName: 'DocuFlow',
        valueProposition: 'Fast PDF indexing',
        problemsSolved: ['Unsearchable PDFs'],
        idealCustomerDescription: 'Legal paralegals',
        seedKeywords: ['pdf search', 'ocr'],
        customerPainPointPhrases: ['cant search scans'],
        excludedTopics: ['pirated books'],
        toneGuidelines: ['Direct'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = service.validateProfile(fullProfile);
      expect(result.isValid).toBe(true);
      expect(result.profile).toEqual(fullProfile);
      expect(result.errors).toBeUndefined();
    });

    it('returns isValid: false with descriptive errors for empty or invalid profiles', () => {
      const emptyResult = service.validateProfile({});
      expect(emptyResult.isValid).toBe(false);
      expect(emptyResult.errors).toBeDefined();
      expect(emptyResult.errors!.length).toBeGreaterThan(0);

      const invalidResult = service.validateProfile({
        productName: 'Test',
        valueProposition: '   ',
      });
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors!.some((e) => e.includes('Value proposition'))).toBe(true);
    });
  });

  describe('Phase 1 Contract Compatibility', () => {
    it('accepts and validates Phase 1 profiles without Phase 2 fields', async () => {
      const phase1Record = {
        id: 'prof-phase1-001',
        productName: 'AudioClipper',
        valueProposition: 'Automates clip generation for creators.',
        problemsSolved: ['Finding good clips takes hours'],
        idealCustomerDescription: 'Podcasters and YouTubers',
        excludedTopics: ['Politics'],
        toneGuidelines: ['Helpful', 'Concise'],
        createdAt: '2026-10-09T10:00:00.000Z',
        updatedAt: '2026-10-09T10:00:00.000Z',
      };

      // Direct validation
      const validation = service.validateProfile(phase1Record);
      expect(validation.isValid).toBe(true);
      expect(validation.profile?.seedKeywords).toEqual([]);
      expect(validation.profile?.customerPainPointPhrases).toEqual([]);

      // Repository save and get
      await inMemoryRepo.save(phase1Record as ProductProfile);
      const retrieved = await service.getProfile('prof-phase1-001');
      expect(retrieved.productName).toBe('AudioClipper');
      expect(retrieved.seedKeywords).toEqual([]);
      expect(retrieved.customerPainPointPhrases).toEqual([]);
    });
  });
});

describe('FileProfileRepository (Chosen Storage Option)', () => {
  let tempDir: string;
  let tempFile: string;
  let fileRepo: FileProfileRepository;
  let service: ProfileService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cold-reach-test-'));
    tempFile = path.join(tempDir, 'profiles.json');
    fileRepo = new FileProfileRepository(tempFile);
    service = new ProfileService(fileRepo);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on windows locks
    }
  });

  it('persists profiles to disk and reloads across new repository instances', async () => {
    const created = await service.createProfile({
      id: 'prof-persisted-1',
      productName: 'SyncVault',
      valueProposition: 'Encrypted backup for team credentials',
      problemsSolved: ['Plaintext passwords in Slack'],
      idealCustomerDescription: 'DevOps leads at startups',
      seedKeywords: ['password manager', 'credential sync'],
      customerPainPointPhrases: ['sharing keys insecurely'],
      excludedTopics: ['password cracking'],
      toneGuidelines: ['Secure', 'Professional'],
    });

    // Verify file actually exists on filesystem
    const fileContent = await fs.readFile(tempFile, 'utf-8');
    expect(fileContent).toContain('SyncVault');

    // Instantiate a new repo pointing to the same file (simulates app restart)
    const newRepo = new FileProfileRepository(tempFile);
    const reloadedService = new ProfileService(newRepo);

    const retrieved = await reloadedService.getProfile('prof-persisted-1');
    expect(retrieved.id).toBe(created.id);
    expect(retrieved.productName).toBe('SyncVault');
    expect(retrieved.seedKeywords).toEqual(['password manager', 'credential sync']);
  });

  it('updates and persists modifications to the JSON file', async () => {
    await service.createProfile({
      id: 'prof-to-update',
      productName: 'BeforeUpdate',
      valueProposition: 'Initial value',
      problemsSolved: ['Problem 1'],
      idealCustomerDescription: 'Audience 1',
      toneGuidelines: ['Direct'],
    });

    await service.updateProfile('prof-to-update', {
      productName: 'AfterUpdate',
      seedKeywords: ['new keyword'],
    });

    const fileContent = await fs.readFile(tempFile, 'utf-8');
    expect(fileContent).toContain('AfterUpdate');
    expect(fileContent).not.toContain('BeforeUpdate');
  });

  it('deletes records from the file repository', async () => {
    await service.createProfile({
      id: 'prof-to-delete',
      productName: 'DeleteMe',
      valueProposition: 'Temp',
      problemsSolved: ['Temp problem'],
      idealCustomerDescription: 'Temp audience',
      toneGuidelines: ['Direct'],
    });

    const deleted = await service.deleteProfile('prof-to-delete');
    expect(deleted).toBe(true);

    const reloaded = new FileProfileRepository(tempFile);
    const found = await reloaded.findById('prof-to-delete');
    expect(found).toBeNull();
  });

  it('handles empty or newly initialized files gracefully', async () => {
    const emptyRepo = new FileProfileRepository(path.join(tempDir, 'empty.json'));
    const list = await emptyRepo.findAll();
    expect(list).toEqual([]);
  });
});
