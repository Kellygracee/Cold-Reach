import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SourceProvenance } from '../contracts/conversation.js';
import { Opportunity, OpportunitySchema, OpportunityStatus } from '../contracts/opportunity.js';
import { AuditImmutabilityError } from '../contracts/pipeline.js';

export interface OpportunityFilter {
  status?: OpportunityStatus | OpportunityStatus[];
  minScore?: number;
  maxScore?: number;
  platform?: string | string[];
  provenance?: SourceProvenance | SourceProvenance[];
  startDate?: string;
  endDate?: string;
  dateField?: 'createdAt' | 'updatedAt' | 'markedSentAt';
  search?: string;
}

/**
 * Storage interface for Opportunity persistence and deduplication.
 */
export interface OpportunityRepository {
  findById(id: string): Promise<Opportunity | null>;
  findByConversationId(conversationId: string): Promise<Opportunity | null>;
  findByPermalink(permalink: string): Promise<Opportunity | null>;
  findAll(filter?: OpportunityFilter): Promise<Opportunity[]>;
  save(opportunity: Opportunity): Promise<Opportunity>;
  update(id: string, updates: Partial<Opportunity>): Promise<Opportunity>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

function matchesOpportunityFilter(opp: Opportunity, filter?: OpportunityFilter): boolean {
  if (!filter) return true;

  // Status filter (single or array)
  if (filter.status !== undefined) {
    if (Array.isArray(filter.status)) {
      if (!filter.status.includes(opp.status)) return false;
    } else if (opp.status !== filter.status) {
      return false;
    }
  }

  // Relevance range
  if (filter.minScore !== undefined && opp.relevanceScore < filter.minScore) {
    return false;
  }
  if (filter.maxScore !== undefined && opp.relevanceScore > filter.maxScore) {
    return false;
  }

  // Platform (case-insensitive substring or exact match)
  if (filter.platform !== undefined) {
    const oppPlatform = opp.conversation.platform.toLowerCase();
    if (Array.isArray(filter.platform)) {
      const targetPlatforms = filter.platform.map((p) => p.toLowerCase());
      if (!targetPlatforms.some((tp) => oppPlatform.includes(tp))) return false;
    } else {
      if (!oppPlatform.includes(filter.platform.toLowerCase())) return false;
    }
  }

  // Provenance (DEMO or LIVE)
  if (filter.provenance !== undefined) {
    if (Array.isArray(filter.provenance)) {
      if (!filter.provenance.includes(opp.conversation.sourceProvenance)) return false;
    } else if (opp.conversation.sourceProvenance !== filter.provenance) {
      return false;
    }
  }

  // Date range
  if (filter.startDate || filter.endDate) {
    const field = filter.dateField ?? 'createdAt';
    let targetDateStr: string | undefined;
    if (field === 'markedSentAt') {
      targetDateStr = opp.manualResponseAudit?.markedSentAt;
    } else if (field === 'updatedAt') {
      targetDateStr = opp.updatedAt;
    } else {
      targetDateStr = opp.createdAt;
    }

    if (!targetDateStr) return false;
    const targetTime = new Date(targetDateStr).getTime();

    if (filter.startDate) {
      const startTime = new Date(filter.startDate).getTime();
      if (targetTime < startTime) return false;
    }

    if (filter.endDate) {
      const endTime = new Date(filter.endDate).getTime();
      if (targetTime > endTime) return false;
    }
  }

  // Free text search across contentExcerpt, authorAlias, or matchedKeywords
  if (filter.search) {
    const q = filter.search.toLowerCase().trim();
    const excerpt = opp.conversation.contentExcerpt.toLowerCase();
    const author = opp.conversation.authorAlias.toLowerCase();
    const keywords = (opp.conversation.matchedKeywords ?? []).map((k) => k.toLowerCase());
    const matchesText =
      excerpt.includes(q) || author.includes(q) || keywords.some((k) => k.includes(q));
    if (!matchesText) return false;
  }

  return true;
}

function assertUpdateAuditImmutable(
  id: string,
  existing: Opportunity,
  updates: Partial<Opportunity>,
): void {
  // If already RESPONDED, cannot transition away from RESPONDED
  if (existing.status === 'RESPONDED' && updates.status && updates.status !== 'RESPONDED') {
    throw new AuditImmutabilityError(
      `Cannot transition opportunity "${id}" away from RESPONDED. Audit records are immutable.`,
    );
  }

  // If manualResponseAudit exists, cannot alter core audit fields
  if (existing.manualResponseAudit && updates.manualResponseAudit) {
    const ex = existing.manualResponseAudit;
    const up = updates.manualResponseAudit;
    if (
      ex.markedSentAt !== up.markedSentAt ||
      ex.dispatchMethod !== up.dispatchMethod ||
      ex.manualDispatchConfirmed !== up.manualDispatchConfirmed
    ) {
      throw new AuditImmutabilityError(
        `Cannot modify manualResponseAudit record on opportunity "${id}". Audit records are strictly immutable.`,
      );
    }
  }
}

/**
 * In-memory repository for Opportunity storage and deduplication.
 */
export class InMemoryOpportunityRepository implements OpportunityRepository {
  private readonly storage = new Map<string, Opportunity>();

