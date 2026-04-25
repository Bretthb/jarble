/**
 * Unit tests for pathValidation.ts.
 *
 * pathValidation is a security boundary used by every pod-PVC read/write
 * route in the API (canvas files, artifacts, MCP read/write tools, the
 * generic /files endpoint). A regression that lets a path traversal,
 * null byte, or write into a protected directory through has direct
 * impact: it lets a deployment (or its bot) read or scribble over the
 * runtime's own internal files (npm cache, node_modules, the
 * .initialized marker) and corrupt the pod.
 *
 * The `readOnly` flag was added in JAR-128 to allow the file-browser
 * UI to list the full PVC tree (including node_modules) without giving
 * write access to those directories — that asymmetry is the most
 * surprising part of the contract and is worth several explicit tests.
 *
 * Covers:
 *  1. Empty / null-byte / control-char / traversal rejection
 *  2. Absolute vs relative path resolution under the PVC mount
 *  3. Out-of-mount paths are rejected
 *  4. Protected directory rules — blocked by default, allowed when readOnly=true
 *  5. Subdirectories of protected dirs are also blocked / allowed correctly
 *  6. Edge cases: lookalike prefixes (".initializedoops"), empty path segments
 *  7. escapeShellPath handles single-quote injection
 */

import { describe, it, expect } from "vitest";
import {
  validateFilePath,
  escapeShellPath,
} from "../../utils/pathValidation.js";

const PVC = "/data";

// ── Rejection cases ─────────────────────────────────────────────────────────

describe("validateFilePath — rejection cases", () => {
  it("rejects empty path", () => {
    const r = validateFilePath("", PVC);
    expect(r.valid).toBe(false);
    expect(r.error).toContain("No path");
  });

  it("rejects null bytes (POSIX path-truncation attack)", () => {
    const r = validateFilePath("notes.txt\0/etc/passwd", PVC);
    expect(r.valid).toBe(false);
    expect(r.error).toContain("null bytes");
  });

  it("rejects control characters (terminal escape sequences, etc.)", () => {
    const r = validateFilePath("notes\x07.txt", PVC);
    expect(r.valid).toBe(false);
    expect(r.error).toContain("control characters");
  });

  it("rejects path traversal anywhere in the string", () => {
    expect(validateFilePath("..", PVC).valid).toBe(false);
    expect(validateFilePath("../etc/passwd", PVC).valid).toBe(false);
    expect(validateFilePath("notes/../../../etc/passwd", PVC).valid).toBe(false);
    // Even when traversal is camouflaged inside what looks like a legit path
    expect(validateFilePath("legit/..hidden/file", PVC).valid).toBe(false);
  });

  it("rejects absolute paths outside the PVC mount", () => {
    const r = validateFilePath("/etc/passwd", PVC);
    expect(r.valid).toBe(false);
    expect(r.error).toContain("/data");
  });

  it("rejects paths whose mount-prefix matches but segment is different (lookalike)", () => {
    // /data2/file looks like it starts with /data but isn't under it.
    const r = validateFilePath("/data2/file", PVC);
    expect(r.valid).toBe(false);
  });
});

// ── Acceptance cases ────────────────────────────────────────────────────────

describe("validateFilePath — acceptance cases", () => {
  it("accepts a relative path and resolves under the PVC mount", () => {
    const r = validateFilePath("notes.txt", PVC);
    expect(r.valid).toBe(true);
    expect(r.resolvedPath).toBe("/data/notes.txt");
  });

  it("accepts a nested relative path", () => {
    const r = validateFilePath("docs/2026/notes.md", PVC);
    expect(r.valid).toBe(true);
    expect(r.resolvedPath).toBe("/data/docs/2026/notes.md");
  });

  it("accepts an absolute path that is exactly the PVC mount", () => {
    const r = validateFilePath("/data", PVC);
    expect(r.valid).toBe(true);
    expect(r.resolvedPath).toBe("/data");
  });

  it("accepts an absolute path under the PVC mount", () => {
    const r = validateFilePath("/data/notes.txt", PVC);
    expect(r.valid).toBe(true);
    expect(r.resolvedPath).toBe("/data/notes.txt");
  });
});

