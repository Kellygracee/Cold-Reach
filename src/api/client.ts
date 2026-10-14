import {
  ConversationItem,
  ConversationSearchResult,
  CopyDraftResult,
  CreateProductProfileInput,
  DraftReply,
  ManualResponseAudit,
  Opportunity,
  OpportunityReviewData,
  OpportunityStatus,
  PipelineMetrics,
  PipelineMetricsFilter,
  ProductProfile,
  QueryExpansionResult,
  StatusHistoryEntry,
  UpdateProductProfileInput,
} from '../index.js';
import { ApiErrorResponse, ApiResponse, PaginatedResult } from './types.js';

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly details?: unknown;
  public readonly status: number;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class ColdReachApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options?: ApiClientOptions) {
    this.baseUrl = (options?.baseUrl ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
    this.fetchFn = options?.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(
    endpoint: string,
    options?: {
      method?: string;
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
    },
  ): Promise<T> {
    let url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    if (options?.query) {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined) {
          searchParams.append(k, String(v));
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        url += (url.includes('?') ? '&' : '?') + qs;
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    let bodyPayload: string | undefined;
    if (options?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyPayload = JSON.stringify(options.body);
    }

    const res = await this.fetchFn(url, {
      method: options?.method ?? 'GET',
      headers,
      body: bodyPayload,
    });

    const json = (await res.json()) as ApiResponse<T> | ApiErrorResponse;

    if (!res.ok || !json.success) {
      const errorObj =
        'error' in json
          ? json.error
          : { code: 'UNKNOWN_ERROR', message: res.statusText, details: undefined };
      throw new ApiClientError(
        errorObj.message || `Request failed with status ${res.status}`,
        errorObj.code || 'HTTP_ERROR',
        res.status,
        errorObj.details,
      );
    }

    return json.data;
  }

  // --- Profile Methods ---
  async listProfiles(): Promise<ProductProfile[]> {
    return this.request<ProductProfile[]>('/api/profiles');
  }

  async getProfile(id: string): Promise<ProductProfile> {
    return this.request<ProductProfile>(`/api/profiles/${encodeURIComponent(id)}`);
  }

  async createProfile(data: CreateProductProfileInput): Promise<ProductProfile> {
    return this.request<ProductProfile>('/api/profiles', { method: 'POST', body: data });
  }

  async updateProfile(id: string, data: UpdateProductProfileInput): Promise<ProductProfile> {
    return this.request<ProductProfile>(`/api/profiles/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: data,
    });
  }

  // --- Query Expansion & Providers ---
  async expandQuery(params: {
    profileId?: string;
    profile?: ProductProfile;
  }): Promise<QueryExpansionResult> {
    return this.request<QueryExpansionResult>('/api/query-expansion', {
      method: 'POST',
      body: params,
    });
  }

  async listProviders(): Promise<
    Array<{ id: string; name: string; state: string; provenance: string }>
  > {
    return this.request('/api/providers');
  }

  async searchConversations(params: {
    provider?: string;
    queryTerms?: string[];
    query?: string;
    excludedTopics?: string[];
    platform?: string;
    limit?: number;
    offset?: number;
  }): Promise<ConversationSearchResult> {
    return this.request<ConversationSearchResult>('/api/conversations/search', {
      method: 'POST',
      body: params,
    });
  }

  // --- Opportunities ---
  async listOpportunities(query?: {
    status?: string;
    minScore?: number;
    maxScore?: number;
    platform?: string;
    provenance?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResult<Opportunity>> {
    return this.request<PaginatedResult<Opportunity>>('/api/opportunities', { query });
  }

  async getOpportunity(id: string): Promise<Opportunity> {
    return this.request<Opportunity>(`/api/opportunities/${encodeURIComponent(id)}`);
  }

  async attributeOpportunity(params: {
    candidate: ConversationItem;
    profile?: ProductProfile;
    profileId?: string;
  }): Promise<Opportunity> {
    return this.request<Opportunity>('/api/opportunities/attribute', {
      method: 'POST',
      body: params,
    });
  }

  // --- Draft Operations ---
  async getDraft(opportunityId: string): Promise<DraftReply | null> {
    return this.request<DraftReply | null>(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/draft`,
    );
  }

  async generateDraft(
    opportunityId: string,
    params?: { allowLowScoreOverride?: boolean; profileId?: string; profile?: ProductProfile },
  ): Promise<DraftReply> {
    return this.request<DraftReply>(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/draft`,
      {
        method: 'POST',
        body: params ?? {},
      },
    );
  }

  async editDraft(
    opportunityId: string,
    params: { newText: string; changeSummary?: string },
  ): Promise<DraftReply> {
    return this.request<DraftReply>(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/draft`,
      {
        method: 'PUT',
        body: params,
      },
    );
  }

  async getReviewData(opportunityId: string): Promise<OpportunityReviewData> {
    return this.request<OpportunityReviewData>(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/review`,
    );
  }

  async getSourceLink(opportunityId: string): Promise<{ permalink: string }> {
    return this.request<{ permalink: string }>(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/source-link`,
    );
  }

  async copyDraft(
    opportunityId: string,
    options?: { includeTransparencyNote?: boolean },
  ): Promise<CopyDraftResult> {
    return this.request<CopyDraftResult>(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/copy`,
      { query: { includeTransparencyNote: options?.includeTransparencyNote } },
    );
  }

  // --- Pipeline, Status Transitions & Notes ---
  async transitionStatus(
    opportunityId: string,
    params: {
      toStatus: OpportunityStatus;
      reason?: string;
      userReviewNotes?: string;
      manualResponseAudit?: ManualResponseAudit;
    },
  ): Promise<Opportunity> {
    return this.request<Opportunity>(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/status`,
      {
        method: 'POST',
        body: params,
      },
    );
  }

  async recordManualResponse(
    opportunityId: string,
    params: {
      manualDispatchConfirmed: true;
      markedSentAt?: string;
      operatorNotes?: string;
      userReviewNotes?: string;
    },
  ): Promise<Opportunity> {
    return this.request<Opportunity>(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/respond`,
      {
        method: 'POST',
        body: params,
      },
    );
  }

  async updateReviewNotes(opportunityId: string, notes: string): Promise<Opportunity> {
    return this.request<Opportunity>(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/notes`,
      {
        method: 'PUT',
        body: { notes },
      },
    );
  }

  async getStatusHistory(opportunityId: string): Promise<StatusHistoryEntry[]> {
    return this.request<StatusHistoryEntry[]>(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/history`,
    );
  }

  async getPipelineMetrics(filter?: PipelineMetricsFilter): Promise<PipelineMetrics> {
    const query: Record<string, string | number | undefined> = {};
    if (filter?.status) {
      query.status = Array.isArray(filter.status) ? filter.status.join(',') : filter.status;
    }
    if (filter?.platform) {
      query.platform = Array.isArray(filter.platform) ? filter.platform.join(',') : filter.platform;
    }
    if (filter?.provenance) {
      query.provenance = Array.isArray(filter.provenance)
        ? filter.provenance.join(',')
        : filter.provenance;
    }
    if (filter?.relevanceRange?.min !== undefined) query.minScore = filter.relevanceRange.min;
    if (filter?.relevanceRange?.max !== undefined) query.maxScore = filter.relevanceRange.max;
    if (filter?.dateRange?.startDate) query.startDate = filter.dateRange.startDate;
    if (filter?.dateRange?.endDate) query.endDate = filter.dateRange.endDate;

    return this.request<PipelineMetrics>('/api/pipeline/metrics', { query });
  }

  async getOpenApiSpec(): Promise<unknown> {
    return this.request('/api/openapi.json');
  }
}
