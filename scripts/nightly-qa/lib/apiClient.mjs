/**
 * Authenticated API client for tRPC and REST endpoint testing.
 *
 * Records timing, status, and errors for every call so the reporter
 * can surface API-level issues alongside browser-based test results.
 */

export class ApiClient {
  /**
   * @param {string} baseUrl — API base URL (e.g. http://localhost:3001)
   * @param {string} [token] — Bearer token for authenticated requests
   */
  constructor(baseUrl, token = null) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    /** @type {{ method: string, path: string, status: number|null, duration: number, error: string|null, responseSize: number|null, timestamp: string }[]} */
    this.results = [];
  }

  /**
   * Build standard headers.
   */
  _headers(extra = {}) {
    const h = {
      "Content-Type": "application/json",
      "User-Agent": "JarbleNightlyQA/1.0",
      ...extra,
    };
    if (this.token) {
      h["Authorization"] = `Bearer ${this.token}`;
    }
    return h;
  }

  /**
   * Call a tRPC query or mutation endpoint.
   * @param {string} path — e.g. "deployment.list" or "user.me"
   * @param {object} [input] — Input payload (sent as query param for queries, body for mutations)
   * @param {"query"|"mutation"} [type]
   * @returns {Promise<{ data: any, status: number, duration: number }>}
   */
  async trpc(path, input = undefined, type = "query") {
    const url =
      type === "query"
        ? `${this.baseUrl}/trpc/${path}${input !== undefined ? `?input=${encodeURIComponent(JSON.stringify(input))}` : ""}`
        : `${this.baseUrl}/trpc/${path}`;

    const fetchOptions = {
      method: type === "query" ? "GET" : "POST",
      headers: this._headers(),
    };

    if (type === "mutation" && input !== undefined) {
      fetchOptions.body = JSON.stringify(input);
    }

    const start = Date.now();
    let status = null;
    let data = null;
    let error = null;
    let responseSize = null;

    try {
      const res = await fetch(url, fetchOptions);
      status = res.status;
      const text = await res.text();
      responseSize = text.length;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      if (status >= 400) {
        error = `HTTP ${status}`;
      }
    } catch (err) {
      error = err.message;
    }

    const duration = Date.now() - start;

    this.results.push({
      method: type === "query" ? "GET" : "POST",
      path: `/trpc/${path}`,
      status,
      duration,
      error,
      responseSize,
      timestamp: new Date().toISOString(),
    });

    return { data, status, duration, error };
  }

  /**
   * Call a REST endpoint.
   * @param {"GET"|"POST"|"PUT"|"PATCH"|"DELETE"} method
   * @param {string} path — e.g. "/debug/db"
   * @param {object} [body]
   * @returns {Promise<{ data: any, status: number, duration: number }>}
   */
  async rest(method, path, body = undefined) {
    const url = `${this.baseUrl}${path}`;

    const fetchOptions = {
      method,
      headers: this._headers(),
    };

    if (body !== undefined && method !== "GET") {
      fetchOptions.body = JSON.stringify(body);
    }

    const start = Date.now();
    let status = null;
    let data = null;
    let error = null;
    let responseSize = null;

    try {
      const res = await fetch(url, fetchOptions);
      status = res.status;
      const text = await res.text();
      responseSize = text.length;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      if (status >= 400) {
        error = `HTTP ${status}`;
      }
    } catch (err) {
      error = err.message;
    }

    const duration = Date.now() - start;

    this.results.push({
      method,
      path,
      status,
      duration,
      error,
      responseSize,
      timestamp: new Date().toISOString(),
    });

    return { data, status, duration, error };
  }

  /**
   * Fire multiple requests concurrently and return all results.
   * @param {{ method: string, path: string, body?: object }[]} requests
   * @returns {Promise<{ data: any, status: number, duration: number }[]>}
   */
  async concurrent(requests) {
    return Promise.all(
      requests.map((r) => this.rest(r.method || "GET", r.path, r.body))
    );
  }

  /**
   * Return all recorded API results.
   */
  getResults() {
    return this.results;
  }

  /**
   * Summary stats for the reporter.
   */
  getSummary() {
    const total = this.results.length;
    const errors = this.results.filter((r) => r.error).length;
    const avgDuration =
      total > 0
        ? Math.round(
            this.results.reduce((sum, r) => sum + r.duration, 0) / total
          )
        : 0;
    const slowest = total > 0
      ? this.results.reduce((max, r) => (r.duration > max.duration ? r : max), this.results[0])
      : null;

    return { total, errors, avgDuration, slowest };
  }
}
