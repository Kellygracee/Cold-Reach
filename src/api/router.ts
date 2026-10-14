import fs from 'node:fs';
import { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { ZodError } from 'zod';
import {
  AuditImmutabilityError,
  InvalidStatusTransitionError,
  MissingManualResponseAuditError,
} from '../contracts/pipeline.js';
import {
  DraftNotFoundError,
  DraftProviderNotConfiguredError,
  LowScoreOverrideRequiredError,
  ManualResponseWorkflowRequiredError,
} from '../contracts/draft-provider.js';
import { IntegrityValidationError } from '../contracts/integrity.js';
import { ProviderError } from '../contracts/conversation-provider.js';
import { OpportunityNotFoundError } from '../services/opportunity-service.js';
import { ProfileNotFoundError, ProfileValidationError } from '../services/profile-service.js';
import {
  ApiErrorResponse,
  ApiResponse,
  HttpMethod,
  RequestContext,
  RouteHandler,
} from './types.js';

interface RouteDefinition {
  method: HttpMethod;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export interface RouterOptions {
  allowedOrigins?: string[];
  staticDir?: string;
}

export class Router {
  private readonly routes: RouteDefinition[] = [];
  private readonly allowedOrigins: string[];
  private readonly staticDir?: string;

  constructor(options?: RouterOptions) {
    this.allowedOrigins = options?.allowedOrigins ?? [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
    ];
    this.staticDir = options?.staticDir;
  }

  add(method: HttpMethod, pathPattern: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const regexPattern = pathPattern
      .replace(/:([a-zA-Z0-9_]+)/g, (_, paramName) => {
        paramNames.push(paramName);
        return '([^/]+)';
      })
      .replace(/\//g, '\\/');

    this.routes.push({
      method,
      pattern: new RegExp(`^${regexPattern}$`),
      paramNames,
      handler,
    });
  }

  get(path: string, handler: RouteHandler): void {
    this.add('GET', path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.add('POST', path, handler);
  }

  put(path: string, handler: RouteHandler): void {
    this.add('PUT', path, handler);
  }

  delete(path: string, handler: RouteHandler): void {
    this.add('DELETE', path, handler);
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;

    // Set CORS headers
    if (origin && (this.allowedOrigins.includes('*') || this.allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3000');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    // Handle preflight OPTIONS
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;
    const method = (req.method ?? 'GET').toUpperCase() as HttpMethod;

    // Parse query parameters
    const query: Record<string, string | string[]> = {};
    for (const [key, val] of url.searchParams.entries()) {
      const existing = query[key];
      if (existing !== undefined) {
        if (Array.isArray(existing)) {
          existing.push(val);
        } else {
          query[key] = [existing, val];
        }
      } else {
        query[key] = val;
      }
    }

    // Match route
    let matchedRoute: RouteDefinition | null = null;
    let params: Record<string, string> = {};

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (match) {
        matchedRoute = route;
        params = {};
        for (let i = 0; i < route.paramNames.length; i++) {
          const paramName = route.paramNames[i];
          const matchVal = match[i + 1];
          if (paramName && matchVal !== undefined) {
            params[paramName] = decodeURIComponent(matchVal);
          }
        }
        break;
      }
    }

    if (!matchedRoute) {
      if (method === 'GET' && this.staticDir && !pathname.startsWith('/api')) {
        const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
        let filePath = path.join(this.staticDir, safePath);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }
        if (!fs.existsSync(filePath)) {
          const fallback = path.join(this.staticDir, 'index.html');
          if (fs.existsSync(fallback)) {
            filePath = fallback;
          }
        }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.ico': 'image/x-icon',
            '.woff2': 'font/woff2',
            '.woff': 'font/woff',
          };
          const contentType = mimeTypes[ext] ?? 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      }

      this.sendError(res, 404, 'NOT_FOUND', `Cannot ${method} ${pathname}`);
      return;
    }

    // Parse body if present
    let body: unknown = undefined;
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      try {
        body = await this.readRequestBody(req);
      } catch (err) {
        this.sendError(res, 400, 'INVALID_BODY', (err as Error).message);
        return;
      }
    }

    const ctx: RequestContext = {
      req,
      res,
      params,
      query,
      body,
      origin,
    };

    try {
      const result = await matchedRoute.handler(ctx);

      // If handler manually ended response, return
      if (res.writableEnded) return;

      const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 200;
      res.statusCode = statusCode;
      res.setHeader('Content-Type', 'application/json');

      const responsePayload: ApiResponse<unknown> = {
        success: true,
        data: result,
      };
      res.end(JSON.stringify(responsePayload));
    } catch (err) {
      this.handleError(res, err);
    }
  }

  private async readRequestBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalLength = 0;
      const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB limit

      req.on('data', (chunk: Buffer) => {
        totalLength += chunk.length;
        if (totalLength > MAX_BODY_BYTES) {
          reject(new Error('Request payload too large (max 2MB)'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (chunks.length === 0) {
          resolve({});
          return;
        }
        const raw = Buffer.concat(chunks).toString('utf-8').trim();
        if (!raw) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('Malformed JSON payload'));
        }
      });

      req.on('error', (err) => reject(err));
    });
  }

  private handleError(res: ServerResponse, err: unknown): void {
    if (res.writableEnded) return;

    if (err instanceof ZodError) {
      this.sendError(
        res,
        400,
        'VALIDATION_ERROR',
        'Validation error in request payload.',
        err.issues,
      );
      return;
    }

    if (err instanceof ProfileValidationError) {
      this.sendError(res, 400, 'PROFILE_VALIDATION_ERROR', err.message, err.issues);
      return;
    }

    if (
      err instanceof ProfileNotFoundError ||
      err instanceof OpportunityNotFoundError ||
      err instanceof DraftNotFoundError
    ) {
      this.sendError(res, 404, 'NOT_FOUND', err.message);
      return;
    }

    if (err instanceof LowScoreOverrideRequiredError) {
      this.sendError(res, 422, 'LOW_SCORE_OVERRIDE_REQUIRED', err.warning, {
        relevanceScore: err.relevanceScore,
        threshold: err.threshold,
      });
      return;
    }

    if (err instanceof InvalidStatusTransitionError) {
      this.sendError(res, 409, 'INVALID_STATUS_TRANSITION', err.message, {
        fromStatus: err.fromStatus,
        toStatus: err.toStatus,
      });
      return;
    }

    if (err instanceof AuditImmutabilityError) {
      this.sendError(res, 409, 'AUDIT_IMMUTABILITY_ERROR', err.message);
      return;
    }

    if (
      err instanceof MissingManualResponseAuditError ||
      err instanceof ManualResponseWorkflowRequiredError
    ) {
      this.sendError(res, 400, 'MANUAL_RESPONSE_AUDIT_REQUIRED', err.message);
      return;
    }

    if (err instanceof IntegrityValidationError) {
      this.sendError(res, 400, 'INTEGRITY_VIOLATION', err.message);
      return;
    }

    if (err instanceof DraftProviderNotConfiguredError) {
      this.sendError(res, 503, 'DRAFT_PROVIDER_NOT_CONFIGURED', err.message);
      return;
    }

    if (err instanceof ProviderError) {
      this.sendError(res, 502, err.code, err.message, { provider: err.providerName });
      return;
    }

    const message = err instanceof Error ? err.message : 'Internal Server Error';
    this.sendError(res, 500, 'INTERNAL_SERVER_ERROR', message);
  }

  private sendError(
    res: ServerResponse,
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');

    const errorPayload: ApiErrorResponse = {
      success: false,
      error: {
        code,
        message,
        details,
      },
    };

    res.end(JSON.stringify(errorPayload));
  }
}
