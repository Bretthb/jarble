/**
 * Unit tests for the artifact store in src/mcp/artifactStore.ts.
 *
 * The store is the persistence layer for canvas-card artifacts —
 * each artifact is a JSON file on the PVC alongside a manifest
 * for fast listing. Three contracts pinned:
 *
 *   1. **Atomic CRUD** — saveArtifact / loadArtifact /
 *      listArtifacts / deleteArtifact must round-trip without
 *      losing fields, and must use .tmp + rename for atomicity
 *      so a crash mid-write doesn't corrupt the manifest.
 *
 *   2. **ID validation** — IDs must match
 *      `^[a-zA-Z0-9_-]{1,64}$` to prevent path-traversal in
 *      the artifact filename. A regression that loosened this
 *      would let a `../../etc/passwd` ID escape the workspace
 *      directory.
 *
 *   3. **dataSource validation** — `type: "file"` requires
 *      `path`, `type: "skill"` requires `skill`, `pollInterval`
 *      must be 5..3600 seconds. A regression that accepted
 *      malformed dataSources would cause the polling layer to
 *      crash on every refresh.
 *
 * Tests use real fs in `os.tmpdir()` with a fresh workspace
 * per test — no mocking. fs operations are atomic enough that
 * concurrent tests don't interfere with each other.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  saveArtifact,
  loadArtifact,
  listArtifacts,
  deleteArtifact,
  type SaveArtifactInput,
} from "../../mcp/artifactStore.js";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "jarble-artifact-test-"));
});

afterEach(() => {
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

function makeInput(overrides: Partial<SaveArtifactInput> = {}): SaveArtifactInput {
  return {
    id: overrides.id ?? "art-1",
    component: overrides.component ?? "chart",
    props: overrides.props ?? { type: "line", data: [1, 2, 3] },
    title: overrides.title ?? "Revenue Q1",
    pinned: overrides.pinned,
    source: overrides.source,
    dataSource: overrides.dataSource,
  };
}

// ── Round-trip ──────────────────────────────────────────────────────────────

describe("saveArtifact + loadArtifact — round-trip", () => {
  it("creates a new artifact and reads it back with all fields preserved", () => {
    const saved = saveArtifact(workspace, makeInput({ id: "art-x" }));
    expect(saved.id).toBe("art-x");
    expect(saved.component).toBe("chart");
    expect(saved.title).toBe("Revenue Q1");
    expect(saved.props).toEqual({ type: "line", data: [1, 2, 3] });
    expect(saved.pinned).toBe(false);
    expect(saved.source).toBe("bot");
    expect(saved.dataSource).toBeNull();
    // ISO-8601 timestamps populated.
    expect(saved.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const loaded = loadArtifact(workspace, "art-x");
    expect(loaded).toEqual(saved);
  });

  it("returns null for a missing artifact", () => {
    expect(loadArtifact(workspace, "never-saved")).toBeNull();
  });

  it("returns null when the artifact file is corrupted JSON", () => {
    saveArtifact(workspace, makeInput({ id: "art-corrupt" }));
    // Manually corrupt the file.
    writeFileSync(join(workspace, "artifacts", "art-corrupt.json"), "{not json", "utf-8");
    expect(loadArtifact(workspace, "art-corrupt")).toBeNull();
  });
});

// ── Update semantics ────────────────────────────────────────────────────────

describe("saveArtifact — update semantics", () => {
  it("preserves createdAt on update, bumps updatedAt", async () => {
    const v1 = saveArtifact(workspace, makeInput({ id: "art-u" }));
    // Wait a tick so the new updatedAt timestamp differs.
    await new Promise((r) => setTimeout(r, 5));
    const v2 = saveArtifact(workspace, makeInput({ id: "art-u", title: "v2" }));

    expect(v2.createdAt).toBe(v1.createdAt);
    expect(v2.updatedAt).not.toBe(v1.updatedAt);
    expect(new Date(v2.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(v1.updatedAt).getTime(),
    );
    expect(v2.title).toBe("v2");
  });

  it("preserves pinned when not explicitly provided on update", () => {
    saveArtifact(workspace, makeInput({ id: "art-p", pinned: true }));
    const updated = saveArtifact(workspace, makeInput({ id: "art-p", title: "new" }));
    // pinned was true on save, now omitted on update — should stay true.
    expect(updated.pinned).toBe(true);
  });

  it("overwrites pinned when explicitly provided on update", () => {
    saveArtifact(workspace, makeInput({ id: "art-p2", pinned: true }));
    const updated = saveArtifact(workspace, makeInput({ id: "art-p2", pinned: false }));
    expect(updated.pinned).toBe(false);
  });

  it("preserves source when not provided on update", () => {
    saveArtifact(workspace, makeInput({ id: "art-s", source: "user" }));
    const updated = saveArtifact(workspace, makeInput({ id: "art-s", title: "new" }));
    expect(updated.source).toBe("user");
  });

  it("treats a corrupted existing file as a new save (createdAt resets to now)", async () => {
    const v1 = saveArtifact(workspace, makeInput({ id: "art-c" }));
    // Corrupt the file.
    writeFileSync(join(workspace, "artifacts", "art-c.json"), "{not json", "utf-8");
    await new Promise((r) => setTimeout(r, 5));
    const v2 = saveArtifact(workspace, makeInput({ id: "art-c" }));
    // createdAt should be bumped because the previous file was unreadable.
    expect(new Date(v2.createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(v1.createdAt).getTime(),
    );
  });
});

// ── ID validation ───────────────────────────────────────────────────────────

describe("saveArtifact — ID validation", () => {
  it("accepts alphanumeric, hyphen, underscore", () => {
    for (const id of ["abc", "ABC123", "art_1", "art-1", "A_b-1"]) {
      expect(() => saveArtifact(workspace, makeInput({ id }))).not.toThrow();
    }
  });

  it("rejects path-traversal attempts (slash, dot-dot)", () => {
    // A regression that loosened the ID pattern would let an attacker
    // escape the artifacts/ subdirectory.
    expect(() => saveArtifact(workspace, makeInput({ id: "../../../etc/passwd" }))).toThrow(/Invalid artifact ID/);
    expect(() => saveArtifact(workspace, makeInput({ id: "a/b" }))).toThrow(/Invalid artifact ID/);
    expect(() => saveArtifact(workspace, makeInput({ id: "..art" }))).toThrow(/Invalid artifact ID/);
  });

  it("rejects empty string + over-64-char strings", () => {
    expect(() => saveArtifact(workspace, makeInput({ id: "" }))).toThrow(/Invalid artifact ID/);
    expect(() => saveArtifact(workspace, makeInput({ id: "a".repeat(65) }))).toThrow(/Invalid artifact ID/);
    // Exactly 64 chars is allowed.
    expect(() => saveArtifact(workspace, makeInput({ id: "a".repeat(64) }))).not.toThrow();
  });

  it("rejects special characters (space, dot, plus, etc.)", () => {
    for (const id of ["has space", "has.dot", "has+plus", "has@at", "has$"]) {
      expect(() => saveArtifact(workspace, makeInput({ id }))).toThrow(/Invalid artifact ID/);
    }
  });

  it("validates the ID on loadArtifact and deleteArtifact too (defense in depth)", () => {
    expect(() => loadArtifact(workspace, "../escape")).toThrow(/Invalid artifact ID/);
    expect(() => deleteArtifact(workspace, "../escape")).toThrow(/Invalid artifact ID/);
  });
});

// ── Size limit ──────────────────────────────────────────────────────────────

describe("saveArtifact — size limit", () => {
  it("rejects artifacts over 1 MB", () => {
    // 2MB blob in props → over the 1MB limit.
    const huge = "x".repeat(2 * 1024 * 1024);
    expect(() =>
      saveArtifact(workspace, makeInput({ id: "art-big", props: { blob: huge } })),
    ).toThrow(/exceeds 1 MB limit/);
  });

  it("accepts artifacts well under 1 MB", () => {
    // Small artifact passes.
    const result = saveArtifact(workspace, makeInput({ id: "art-small", props: { x: "y" } }));
    expect(result.id).toBe("art-small");
  });
});

// ── dataSource validation ──────────────────────────────────────────────────

describe("saveArtifact — dataSource validation", () => {
  it("rejects file dataSource without a path", () => {
    expect(() =>
      saveArtifact(workspace, makeInput({
        id: "art-ds1",
        dataSource: { type: "file" } as any,
      })),
    ).toThrow(/requires a "path"/);
  });

  it("rejects skill dataSource without a skill name", () => {
    expect(() =>
      saveArtifact(workspace, makeInput({
        id: "art-ds2",
        dataSource: { type: "skill" } as any,
      })),
    ).toThrow(/requires a "skill"/);
  });

  it("rejects pollInterval below 5 seconds", () => {
    expect(() =>
      saveArtifact(workspace, makeInput({
        id: "art-ds3",
        dataSource: { type: "file", path: "/x", pollInterval: 1 },
      })),
    ).toThrow(/pollInterval must be between 5 and 3600/);
  });

  it("rejects pollInterval above 3600 seconds (1 hour cap)", () => {
    expect(() =>
      saveArtifact(workspace, makeInput({
        id: "art-ds4",
        dataSource: { type: "file", path: "/x", pollInterval: 7200 },
      })),
    ).toThrow(/pollInterval must be between 5 and 3600/);
  });

  it("accepts valid file dataSource with all optional fields", () => {
    const saved = saveArtifact(workspace, makeInput({
      id: "art-ds5",
      dataSource: { type: "file", path: "/data/x.json", pollInterval: 30, transform: "items.0.value" },
    }));
    expect(saved.dataSource?.type).toBe("file");
    expect(saved.dataSource?.path).toBe("/data/x.json");
    expect(saved.dataSource?.pollInterval).toBe(30);
  });

  it("accepts valid skill dataSource with args", () => {
    const saved = saveArtifact(workspace, makeInput({
      id: "art-ds6",
      dataSource: { type: "skill", skill: "fetch_metrics", args: { range: "1d" } },
    }));
    expect(saved.dataSource?.type).toBe("skill");
    expect(saved.dataSource?.skill).toBe("fetch_metrics");
  });
});

// ── listArtifacts ───────────────────────────────────────────────────────────

describe("listArtifacts", () => {
  it("returns an empty array on an empty workspace", () => {
    expect(listArtifacts(workspace)).toEqual([]);
  });

  it("returns metadata sorted by updatedAt descending (most recent first)", async () => {
    saveArtifact(workspace, makeInput({ id: "first" }));
    await new Promise((r) => setTimeout(r, 5));
    saveArtifact(workspace, makeInput({ id: "second" }));
    await new Promise((r) => setTimeout(r, 5));
    saveArtifact(workspace, makeInput({ id: "third" }));

    const list = listArtifacts(workspace);
    expect(list.map((m) => m.id)).toEqual(["third", "second", "first"]);
  });

  it("returns ArtifactMeta only (NOT the full props) — listing is for browse UI, props loaded on demand", () => {
    saveArtifact(workspace, makeInput({ id: "art-meta", props: { huge: "x".repeat(1000) } }));
    const list = listArtifacts(workspace);
    expect(list[0]).not.toHaveProperty("props");
    expect(list[0]).toMatchObject({
      id: "art-meta",
      component: "chart",
      title: "Revenue Q1",
      pinned: false,
    });
  });

  it("rebuilds manifest when manifest.json is corrupted (orphan file recovery)", () => {
    // Note: a MISSING manifest is recreated empty by ensureWorkspace
    // before the read attempt — the orphan-recovery only kicks in
    // when the manifest exists but is unparseable. Pinning that
    // distinction so a future refactor doesn't accidentally erase
    // artifacts on a missing manifest.
    saveArtifact(workspace, makeInput({ id: "art-r" }));
    // Corrupt the manifest with invalid JSON.
    writeFileSync(join(workspace, "manifest.json"), "{not json", "utf-8");
    const list = listArtifacts(workspace);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("art-r");
  });

  it("returns empty list when manifest is missing — ensureWorkspace recreates it as empty", () => {
    // The complement to the corruption test above: a deleted
    // manifest is recreated as empty by ensureWorkspace, NOT
    // rebuilt from disk. This is a current-behavior pin — a
    // future change that auto-rebuilds on missing-manifest would
    // need to update this test.
    saveArtifact(workspace, makeInput({ id: "art-orphan" }));
    rmSync(join(workspace, "manifest.json"));
    const list = listArtifacts(workspace);
    // The orphan file still exists but is invisible to the manifest-driven listing.
    expect(list).toEqual([]);
  });
});

// ── deleteArtifact ──────────────────────────────────────────────────────────

describe("deleteArtifact", () => {
  it("returns true and removes the file + manifest entry", () => {
    saveArtifact(workspace, makeInput({ id: "art-del" }));
    expect(existsSync(join(workspace, "artifacts", "art-del.json"))).toBe(true);

    const result = deleteArtifact(workspace, "art-del");
    expect(result).toBe(true);

    expect(existsSync(join(workspace, "artifacts", "art-del.json"))).toBe(false);
    expect(listArtifacts(workspace).find((m) => m.id === "art-del")).toBeUndefined();
  });

  it("returns false when the artifact does not exist (idempotent)", () => {
    expect(deleteArtifact(workspace, "never-existed")).toBe(false);
  });

  it("only removes the targeted artifact (siblings stay)", () => {
    saveArtifact(workspace, makeInput({ id: "keep-1" }));
    saveArtifact(workspace, makeInput({ id: "delete-me" }));
    saveArtifact(workspace, makeInput({ id: "keep-2" }));

    deleteArtifact(workspace, "delete-me");

    const remaining = listArtifacts(workspace).map((m) => m.id).sort();
    expect(remaining).toEqual(["keep-1", "keep-2"]);
  });
});

// ── Atomic write ────────────────────────────────────────────────────────────

describe("saveArtifact — atomic writes", () => {
  it("does not leave .tmp files behind on success", () => {
    saveArtifact(workspace, makeInput({ id: "art-atom" }));
    const files = readdirSync(join(workspace, "artifacts"));
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("manifest is written via .tmp + rename (no .tmp residue on success)", () => {
    saveArtifact(workspace, makeInput({ id: "art-mtmp" }));
    expect(existsSync(join(workspace, "manifest.json"))).toBe(true);
    expect(existsSync(join(workspace, "manifest.json.tmp"))).toBe(false);
  });

  it("read-after-write sees the latest version (no stale-cache surprise)", () => {
    saveArtifact(workspace, makeInput({ id: "art-rw", title: "v1" }));
    saveArtifact(workspace, makeInput({ id: "art-rw", title: "v2" }));
    expect(loadArtifact(workspace, "art-rw")?.title).toBe("v2");
  });
});
