import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ProductProfile, ProductProfileSchema } from '../contracts/profile.js';

/**
 * Storage interface for ProductProfile persistence.
 */
export interface ProfileRepository {
  findById(id: string): Promise<ProductProfile | null>;
  findAll(): Promise<ProductProfile[]>;
  save(profile: ProductProfile): Promise<ProductProfile>;
  update(id: string, updates: Partial<ProductProfile>): Promise<ProductProfile>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

/**
 * Lightweight in-memory implementation of ProfileRepository.
 * Ideal for unit testing, development, and ephemeral executions.
 */
export class InMemoryProfileRepository implements ProfileRepository {
  private readonly storage = new Map<string, ProductProfile>();

  constructor(initialProfiles: ProductProfile[] = []) {
    for (const profile of initialProfiles) {
      this.storage.set(profile.id, structuredClone(profile));
    }
  }

  async findById(id: string): Promise<ProductProfile | null> {
    const item = this.storage.get(id);
    return item ? structuredClone(item) : null;
  }

  async findAll(): Promise<ProductProfile[]> {
    return Array.from(this.storage.values()).map((p) => structuredClone(p));
  }

  async save(profile: ProductProfile): Promise<ProductProfile> {
    const validated = ProductProfileSchema.parse(profile);
    this.storage.set(validated.id, structuredClone(validated));
    return structuredClone(validated);
  }

  async update(id: string, updates: Partial<ProductProfile>): Promise<ProductProfile> {
    const existing = this.storage.get(id);
    if (!existing) {
      throw new Error(`Profile with ID "${id}" does not exist in repository.`);
    }

    const merged = {
      ...existing,
      ...updates,
      id, // Preserve ID
      updatedAt: updates.updatedAt ?? new Date().toISOString(),
    };

    const validated = ProductProfileSchema.parse(merged);
    this.storage.set(id, structuredClone(validated));
    return structuredClone(validated);
  }

  async delete(id: string): Promise<boolean> {
    return this.storage.delete(id);
  }

  async clear(): Promise<void> {
    this.storage.clear();
  }
}

async function safeAtomicRename(tempFile: string, targetFile: string): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      await fs.rename(tempFile, targetFile);
      return;
    } catch (err: unknown) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EBUSY') {
        await new Promise((res) => setTimeout(res, 30 * (i + 1)));
      } else {
        throw err;
      }
    }
  }
  try {
    await fs.copyFile(tempFile, targetFile);
    await fs.unlink(tempFile).catch(() => {});
  } catch {
    throw lastErr;
  }
}

/**
 * JSON File-backed implementation of ProfileRepository.
 *
 * Persistence Choice Documented:
 * For a standalone domain core, local JSON file storage is the smallest appropriate persistence
 * approach. It requires zero external databases (like Postgres, Redis, or Mongo), no daemon
 * services, and relies entirely on Node's native fs/promises. Atomic writes (write-and-rename)
 * guarantee file integrity against unexpected process terminations.
 */
export class FileProfileRepository implements ProfileRepository {
  private readonly filePath: string;
  private readonly dirPath: string;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
    this.dirPath = path.dirname(this.filePath);
  }

  private async ensureInitialized(): Promise<void> {
    await fs.mkdir(this.dirPath, { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      // File does not exist yet; initialize with empty dictionary
      await this.writeRecordMap({});
    }
  }

  private async readRecordMap(): Promise<Record<string, ProductProfile>> {
    await this.ensureInitialized();
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      if (!content.trim()) {
        return {};
      }
      const raw = JSON.parse(content);
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return {};
      }
      const map: Record<string, ProductProfile> = {};
      for (const [key, val] of Object.entries(raw)) {
        try {
          map[key] = ProductProfileSchema.parse(val);
        } catch {
          // Skip invalid entries during load
        }
      }
      return map;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw err;
    }
  }

  private async writeRecordMap(map: Record<string, ProductProfile>): Promise<void> {
    await fs.mkdir(this.dirPath, { recursive: true });
    const content = JSON.stringify(map, null, 2);
    // Write atomically using temporary file in same directory
    const tempFile = path.join(
      this.dirPath,
      `.tmp-${path.basename(this.filePath)}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.writeFile(tempFile, content, 'utf-8');
    await safeAtomicRename(tempFile, this.filePath);
  }

  async findById(id: string): Promise<ProductProfile | null> {
    const map = await this.readRecordMap();
    const item = map[id];
    return item ? structuredClone(item) : null;
  }

  async findAll(): Promise<ProductProfile[]> {
    const map = await this.readRecordMap();
    return Object.values(map).map((p) => structuredClone(p));
  }

  async save(profile: ProductProfile): Promise<ProductProfile> {
    const validated = ProductProfileSchema.parse(profile);
    const map = await this.readRecordMap();
    map[validated.id] = validated;
    await this.writeRecordMap(map);
    return structuredClone(validated);
  }

  async update(id: string, updates: Partial<ProductProfile>): Promise<ProductProfile> {
    const map = await this.readRecordMap();
    const existing = map[id];
    if (!existing) {
      throw new Error(`Profile with ID "${id}" does not exist in file repository.`);
    }

    const merged = {
      ...existing,
      ...updates,
      id,
      updatedAt: updates.updatedAt ?? new Date().toISOString(),
    };

    const validated = ProductProfileSchema.parse(merged);
    map[id] = validated;
    await this.writeRecordMap(map);
    return structuredClone(validated);
  }

  async delete(id: string): Promise<boolean> {
    const map = await this.readRecordMap();
    if (!(id in map)) {
      return false;
    }
    delete map[id];
    await this.writeRecordMap(map);
    return true;
  }

  async clear(): Promise<void> {
    await this.writeRecordMap({});
  }
}
