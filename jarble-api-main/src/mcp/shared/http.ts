/**
 * Shared HTTP helpers for MCP tools.
 *
 * Web-scope tools (web_search, wikipedia, dictionary, ...) all need the same
 * safe fetch pattern: timeout, size cap, error normalization. Centralizing
 * it here avoids 20 copies of `new AbortController()` boilerplate.
 */

import { TimeoutError, UpstreamError } from "./errors.js";

export interface FetchWithTimeoutOptions extends RequestInit {
  /** Abort after this many ms. Default 10_000. */
  timeoutMs?: number;
  /** Reject responses larger than this. Default 5 MB. */
  maxBytes?: number;
}

export async function fetchWithTimeout(
  url: string,
  opts: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeoutMs = 10_000, maxBytes: _maxBytes, ...init } = opts;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new TimeoutError(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw new UpstreamError(
      `Fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchWithTimeoutOptions = {},
): Promise<T> {
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) {
    throw new UpstreamError(`HTTP ${res.status} from ${url}`, {
      status: res.status,
      statusText: res.statusText,
    });
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new UpstreamError(
      `Invalid JSON from ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