// ── Protected-directory rules ───────────────────────────────────────────────

describe("validateFilePath — protected directories", () => {
  // The full set as declared in the SUT.
  const protectedDirs = [".initialized", "runtime", ".npm", ".cache", ".local"];

  it.each(protectedDirs)("blocks writes into %s/ by default", (dir) => {
    const r = validateFilePath(`${dir}/file`, PVC);
    expect(r.valid).toBe(false);
    expect(r.error).toContain(dir);
  });

  it.each(protectedDirs)("blocks writes to the protected dir itself: %s", (dir) => {
    const r = validateFilePath(dir, PVC);
    expect(r.valid).toBe(false);
  });

  it.each(protectedDirs)("blocks writes deep under %s/", (dir) => {
    const r = validateFilePath(`${dir}/deep/nested/file.txt`, PVC);
    expect(r.valid).toBe(false);
    expect(r.error).toContain(dir);
  });

  it("does NOT block lookalike prefixes — '.initializedoops' is fine", () => {
    // Critical: protected-dir matching must be by exact first segment, not
    // prefix. `.initializedoops` is NOT a protected dir.
    const r = validateFilePath(".initializedoops/file", PVC);
    expect(r.valid).toBe(true);
  });

  it("does NOT block sibling files at the root with similar names", () => {
    expect(validateFilePath("runtime.txt", PVC).valid).toBe(true);
    expect(validateFilePath(".npmrc", PVC).valid).toBe(true);
  });

  it("readOnly:true allows reads from protected directories", () => {
    for (const dir of protectedDirs) {
      const r = validateFilePath(`${dir}/file`, PVC, { readOnly: true });
      expect(r.valid).toBe(true);
      expect(r.resolvedPath).toBe(`/data/${dir}/file`);
    }
  });

  it("readOnly:true allows reads of the protected directory itself", () => {
    const r = validateFilePath("runtime", PVC, { readOnly: true });
    expect(r.valid).toBe(true);
    expect(r.resolvedPath).toBe("/data/runtime");
  });

  it("readOnly:true still blocks traversal — security checks run before the readOnly bypass", () => {
    // The readOnly flag only relaxes the protected-dir gate. Path
    // traversal, null bytes, and out-of-mount paths must still fail
    // regardless of the readOnly flag.
    expect(validateFilePath("../etc/passwd", PVC, { readOnly: true }).valid).toBe(false);
    expect(validateFilePath("a\0b", PVC, { readOnly: true }).valid).toBe(false);
    expect(validateFilePath("/etc/passwd", PVC, { readOnly: true }).valid).toBe(false);
  });
});

// ── escapeShellPath ─────────────────────────────────────────────────────────

describe("escapeShellPath", () => {
  it("returns the value unchanged when there are no single quotes", () => {
    expect(escapeShellPath("notes.txt")).toBe("notes.txt");
    expect(escapeShellPath("/data/file with space.md")).toBe("/data/file with space.md");
  });

  it("escapes a single embedded quote so it survives shell quoting", () => {
    // The standard pattern for embedding ' in a single-quoted shell
    // string is: close the quote, escape the literal quote, reopen.
    // Result: ' → '\''
    expect(escapeShellPath("it's")).toBe("it'\\''s");
  });

  it("escapes every single quote in the input", () => {
    expect(escapeShellPath("'a'b'")).toBe("'\\''a'\\''b'\\''");
  });

  it("does not interfere with other shell metacharacters (caller wraps in single quotes)", () => {
    // The callers of escapeShellPath wrap the result in single quotes
    // themselves, so $, `, `\\`, and double quotes pass through and the
    // outer quoting protects them.
    expect(escapeShellPath("$PATH")).toBe("$PATH");
    expect(escapeShellPath("`whoami`")).toBe("`whoami`");
    expect(escapeShellPath('"injected"')).toBe('"injected"');
  });
});
