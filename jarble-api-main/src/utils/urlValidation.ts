/**
 * URL Validation - SSRF protection for outbound requests.
 *
 * Blocks requests to private/internal networks, cloud metadata endpoints,
 * and non-HTTPS URLs in production. Used by the service proxy, health checks,
 * and ServiceCard schema validation.
 */

/**
 * Private/reserved IPv4 CIDR ranges that must never be contacted.
 * Each entry: [network as 32-bit integer, mask as 32-bit integer].
 */
const BLOCKED_IPV4_CIDRS: Array<[number, number]> = [
  // 10.0.0.0/8 - Private (RFC 1918)
  [0x0a000000, 0xff000000],
  // 172.16.0.0/12 - Private (RFC 1918)
  [0xac100000, 0xfff00000],
  // 192.168.0.0/16 - Private (RFC 1918)
  [0xc0a80000, 0xffff0000],
  // 127.0.0.0/8 - Loopback
  [0x7f000000, 0xff000000],
  // 169.254.0.0/16 - Link-local / Cloud metadata
  [0xa9fe0000, 0xffff0000],
  // 0.0.0.0/8 - "This" network
  [0x00000000, 0xff000000],
  // 100.64.0.0/10 - Carrier-grade NAT (RFC 6598)
  [0x64400000, 0xffc00000],
  // 198.18.0.0/15 - Benchmarking (RFC 2544)
  [0xc6120000, 0xfffe0000],
  // 192.0.0.0/24 - IETF Protocol Assignments
  [0xc0000000, 0xffffff00],
  // 192.0.2.0/24 - TEST-NET-1
  [0xc0000200, 0xffffff00],
  // 198.51.100.0/24 - TEST-NET-2
  [0xc6336400, 0xffffff00],
  // 203.0.113.0/24 - TEST-NET-3
  [0xcb007100, 0xffffff00],
  // 224.0.0.0/4 - Multicast
  [0xe0000000, 0xf0000000],
  // 240.0.0.0/4 - Reserved
  [0xf0000000, 0xf0000000],
];

/**
 * Blocked IPv6 prefixes (checked as string prefix match on expanded address).
 */
const BLOCKED_IPV6_PREFIXES = [
  "::1",        // Loopback
  "fc",         // fc00::/7 - Unique Local (first byte fc or fd)
  "fd",         // fc00::/7 - Unique Local
  "fe80:",      // fe80::/10 - Link-local
  "::ffff:127", // IPv4-mapped loopback
  "::ffff:10.",  // IPv4-mapped 10.x
  "::ffff:192.168.", // IPv4-mapped 192.168.x
  "::ffff:169.254.", // IPv4-mapped link-local
];

/**
 * Hostnames that are always blocked regardless of IP resolution.
 */
const BLOCKED_HOSTNAMES = [
  "localhost",
  "metadata.google.internal",
  "metadata.internal",
];

/**
 * Schemes that are always blocked.
 */
const BLOCKED_SCHEMES = new Set(["file:", "ftp:", "gopher:", "data:", "javascript:"]);

/**
 * Parse an IPv4 address string to a 32-bit integer.
 * Returns null if the string is not a valid IPv4 address.
 */
function parseIPv4(addr: string): number | null {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255 || String(num) !== part) return null;
    result = (result << 8) | num;
  }
  // Convert to unsigned 32-bit
  return result >>> 0;
}

/**
 * Check if an IPv4 address (as 32-bit integer) falls within any blocked CIDR.
 */
function isBlockedIPv4(ip: number): boolean {
  for (const [network, mask] of BLOCKED_IPV4_CIDRS) {
    // Use >>> 0 to ensure unsigned 32-bit comparison (JS bitwise ops produce signed int32)
    if (((ip & mask) >>> 0) === (network >>> 0)) return true;
  }
  return false;
}

/**
 * Check if an IPv6 address string is in a blocked range.
 * Uses prefix matching on the lowercase string representation.
 */
function isBlockedIPv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  return BLOCKED_IPV6_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Validate that a URL is safe for outbound requests (no SSRF).
 *
 * @param url - The URL string to validate
 * @param options.requireHttps - If true, reject http:// URLs (default: true in production)
 * @returns `true` if the URL is safe to fetch, `false` if it should be blocked
 */
export function validateExternalUrl(
  url: string,
  options?: { requireHttps?: boolean },
): boolean {
  const requireHttps =
    options?.requireHttps ?? process.env.NODE_ENV === "production";

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false; // Malformed URL
  }

  // Block dangerous schemes
  if (BLOCKED_SCHEMES.has(parsed.protocol)) {
    return false;
  }

  // Only allow http: and https:
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  // In production, require HTTPS
  if (requireHttps && parsed.protocol !== "https:") {
    return false;
  }

  // Block known-bad hostnames
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return false;
  }

  // Block any hostname ending in .internal or .local
  if (hostname.endsWith(".internal") || hostname.endsWith(".local")) {
    return false;
  }

  // Check if hostname is a raw IPv4 address
  const ipv4 = parseIPv4(hostname);
  if (ipv4 !== null) {
    return !isBlockedIPv4(ipv4);
  }

  // Check if hostname is an IPv6 address
  // Some Node.js versions keep brackets, some strip them
  const bareHostname = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (bareHostname.includes(":")) {
    return !isBlockedIPv6(bareHostname);
  }

  // Regular domain name - allowed (DNS resolution to private IPs is handled
  // at the network layer via egress NetworkPolicy on K8s pods, but we still
  // block obvious hostnames above)
  return true;
}
