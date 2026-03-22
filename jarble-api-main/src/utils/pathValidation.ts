/**
 * Shared path validation for pod PVC file operations.
 * Extracted from MCP tools (readFile.ts, writeFile.ts) for reuse in file routes.
 */

/** Directories that must not be read from or written to by user file operations */
const PROTECTED_DIRS = [".initialized", "runtime", ".npm", ".cache", ".local"];

export interface PathValidationResult {
  valid: boolean;
  resolvedPath: string;
  error?: string;
}

/**
 * Validate and resolve a user-supplied file path against the PVC mount.
 *
 * - Rejects path traversal (..)
 * - Rejects null bytes and control characters
 * - Blocks access to protected directories
 * - Returns the resolved absolute path on the pod
 */
export function validateFilePath(
  requestedPath: string,
  pvcMountPath: string
): PathValidationResult {
  if (!requestedPath) {
    return { valid: false, resolvedPath: "", error: "No path provided." };
  }

  // Reject null bytes
  if (requestedPath.includes("\0")) {
    return { valid: false, resolvedPath: "", error: "Path contains null bytes." };
  }

  // Reject control characters (ASCII 0-31 except common whitespace)
  if (/[\x01-\x08\x0e-\x1f]/.test(requestedPath)) {
    return { valid: false, resolvedPath: "", error: "Path contains control characters." };
  }

  // Reject path traversal
  if (requestedPath.includes("..")) {
    return { valid: false, resolvedPath: "", error: "Path traversal (..) is not allowed." };
  }

  // Resolve to absolute path under PVC mount
  const resolved = requestedPath.startsWith("/")
    ? requestedPath
    : `${pvcMountPath}/${requestedPath}`;

  // Ensure path is under PVC mount
  if (!resolved.startsWith(`${pvcMountPath}/`) && resolved !== pvcMountPath) {
    return {
      valid: false,
      resolvedPath: "",
      error: `Path must be under ${pvcMountPath}/.`,
    };
  }

  // Block protected directories
  const relativePath = resolved.slice(pvcMountPath.length + 1);
  const firstSegment = relativePath.split("/")[0];
  if (PROTECTED_DIRS.includes(firstSegment)) {
    return {
      valid: false,
      resolvedPath: "",
      error: `Access to ${firstSegment}/ is not allowed.`,
    };
  }

  return { valid: true, resolvedPath: resolved };
}

/**
 * Escape a value for safe use in a single-quoted shell string.
 * Handles embedded single quotes: ' → '\''
 */
export function escapeShellPath(value: string): string {
  return value.replace(/'/g, "'\\''");
}
