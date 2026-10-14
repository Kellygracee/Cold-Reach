/**
 * Complete OpenAPI 3.1.0 specification for the Cold-Reach Stitch API.
 * This typed contract describes all paths, parameters, request bodies, and response schemas
 * consumed by the Stitch-generated frontend.
 */
export const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Cold-Reach Stitch API',
    version: '0.1.0',
    description:
      'Typed REST API exposing product profiles, query expansion, conversation search, opportunity tracking, contextual drafting, and pipeline metrics for the Stitch frontend.',
  },
  servers: [
    {
      url: 'http://127.0.0.1:3001',
      description: 'Local development server (strictly bound to localhost for security)',
    },
  ],
  paths: {
    '/api/profiles': {
      get: {
        summary: 'List all product profiles',
        responses: {
          '200': {
            description: 'List of product profiles',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ProfileListResponse' } },
            },
          },
        },
      },
      post: {
        summary: 'Create a new product profile',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateProductProfileInput' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created product profile',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ProfileResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
        },
      },
    },
    '/api/profiles/{id}': {
      get: {
        summary: 'Get a product profile by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Product profile details',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ProfileResponse' } },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
      put: {
        summary: 'Update an existing product profile',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateProductProfileInput' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated product profile',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ProfileResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/query-expansion': {
      post: {
        summary: 'Generate deterministic query expansion clusters from profile or profile ID',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  profileId: { type: 'string' },
                  profile: { $ref: '#/components/schemas/ProductProfile' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Query expansion clusters with provenance and conflict flags',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/QueryExpansionResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
        },
      },
    },
    '/api/providers': {
      get: {
        summary: 'List available search and AI draft providers with status and configuration state',
        responses: {
          '200': {
            description: 'Provider list with status and provenance information',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ProviderListResponse' } },
            },
          },
        },
      },
    },
    '/api/conversations/search': {
      post: {
        summary: 'Search conversations across selected provider with clear DEMO/LIVE provenance',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['provider'],
                properties: {
                  provider: {
                    type: 'string',
                    enum: ['demo', 'hacker-news', 'bluesky', 'reddit', 'rss'],
                    description: 'Target provider to search',
                  },
                  queryTerms: { type: 'array', items: { type: 'string' } },
                  query: { type: 'string' },
                  excludedTopics: { type: 'array', items: { type: 'string' } },
                  platform: { type: 'string' },
                  limit: { type: 'integer', default: 20 },
                  offset: { type: 'integer', default: 0 },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Search results labeled explicitly with DEMO or LIVE provenance',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ConversationSearchResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '422': { description: 'Provider not configured or unsupported' },
        },
      },
    },
    '/api/opportunities': {
      get: {
        summary: 'List opportunities with filters and pagination',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'minScore', in: 'query', schema: { type: 'number' } },
          { name: 'maxScore', in: 'query', schema: { type: 'number' } },
          { name: 'platform', in: 'query', schema: { type: 'string' } },
          { name: 'provenance', in: 'query', schema: { type: 'string', enum: ['DEMO', 'LIVE'] } },
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          '200': {
            description: 'Paginated opportunity list',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaginatedOpportunitiesResponse' },
              },
            },
          },
        },
      },
    },
    '/api/opportunities/{id}': {
      get: {
        summary: 'Get opportunity detail by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Opportunity details',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/OpportunityResponse' } },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/opportunities/attribute': {
      post: {
        summary: 'Evaluate and attribute candidate conversation to deduplicated Opportunity',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['candidate'],
                properties: {
                  candidate: { $ref: '#/components/schemas/ConversationItem' },
                  profile: { $ref: '#/components/schemas/ProductProfile' },
                  profileId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Attributed Opportunity record starting in NEW',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/OpportunityResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
        },
      },
    },
    '/api/opportunities/{id}/draft': {
      get: {
        summary: 'Get current draft reply for opportunity',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Current draft reply or null',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DraftResponse' } },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
      post: {
        summary: 'Generate contextual reply draft (gated on score < 40 without override)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  allowLowScoreOverride: {
                    type: 'boolean',
                    description: 'Required if opportunity relevance score is below 40',
                  },
                  profileId: { type: 'string' },
                  profile: { $ref: '#/components/schemas/ProductProfile' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Generated draft reply',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DraftResponse' } },
            },
          },
          '422': { description: 'Low score override required or provider not configured' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
      put: {
        summary: 'Edit draft reply with human revision tracking (editedBy: USER)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['newText'],
                properties: {
                  newText: { type: 'string' },
                  changeSummary: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated draft reply with appended revision',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DraftResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/opportunities/{id}/review': {
      get: {
        summary: 'Get complete review data bundle for UI rendering',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description:
              'Complete review bundle with candidate, whyMatched, draft, and override status',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ReviewDataResponse' } },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/opportunities/{id}/source-link': {
      get: {
        summary: 'Get original source permalink to open in browser',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Source permalink URL',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/SourceLinkResponse' } },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/opportunities/{id}/copy': {
      get: {
        summary: 'Get formatted clipboard payload with transparency note and character count',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'includeTransparencyNote',
            in: 'query',
            schema: { type: 'boolean', default: true },
          },
        ],
        responses: {
          '200': {
            description: 'Clipboard copy payload',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CopyPayloadResponse' } },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/opportunities/{id}/status': {
      post: {
        summary: 'Transition opportunity status (NEW, REVIEWED, SKIPPED, RESPONDED)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['toStatus'],
                properties: {
                  toStatus: { type: 'string', enum: ['NEW', 'REVIEWED', 'SKIPPED', 'RESPONDED'] },
                  reason: { type: 'string' },
                  userReviewNotes: { type: 'string' },
                  manualResponseAudit: { $ref: '#/components/schemas/ManualResponseAudit' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated opportunity with status transition',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/OpportunityResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '409': { description: 'Invalid transition or audit immutability violation' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/opportunities/{id}/respond': {
      post: {
        summary: 'Record that operator manually posted external response outside application',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['manualDispatchConfirmed'],
                properties: {
                  manualDispatchConfirmed: { type: 'boolean', enum: [true] },
                  markedSentAt: { type: 'string', format: 'date-time' },
                  operatorNotes: { type: 'string' },
                  userReviewNotes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Opportunity marked RESPONDED with immutable audit record',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/OpportunityResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '409': { description: 'Already responded (immutable)' },
        },
      },
    },
    '/api/opportunities/{id}/notes': {
      put: {
        summary: 'Update operator review notes without altering status',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['notes'],
                properties: { notes: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Opportunity with updated notes',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/OpportunityResponse' } },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/opportunities/{id}/history': {
      get: {
        summary: 'Get chronological status history audit trail for opportunity',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'List of status history entries',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/HistoryResponse' } },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/pipeline/metrics': {
      get: {
        summary: 'Get filterable pipeline metrics and conversion rates grounded in stored records',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'platform', in: 'query', schema: { type: 'string' } },
          { name: 'provenance', in: 'query', schema: { type: 'string', enum: ['DEMO', 'LIVE'] } },
          { name: 'minScore', in: 'query', schema: { type: 'number' } },
          { name: 'maxScore', in: 'query', schema: { type: 'number' } },
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: {
          '200': {
            description: 'Aggregated pipeline metrics with appDispatchedCount: 0 guarantee',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PipelineMetricsResponse' },
              },
            },
          },
        },
      },
    },
    '/api/openapi.json': {
      get: {
        summary: 'Get OpenAPI 3.1.0 document',
        responses: {
          '200': { description: 'OpenAPI 3.1.0 JSON document' },
        },
      },
    },
  },
  components: {
    responses: {
      ValidationError: {
        description: 'Validation failed for request body or parameters',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponse' } },
        },
      },
      NotFound: {
        description: 'Requested resource was not found',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponse' } },
        },
      },
    },
    schemas: {
      ApiErrorResponse: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { type: 'boolean', enum: [false] },
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {},
            },
          },
        },
      },
      ProductProfile: {
        type: 'object',
        required: [
          'id',
          'productName',
          'valueProposition',
          'problemsSolved',
          'idealCustomerDescription',
          'seedKeywords',
          'customerPainPointPhrases',
          'excludedTopics',
          'toneGuidelines',
          'createdAt',
          'updatedAt',
        ],
        properties: {
          id: { type: 'string' },
          productName: { type: 'string' },
          valueProposition: { type: 'string' },
          productDescription: { type: 'string' },
          problemsSolved: { type: 'array', items: { type: 'string' } },
          idealCustomerDescription: { type: 'string' },
          seedKeywords: { type: 'array', items: { type: 'string' } },
          customerPainPointPhrases: { type: 'array', items: { type: 'string' } },
          excludedTopics: { type: 'array', items: { type: 'string' } },
          toneGuidelines: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateProductProfileInput: {
        type: 'object',
        required: ['productName', 'problemsSolved', 'idealCustomerDescription', 'toneGuidelines'],
        properties: {
          productName: { type: 'string' },
          valueProposition: { type: 'string' },
          productDescription: { type: 'string' },
          problemsSolved: { type: 'array', items: { type: 'string' } },
          idealCustomerDescription: { type: 'string' },
          seedKeywords: { type: 'array', items: { type: 'string' } },
          customerPainPointPhrases: { type: 'array', items: { type: 'string' } },
          excludedTopics: { type: 'array', items: { type: 'string' } },
          toneGuidelines: { type: 'array', items: { type: 'string' } },
        },
      },
      UpdateProductProfileInput: {
        type: 'object',
        properties: {
          productName: { type: 'string' },
          valueProposition: { type: 'string' },
          productDescription: { type: 'string' },
          problemsSolved: { type: 'array', items: { type: 'string' } },
          idealCustomerDescription: { type: 'string' },
          seedKeywords: { type: 'array', items: { type: 'string' } },
          customerPainPointPhrases: { type: 'array', items: { type: 'string' } },
          excludedTopics: { type: 'array', items: { type: 'string' } },
          toneGuidelines: { type: 'array', items: { type: 'string' } },
        },
      },
      ConversationItem: {
        type: 'object',
        required: [
          'id',
          'platform',
          'authorAlias',
          'contentExcerpt',
          'sourcePermalink',
          'timestamp',
          'matchedKeywords',
          'sourceProvenance',
        ],
        properties: {
          id: { type: 'string' },
          platform: { type: 'string' },
          authorAlias: { type: 'string' },
          contentExcerpt: { type: 'string' },
          sourcePermalink: { type: 'string', format: 'uri' },
          timestamp: { type: 'string', format: 'date-time' },
          matchedKeywords: { type: 'array', items: { type: 'string' } },
          sourceProvenance: { type: 'string', enum: ['DEMO', 'LIVE'] },
        },
      },
      ManualResponseAudit: {
        type: 'object',
        required: ['markedSentAt', 'manualDispatchConfirmed', 'dispatchMethod'],
        properties: {
          markedSentAt: { type: 'string', format: 'date-time' },
          manualDispatchConfirmed: { type: 'boolean', enum: [true] },
          dispatchMethod: { type: 'string', enum: ['MANUAL_EXTERNAL_POST'] },
          operatorNotes: { type: 'string' },
        },
      },
      Opportunity: {
        type: 'object',
        required: [
          'id',
          'conversation',
          'relevanceScore',
          'whyMatched',
          'status',
          'createdAt',
          'updatedAt',
        ],
        properties: {
          id: { type: 'string' },
          conversation: { $ref: '#/components/schemas/ConversationItem' },
          relevanceScore: { type: 'number', minimum: 0, maximum: 100 },
          whyMatched: {
            type: 'object',
            required: ['summary', 'matchedNeeds', 'relevanceRationale', 'contextSnippet'],
            properties: {
              summary: { type: 'string' },
              matchedNeeds: { type: 'array', items: { type: 'string' } },
              relevanceRationale: { type: 'string' },
              contextSnippet: { type: 'string' },
            },
          },
          replyDraft: {},
          status: { type: 'string', enum: ['NEW', 'REVIEWED', 'SKIPPED', 'RESPONDED'] },
          manualResponseAudit: { $ref: '#/components/schemas/ManualResponseAudit' },
          userReviewNotes: { type: 'string' },
          statusHistory: { type: 'array', items: {} },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ProfileResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { $ref: '#/components/schemas/ProductProfile' },
        },
      },
      ProfileListResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { type: 'array', items: { $ref: '#/components/schemas/ProductProfile' } },
        },
      },
      QueryExpansionResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { type: 'object' },
        },
      },
      ProviderListResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { type: 'array', items: { type: 'object' } },
        },
      },
      ConversationSearchResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { type: 'object' },
        },
      },
      OpportunityResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { $ref: '#/components/schemas/Opportunity' },
        },
      },
      PaginatedOpportunitiesResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { $ref: '#/components/schemas/Opportunity' } },
              pagination: { type: 'object' },
            },
          },
        },
      },
      DraftResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {},
        },
      },
      ReviewDataResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { type: 'object' },
        },
      },
      SourceLinkResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { type: 'object', properties: { permalink: { type: 'string' } } },
        },
      },
      CopyPayloadResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { type: 'object' },
        },
      },
      HistoryResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { type: 'array', items: { type: 'object' } },
        },
      },
      PipelineMetricsResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { type: 'object' },
        },
      },
    },
  },
} as const;