  constructor(initialOpportunities: Opportunity[] = []) {
    for (const opp of initialOpportunities) {
      this.storage.set(opp.id, structuredClone(opp));
    }
  }

  async findById(id: string): Promise<Opportunity | null> {
    const opp = this.storage.get(id);
    return opp ? structuredClone(opp) : null;
  }

  async findByConversationId(conversationId: string): Promise<Opportunity | null> {
    for (const opp of this.storage.values()) {
      if (opp.conversation.id === conversationId) {
        return structuredClone(opp);
      }
    }
    return null;
  }

  async findByPermalink(permalink: string): Promise<Opportunity | null> {
    for (const opp of this.storage.values()) {
      if (opp.conversation.sourcePermalink === permalink) {
        return structuredClone(opp);
      }
    }
    return null;
  }

  async findAll(filter?: OpportunityFilter): Promise<Opportunity[]> {
    const list = Array.from(this.storage.values()).map((o) => structuredClone(o));
    return list.filter((opp) => matchesOpportunityFilter(opp, filter));
  }

  async save(opportunity: Opportunity): Promise<Opportunity> {
    const validated = OpportunitySchema.parse(opportunity);
    this.storage.set(validated.id, structuredClone(validated));
    return structuredClone(validated);
  }

  async update(id: string, updates: Partial<Opportunity>): Promise<Opportunity> {
    const existing = this.storage.get(id);
    if (!existing) {
      throw new Error(`Opportunity with ID "${id}" does not exist in repository.`);
    }

    assertUpdateAuditImmutable(id, existing, updates);

    const merged = {
      ...existing,
      ...updates,
      id,
      updatedAt: updates.updatedAt ?? new Date().toISOString(),
    };

    const validated = OpportunitySchema.parse(merged);
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
 * JSON file-backed Opportunity repository with atomic write-and-rename guarantees.
 */
export class FileOpportunityRepository implements OpportunityRepository {
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
      await this.writeRecordMap({});
    }
  }

  private async readRecordMap(): Promise<Record<string, Opportunity>> {
    await this.ensureInitialized();
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      if (!content.trim()) return {};
      const raw = JSON.parse(content);
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};

      const map: Record<string, Opportunity> = {};
      for (const [key, val] of Object.entries(raw)) {
        try {
          map[key] = OpportunitySchema.parse(val);
        } catch {
          // Skip invalid entries during load
        }
      }
      return map;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  private async writeRecordMap(map: Record<string, Opportunity>): Promise<void> {
    await fs.mkdir(this.dirPath, { recursive: true });
    const content = JSON.stringify(map, null, 2);
    const tempFile = path.join(
      this.dirPath,
      `.tmp-${path.basename(this.filePath)}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.writeFile(tempFile, content, 'utf-8');
    await safeAtomicRename(tempFile, this.filePath);
  }

  async findById(id: string): Promise<Opportunity | null> {
    const map = await this.readRecordMap();
    const item = map[id];
    return item ? structuredClone(item) : null;
  }

  async findByConversationId(conversationId: string): Promise<Opportunity | null> {
    const map = await this.readRecordMap();
    for (const item of Object.values(map)) {
      if (item.conversation.id === conversationId) {
        return structuredClone(item);
      }
    }
    return null;
  }

  async findByPermalink(permalink: string): Promise<Opportunity | null> {
    const map = await this.readRecordMap();
    for (const item of Object.values(map)) {
      if (item.conversation.sourcePermalink === permalink) {
        return structuredClone(item);
      }
    }
    return null;
  }

  async findAll(filter?: OpportunityFilter): Promise<Opportunity[]> {
    const map = await this.readRecordMap();
    const list = Object.values(map).map((o) => structuredClone(o));
    return list.filter((opp) => matchesOpportunityFilter(opp, filter));
  }

  async save(opportunity: Opportunity): Promise<Opportunity> {
    const validated = OpportunitySchema.parse(opportunity);
    const map = await this.readRecordMap();
    map[validated.id] = validated;
    await this.writeRecordMap(map);
    return structuredClone(validated);
  }

  async update(id: string, updates: Partial<Opportunity>): Promise<Opportunity> {
    const map = await this.readRecordMap();
    const existing = map[id];
    if (!existing) {
      throw new Error(`Opportunity with ID "${id}" does not exist in file repository.`);
    }

    assertUpdateAuditImmutable(id, existing, updates);

    const merged = {
      ...existing,
      ...updates,
      id,
      updatedAt: updates.updatedAt ?? new Date().toISOString(),
    };

    const validated = OpportunitySchema.parse(merged);
    map[id] = validated;
    await this.writeRecordMap(map);
    return structuredClone(validated);
  }

  async delete(id: string): Promise<boolean> {
    const map = await this.readRecordMap();
    if (!(id in map)) return false;
    delete map[id];
    await this.writeRecordMap(map);
    return true;
  }

  async clear(): Promise<void> {
    await this.writeRecordMap({});
  }
}
