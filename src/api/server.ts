import http, { IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { ConversationSearchResult, SearchInput } from '../contracts/conversation-provider.js';
import { ConversationItem, SourceProvenance } from '../contracts/conversation.js';
import { DraftGenerationProvider } from '../contracts/draft-provider.js';
import { ManualResponseAudit, Opportunity, OpportunityStatus } from '../contracts/opportunity.js';
import { PipelineMetricsFilter } from '../contracts/pipeline.js';
import {
  CreateProductProfileInput,
  ProductProfile,
  UpdateProductProfileInput,
} from '../contracts/profile.js';
import { BlueskyProvider } from '../providers/bluesky-provider.js';
import { DefaultAiDraftProvider } from '../providers/default-ai-draft-provider.js';
import { DemoProvider } from '../providers/demo-provider.js';
import { HackerNewsProvider } from '../providers/hacker-news-provider.js';
import { RedditProvider } from '../providers/reddit-provider.js';
import { RssFeedProvider } from '../providers/rss-feed-provider.js';
import { OpportunityService } from '../services/opportunity-service.js';
import { PipelineService } from '../services/pipeline-service.js';
import { ProfileNotFoundError, ProfileService } from '../services/profile-service.js';
import { QueryExpansionEngine } from '../services/query-expansion.js';
import { ReplyDraftingService } from '../services/reply-drafting-service.js';
import {
  InMemoryOpportunityRepository,
  OpportunityRepository,
} from '../storage/opportunity-repository.js';
import { InMemoryProfileRepository, ProfileRepository } from '../storage/profile-repository.js';
import { OPENAPI_SPEC } from './openapi-spec.js';
import { Router } from './router.js';
import { PaginatedResult, PaginationMeta, RequestContext } from './types.js';

export interface ColdReachApiServerOptions {
  host?: string;
  port?: number;
  allowedOrigins?: string[];
  profileRepository?: ProfileRepository;
  opportunityRepository?: OpportunityRepository;
  profileService?: ProfileService;
  opportunityService?: OpportunityService;
  replyDraftingService?: ReplyDraftingService;
  pipelineService?: PipelineService;
  draftProvider?: DraftGenerationProvider;
  demoProvider?: DemoProvider;
  hackerNewsProvider?: HackerNewsProvider;
  blueskyProvider?: BlueskyProvider;
  redditProvider?: RedditProvider;
  rssProvider?: RssFeedProvider;
}

export class ColdReachApiServer {
  private server: http.Server | null = null;
  private readonly router: Router;
  private readonly host: string;
  private readonly port: number;

  // Domain Services
  public readonly profileRepository: ProfileRepository;
  public readonly opportunityRepository: OpportunityRepository;
  public readonly profileService: ProfileService;
  public readonly opportunityService: OpportunityService;
  public readonly replyDraftingService: ReplyDraftingService;
  public readonly pipelineService: PipelineService;

  // Search Providers
  public readonly demoProvider: DemoProvider;
  public readonly hackerNewsProvider: HackerNewsProvider;
  public readonly blueskyProvider: BlueskyProvider;
  public readonly redditProvider: RedditProvider;
  public readonly rssProvider: RssFeedProvider;
  public readonly draftProvider: DraftGenerationProvider;

  constructor(options?: ColdReachApiServerOptions) {
    this.host = options?.host ?? '127.0.0.1';
    this.port = options?.port ?? 3001;

    this.profileRepository = options?.profileRepository ?? new InMemoryProfileRepository();
    this.opportunityRepository =
      options?.opportunityRepository ?? new InMemoryOpportunityRepository();

    this.profileService = options?.profileService ?? new ProfileService(this.profileRepository);
    this.opportunityService =
      options?.opportunityService ?? new OpportunityService(this.opportunityRepository);
    this.pipelineService =
      options?.pipelineService ?? new PipelineService(this.opportunityRepository);

    this.draftProvider = options?.draftProvider ?? new DefaultAiDraftProvider();
    this.replyDraftingService =
      options?.replyDraftingService ??
      new ReplyDraftingService({
        opportunityRepository: this.opportunityRepository,
        profileRepository: this.profileRepository,
        provider: this.draftProvider,
      });

    this.demoProvider = options?.demoProvider ?? new DemoProvider();
    this.hackerNewsProvider = options?.hackerNewsProvider ?? new HackerNewsProvider();
    this.blueskyProvider = options?.blueskyProvider ?? new BlueskyProvider();
    this.redditProvider = options?.redditProvider ?? new RedditProvider();
    this.rssProvider = options?.rssProvider ?? new RssFeedProvider();

    this.router = new Router({ allowedOrigins: options?.allowedOrigins });
    this.registerRoutes();
  }

  private registerRoutes(): void {
    // 1. OpenAPI Specification Document
    this.router.get('/api/openapi.json', () => OPENAPI_SPEC);

    // 2. Product Profile Routes
    this.router.get('/api/profiles', async () => this.profileService.listProfiles());

    this.router.post('/api/profiles', async (ctx: RequestContext) => {
      ctx.res.statusCode = 201;
      return this.profileService.createProfile(ctx.body as CreateProductProfileInput);
    });

    this.router.get('/api/profiles/:id', async (ctx: RequestContext) =>
      this.profileService.getProfile(ctx.params.id!),
    );

    this.router.put('/api/profiles/:id', async (ctx: RequestContext) =>
      this.profileService.updateProfile(ctx.params.id!, ctx.body as UpdateProductProfileInput),
    );

    // 3. Query Expansion & Search Routes
    this.router.post('/api/query-expansion', async (ctx: RequestContext) => {
      const body = (ctx.body ?? {}) as { profileId?: string; profile?: ProductProfile };
      let profile: ProductProfile | null = body.profile ?? null;
      if (!profile && body.profileId) {
        profile = await this.profileService.getProfile(body.profileId);
      }
      if (!profile) {
        const all = await this.profileService.listProfiles();
        if (all.length > 0 && all[0]) profile = all[0];
      }
      if (!profile) {
        throw new ProfileNotFoundError('No product profile found for query expansion.');
      }
      return QueryExpansionEngine.expand(profile);
    });

    this.router.get('/api/providers', async () => {
      return [
        {
          id: 'demo',
          name: this.demoProvider.name,
          state: 'READY',
          provenance: 'DEMO',
          description: 'Fictional curated conversation fixtures for testing and evaluation',
        },
        {
          id: 'hacker-news',
          name: this.hackerNewsProvider.name,
          state: 'READY',
          provenance: 'LIVE',
          description: 'Official Algolia Hacker News Search API (zero credentials required)',
        },
        {
          id: 'bluesky',
          name: this.blueskyProvider.name,
          state: 'READY',
          provenance: 'LIVE',
          description: 'Official AT Protocol public post search API (zero credentials required)',
        },
        {
          id: 'reddit',
          name: this.redditProvider.name,
          state: this.redditProvider.getStatus().state,
          provenance: 'LIVE',
          description: 'Reddit Data API (OAuth client configuration required)',
        },
        {
          id: 'rss',
          name: this.rssProvider.name,
          state: this.rssProvider.getStatus().state,
          provenance: 'LIVE',
          description: 'Public RSS/Atom syndication feeds with SSRF validation',
        },
        {
          id: 'ai-draft',
          name: this.draftProvider.name,
          state: this.draftProvider.isConfigured() ? 'READY' : 'NOT_CONFIGURED',
          provenance: 'LOCAL_OR_REMOTE',
          description: 'Contextual AI reply drafting provider (injectable / env keys)',
        },
      ];
    });

    this.router.post('/api/conversations/search', async (ctx: RequestContext) => {
      const body = (ctx.body ?? {}) as {
        provider?: 'demo' | 'hacker-news' | 'bluesky' | 'reddit' | 'rss';
        queryTerms?: string[];
        query?: string;
        excludedTopics?: string[];
        platform?: string;
        limit?: number;
        offset?: number;
      };

      const providerId = body.provider ?? 'demo';
      const searchInput: SearchInput = {
        queryTerms: body.queryTerms,
        query: body.query,
        excludedTopics: body.excludedTopics,
        platform: body.platform,
        limit: body.limit,
        offset: body.offset,
      };

      let result: ConversationSearchResult;
      switch (providerId) {
        case 'hacker-news':
          result = await this.hackerNewsProvider.search(searchInput);
          break;
        case 'bluesky':
          result = await this.blueskyProvider.search(searchInput);
          break;
        case 'reddit':
          result = await this.redditProvider.search(searchInput);
          break;
        case 'rss':
          result = await this.rssProvider.search(searchInput);
          break;
        case 'demo':
        default:
          result = await this.demoProvider.search(searchInput);
          break;
      }
      return result;
    });

    // 4. Opportunities List & Detail
    this.router.get('/api/opportunities', async (ctx: RequestContext) => {
      const query = ctx.query;
      const statusParam = query.status;
      const status = Array.isArray(statusParam)
        ? (statusParam as OpportunityStatus[])
        : (statusParam as OpportunityStatus | undefined);

      const minScore = query.minScore ? Number(query.minScore) : undefined;
      const maxScore = query.maxScore ? Number(query.maxScore) : undefined;
      const platform = query.platform as string | string[] | undefined;
      const provenance = query.provenance as SourceProvenance | undefined;
      const startDate = query.startDate as string | undefined;
      const endDate = query.endDate as string | undefined;

      const page = query.page ? Math.max(1, parseInt(query.page as string, 10)) : 1;
      const pageSize = query.pageSize
        ? Math.min(100, Math.max(1, parseInt(query.pageSize as string, 10)))
        : 20;

      const all = await this.pipelineService.listOpportunities({
        status,
        relevanceRange:
          minScore !== undefined || maxScore !== undefined
            ? { min: minScore, max: maxScore }
            : undefined,
        platform,
        provenance,
        dateRange: startDate || endDate ? { startDate, endDate } : undefined,
      });

      const totalItems = all.length;
      const totalPages = Math.ceil(totalItems / pageSize) || 1;
      const offset = (page - 1) * pageSize;
      const items = all.slice(offset, offset + pageSize);

      const pagination: PaginationMeta = {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      };

      const result: PaginatedResult<Opportunity> = {
        items,
        pagination,
      };
      return result;
    });

    this.router.get('/api/opportunities/:id', async (ctx: RequestContext) =>
      this.pipelineService.getOpportunity(ctx.params.id!),
    );

    this.router.post('/api/opportunities/attribute', async (ctx: RequestContext) => {
      const body = (ctx.body ?? {}) as {
        candidate: ConversationItem;
        profile?: ProductProfile;
        profileId?: string;
        queryTerms?: string[];
      };

      let profile: ProductProfile | null = body.profile ?? null;
      if (!profile && body.profileId) {
        profile = await this.profileService.getProfile(body.profileId);
      }
      if (!profile) {
        const all = await this.profileService.listProfiles();
        if (all.length > 0 && all[0]) profile = all[0];
      }
      if (!profile) {
        throw new ProfileNotFoundError('No product profile found for opportunity attribution.');
      }

      const queryTerms =
        body.queryTerms ??
        QueryExpansionEngine.getActiveTermStrings(QueryExpansionEngine.expand(profile));

      return this.opportunityService.attributeOpportunity({
        profile,
        candidate: body.candidate,
        queryTerms,
      });
    });

    this.router.post('/api/opportunities/attribute-batch', async (ctx: RequestContext) => {
      const body = (ctx.body ?? {}) as {
        candidates: ConversationItem[];
        profile?: ProductProfile;
        profileId?: string;
        queryTerms?: string[];
      };

      let profile: ProductProfile | null = body.profile ?? null;
      if (!profile && body.profileId) {
        profile = await this.profileService.getProfile(body.profileId);
      }
      if (!profile) {
        const all = await this.profileService.listProfiles();
        if (all.length > 0 && all[0]) profile = all[0];
      }
      if (!profile) {
        throw new ProfileNotFoundError('No product profile found for batch attribution.');
      }

      const queryTerms =
        body.queryTerms ??
        QueryExpansionEngine.getActiveTermStrings(QueryExpansionEngine.expand(profile));

      return this.opportunityService.attributeBatch({
        profile,
        candidates: body.candidates ?? [],
        queryTerms,
      });
    });

    // 5. Draft Operations
    this.router.get('/api/opportunities/:id/draft', async (ctx: RequestContext) => {
      const opp = await this.pipelineService.getOpportunity(ctx.params.id!);
      return opp.replyDraft;
    });

    this.router.post('/api/opportunities/:id/draft', async (ctx: RequestContext) => {
      const body = (ctx.body ?? {}) as {
        allowLowScoreOverride?: boolean;
        profileId?: string;
        profile?: ProductProfile;
      };

      let profile = body.profile;
      if (!profile && body.profileId) {
        profile = (await this.profileService.getProfile(body.profileId)) ?? undefined;
      }
      if (!profile) {
        const all = await this.profileService.listProfiles();
        if (all.length > 0 && all[0]) profile = all[0];
      }

      return this.replyDraftingService.generateDraft({
        opportunityId: ctx.params.id!,
        allowLowScoreOverride: body.allowLowScoreOverride,
        profile,
      });
    });

    this.router.put('/api/opportunities/:id/draft', async (ctx: RequestContext) => {
      const body = (ctx.body ?? {}) as { newText: string; changeSummary?: string };
      return this.replyDraftingService.editDraft(ctx.params.id!, {
        newText: body.newText,
        changeSummary: body.changeSummary,
      });
    });

    this.router.get('/api/opportunities/:id/review', async (ctx: RequestContext) =>
      this.replyDraftingService.getReviewData(ctx.params.id!),
    );

    this.router.get('/api/opportunities/:id/source-link', async (ctx: RequestContext) => {
      const permalink = await this.replyDraftingService.getOriginalSourceLink(ctx.params.id!);
      return { permalink };
    });

    this.router.get('/api/opportunities/:id/copy', async (ctx: RequestContext) => {
      const includeNote = ctx.query.includeTransparencyNote !== 'false';
      return this.replyDraftingService.copyDraft(ctx.params.id!, {
        includeTransparencyNote: includeNote,
      });
    });

    // 6. Status Transitions, Manual Response Auditing & Pipeline Metrics
    this.router.post('/api/opportunities/:id/status', async (ctx: RequestContext) => {
      const body = (ctx.body ?? {}) as {
        toStatus: OpportunityStatus;
        reason?: string;
        userReviewNotes?: string;
        manualResponseAudit?: ManualResponseAudit;
      };

      return this.pipelineService.transitionStatus({
        opportunityId: ctx.params.id!,
        toStatus: body.toStatus,
        reason: body.reason,
        userReviewNotes: body.userReviewNotes,
        manualResponseAudit: body.manualResponseAudit,
      });
    });

    this.router.post('/api/opportunities/:id/respond', async (ctx: RequestContext) => {
      const body = (ctx.body ?? {}) as {
        manualDispatchConfirmed: true;
        markedSentAt?: string;
        operatorNotes?: string;
        userReviewNotes?: string;
      };

      return this.pipelineService.recordManualResponse({
        opportunityId: ctx.params.id!,
        manualDispatchConfirmed: body.manualDispatchConfirmed,
        markedSentAt: body.markedSentAt,
        operatorNotes: body.operatorNotes,
        userReviewNotes: body.userReviewNotes,
      });
    });

    this.router.put('/api/opportunities/:id/notes', async (ctx: RequestContext) => {
      const body = (ctx.body ?? {}) as { notes: string };
      return this.pipelineService.updateReviewNotes(ctx.params.id!, body.notes ?? '');
    });

    this.router.get('/api/opportunities/:id/history', async (ctx: RequestContext) =>
      this.pipelineService.getStatusHistory(ctx.params.id!),
    );

    this.router.get('/api/pipeline/metrics', async (ctx: RequestContext) => {
      const query = ctx.query;
      const statusParam = query.status;
      const status = Array.isArray(statusParam)
        ? (statusParam as OpportunityStatus[])
        : (statusParam as OpportunityStatus | undefined);

      const minScore = query.minScore ? Number(query.minScore) : undefined;
      const maxScore = query.maxScore ? Number(query.maxScore) : undefined;
      const platform = query.platform as string | string[] | undefined;
      const provenance = query.provenance as SourceProvenance | undefined;
      const startDate = query.startDate as string | undefined;
      const endDate = query.endDate as string | undefined;

      const filter: PipelineMetricsFilter = {
        status,
        platform,
        provenance,
        relevanceRange:
          minScore !== undefined || maxScore !== undefined
            ? { min: minScore, max: maxScore }
            : undefined,
        dateRange: startDate || endDate ? { startDate, endDate } : undefined,
      };

      return this.pipelineService.getPipelineMetrics(filter);
    });
  }

  /**
   * Starts HTTP server bound strictly to localhost (127.0.0.1).
   */
  async start(
    port = this.port,
    host = this.host,
  ): Promise<{ port: number; host: string; url: string }> {
    if (this.server) {
      const addr = this.server.address() as AddressInfo;
      return { port: addr.port, host: this.host, url: `http://${this.host}:${addr.port}` };
    }

    return new Promise((resolve, reject) => {
      const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
        this.router.handle(req, res).catch((err) => {
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                success: false,
                error: { code: 'UNHANDLED_EXCEPTION', message: (err as Error).message },
              }),
            );
          }
        });
      });

      server.on('error', (err) => reject(err));

      server.listen(port, host, () => {
        this.server = server;
        const addr = server.address() as AddressInfo;
        const actualPort = addr.port;
        const url = `http://${host}:${actualPort}`;
        resolve({ port: actualPort, host, url });
      });
    });
  }

  /**
   * Stops the running server.
   */
  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Dispatches request directly through the router without network sockets.
   * Useful for unit testing and in-process Stitch frontend rendering.
   */
  getRouter(): Router {
    return this.router;
  }
}
