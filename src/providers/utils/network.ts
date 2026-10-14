import {
  ProviderAuthenticationError,
  ProviderMalformedResponseError,
  ProviderNetworkError,
  ProviderRateLimitError,
  ProviderSecurityError,
  ProviderTimeoutError,
} from '../../contracts/conversation-provider.js';

export type DnsLookupFunction = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

/**
 * Checks whether an IP address belongs to loopback, private, link-local, or cloud metadata ranges.
 */
export function isPrivateOrLoopbackIp(ip: string): boolean {
  const cleanIp = ip.trim().replace(/^\[|\]$/g, '');

  // IPv4 Checks
  const ipv4Match = cleanIp.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    const c = Number(ipv4Match[3]);
    const d = Number(ipv4Match[4]);

    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 127) return true; // Loopback 127.0.0.0/8
    if (a === 10) return true; // Private 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // Private 172.16.0.0/12
    if (a === 192 && b === 168) return true; // Private 192.168.0.0/16
    if (a === 169 && b === 254) return true; // Link-local / Cloud metadata 169.254.0.0/16
    return false;
  }

  // IPv6 Checks
  const cleanIpv6 = cleanIp.toLowerCase();
  if (
    cleanIpv6 === '::1' ||
    cleanIpv6 === '0:0:0:0:0:0:0:1' ||
    cleanIpv6.startsWith('fe80:') || // Link-local
    cleanIpv6.startsWith('fc00:') || // Unique local
    cleanIpv6.startsWith('fd00:') // Unique local
  ) {
    return true;
  }

  return false;
}

/**
 * Validates that a user-configured URL uses http/https and targets a safe public address.
 * Strictly prevents SSRF attacks targeting localhost, loopback, cloud metadata, or private IP ranges.
 */
export function validateSafePublicUrl(urlString: string, providerName: string = 'network'): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new ProviderSecurityError(
      `Invalid URL format: "${urlString}" is not a valid URL.`,
      providerName,
    );
  }

  // 1. Protocol check
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProviderSecurityError(
      `Disallowed protocol "${parsed.protocol}". Only HTTP and HTTPS URLs are permitted.`,
      providerName,
    );
  }

  const hostname = parsed.hostname.toLowerCase().trim();

  // 2. Localhost and local domain names
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan')
  ) {
    throw new ProviderSecurityError(
      `Security violation: Requests to internal or localhost hostname "${hostname}" are blocked.`,
      providerName,
    );
  }

  // 3. Literal IP Checks
  if (isPrivateOrLoopbackIp(hostname)) {
    throw new ProviderSecurityError(
      `Security violation: Requests to private, loopback, or metadata IP address "${hostname}" are blocked.`,
      providerName,
    );
  }

  return parsed;
}

/**
 * Resolves a hostname via DNS and asserts that none of the resolved IP addresses
 * belong to private, loopback, or cloud metadata ranges.
 */
export async function assertHostnameResolvesToPublicIp(
  hostname: string,
  providerName: string = 'network',
  dnsLookupFn?: DnsLookupFunction,
): Promise<void> {
  const cleanHost = hostname.toLowerCase().trim();

  // Direct syntactic check
  if (
    cleanHost === 'localhost' ||
    cleanHost.endsWith('.localhost') ||
    cleanHost.endsWith('.local') ||
    cleanHost.endsWith('.internal') ||
    cleanHost.endsWith('.lan') ||
    isPrivateOrLoopbackIp(cleanHost)
  ) {
    throw new ProviderSecurityError(
      `Security violation: Hostname "${hostname}" points to private, internal, or loopback address.`,
      providerName,
    );
  }

  // Perform DNS lookup
  try {
    const lookup =
      dnsLookupFn ??
      (async (host: string) => {
        const dns = await import('node:dns/promises');
        return dns.lookup(host, { all: true });
      });

    const records = await lookup(cleanHost);
    for (const record of records) {
      if (isPrivateOrLoopbackIp(record.address)) {
        throw new ProviderSecurityError(
          `Security violation: Hostname "${hostname}" resolves to private, loopback, or metadata IP address "${record.address}".`,
          providerName,
        );
      }
    }
  } catch (err) {
    if (err instanceof ProviderSecurityError) {
      throw err;
    }
    throw new ProviderNetworkError(
      `Failed to resolve hostname "${hostname}": ${err instanceof Error ? err.message : String(err)}`,
      providerName,
    );
  }
}

export interface SafeFetchOptions extends RequestInit {
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  dnsLookupFn?: DnsLookupFunction;
  providerName: string;
  maxRedirects?: number;
}

/**
 * Robust fetch wrapper handling timeouts, rate limits, network failures, auth errors,
 * and securely validating all HTTP redirects against SSRF and private IP destinations.
 */
export async function safeFetch(url: string, options: SafeFetchOptions): Promise<Response> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10000;
  const providerName = options.providerName;
  const maxRedirects = options.maxRedirects ?? 5;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(options.signal?.reason));
  }

  let currentUrl = url;

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      // Validate current URL syntactically
      const parsed = validateSafePublicUrl(currentUrl, providerName);

      // Validate DNS resolution if lookup function provided
      if (options.dnsLookupFn) {
        await assertHostnameResolvesToPublicIp(parsed.hostname, providerName, options.dnsLookupFn);
      }

      const response = await fetchFn(currentUrl, {
        ...options,
        redirect: 'manual', // Never follow redirects blindly without validation
        signal: controller.signal,
      });

      // Handle Redirects
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const locationHeader = response.headers.get('location');
        if (!locationHeader) {
          throw new ProviderMalformedResponseError(
            `Redirect HTTP ${response.status} response missing Location header.`,
            providerName,
          );
        }

        const nextUrl = new URL(locationHeader, currentUrl).toString();

        // Validate redirected destination immediately against SSRF!
        const nextParsed = validateSafePublicUrl(nextUrl, providerName);
        if (options.dnsLookupFn) {
          await assertHostnameResolvesToPublicIp(
            nextParsed.hostname,
            providerName,
            options.dnsLookupFn,
          );
        }

        currentUrl = nextUrl;
        continue;
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
        throw new ProviderRateLimitError(
          `Rate limit exceeded (HTTP 429).${retryAfter ? ` Retry after ${retryAfter}s.` : ''}`,
          providerName,
          Number.isFinite(retryAfter) ? retryAfter : undefined,
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthenticationError(
          `Authentication failed with status HTTP ${response.status}. Verify provider credentials.`,
          providerName,
        );
      }

      return response;
    }

    throw new ProviderSecurityError(
      `Too many redirects (exceeded maximum of ${maxRedirects} hops).`,
      providerName,
    );
  } catch (err) {
    if (
      err instanceof ProviderRateLimitError ||
      err instanceof ProviderAuthenticationError ||
      err instanceof ProviderSecurityError ||
      err instanceof ProviderMalformedResponseError
    ) {
      throw err;
    }

    if (controller.signal.aborted) {
      throw new ProviderTimeoutError(`Request timed out after ${timeoutMs}ms.`, providerName);
    }

    throw new ProviderNetworkError(
      `Network communication failed: ${err instanceof Error ? err.message : String(err)}`,
      providerName,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Safely parses response JSON, throwing ProviderMalformedResponseError if invalid.
 */
export async function parseJsonResponse<T>(response: Response, providerName: string): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new ProviderMalformedResponseError(
      `Failed to parse response as JSON: ${err instanceof Error ? err.message : String(err)}`,
      providerName,
    );
  }
}
