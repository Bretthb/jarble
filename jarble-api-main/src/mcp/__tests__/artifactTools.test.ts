/**
 * Tests for the artifact store module — CRUD operations, validation,
 * manifest integrity, and migration from old file format.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  saveArtifact,
  loadArtifact,
  listArtifacts,
  deleteArtifact,
  migrateOldFiles,
} from "../artifactStore.js";
import type { Artifact, ArtifactMeta } from "../artifactStore.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

let tempDir: string;
let workspaceDir: string;
let filesDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "artifact-test-"));
  workspaceDir = join(tempDir, "workspace");
  filesDir = join(tempDir, "files");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-artifact-1",
    component: "chart",
    props: { type: "bar", data: [{ x: 1, y: 2 }], dataKeys: ["y"] },
    title: "Test Chart",
    ...overrides,
  };
}

// ─── save_artifact ──────────────────────────────────────────────────────────

describe("saveArtifact", () => {
  it("creates a new artifact with defaults", () => {
    const result = saveArtifact(workspaceDir, makeInput());

    expect(result.id).toBe("test-artifact-1");
    expect(result.component).toBe("chart");
    expect(result.title).toBe("Test Chart");
    expect(result.pinned).toBe(false);
    expect(result.source).toBe("bot");
    expect(result.dataSource).toBeNull();
    expect(result.createdAt).toBeTruthy();
    expect(result.updatedAt).toBeTruthy();
    expect(result.props).toEqual({
      type: "bar",
      data: [{ x: 1, y: 2 }],
      dataKeys: ["y"],
    });
  });

  it("updates an existing artifact — updatedAt bumps, createdAt preserved", async () => {
    const first = saveArtifact(workspaceDir, makeInput());
    const firstCreatedAt = first.createdAt;

    // Small delay to ensure timestamps differ
    await new Promise((r) => setTimeout(r, 10));

    const updated = saveArtifact(
      workspaceDir,
      makeInput({ title: "Updated Chart", props: { type: "line", data: [], dataKeys: [] } })
    );

    expect(updated.createdAt).toBe(firstCreatedAt);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.updatedAt).getTime()
    );
    expect(updated.title).toBe("Updated Chart");
    expect(updated.props).toEqual({ type: "line", data: [], dataKeys: [] });
  });

  it("rejects invalid artifact IDs", () => {
    expect(() =>
      saveArtifact(workspaceDir, makeInput({ id: "has spaces!" }))
    ).toThrow("Invalid artifact ID");

    expect(() =>
      saveArtifact(workspaceDir, makeInput({ id: "" }))
    ).toThrow("Invalid artifact ID");

    expect(() =>
      saveArtifact(workspaceDir, makeInput({ id: "a".repeat(65) }))
    ).toThrow("Invalid artifact ID");

    expect(() =>
      saveArtifact(workspaceDir, makeInput({ id: "../escape" }))
    ).toThrow("Invalid artifact ID");
  });

  it("accepts valid artifact IDs at boundary lengths", () => {
    const short = saveArtifact(workspaceDir, makeInput({ id: "a" }));
    expect(short.id).toBe("a");

    const long = saveArtifact(
      workspaceDir,
      makeInput({ id: "b".repeat(64) })
    );
    expect(long.id).toBe("b".repeat(64));

    const withDash = saveArtifact(
      workspaceDir,
      makeInput({ id: "my-artifact_123" })
    );
    expect(withDash.id).toBe("my-artifact_123");
  });

  it("rejects artifacts exceeding 1 MB", () => {
    // Create a large props object (> 1 MB when serialized)
    const bigString = "x".repeat(1024 * 1024);
    expect(() =>
      saveArtifact(workspaceDir, makeInput({ props: { data: bigString } }))
    ).toThrow("exceeds 1 MB limit");
  });

  it("defaults pinned to false on create", () => {
    const result = saveArtifact(workspaceDir, makeInput());
    expect(result.pinned).toBe(false);
  });

  it("preserves pinned on update when not explicitly provided", () => {
    saveArtifact(workspaceDir, makeInput({ pinned: true }));
    const updated = saveArtifact(
      workspaceDir,
      makeInput({ title: "New Title" })
    );
    expect(updated.pinned).toBe(true);
  });

  it("overrides pinned when explicitly provided on update", () => {
    saveArtifact(workspaceDir, makeInput({ pinned: true }));
    const updated = saveArtifact(
      workspaceDir,
      makeInput({ pinned: false })
    );
    expect(updated.pinned).toBe(false);
  });

  it("saves with explicit source", () => {
    const result = saveArtifact(
      workspaceDir,
      makeInput({ source: "user" })
    );
    expect(result.source).toBe("user");
  });

  it("preserves source on update when not explicitly provided", () => {
    saveArtifact(workspaceDir, makeInput({ source: "user" }));
    const updated = saveArtifact(
      workspaceDir,
      makeInput({ title: "New Title" })
    );
    expect(updated.source).toBe("user");
  });

  it("saves with dataSource", () => {
    const ds = {
      type: "skill" as const,
      skill: "weather",
      args: { city: "NYC" },
      pollInterval: 60,
      transform: "data.current",
    };
    const result = saveArtifact(
      workspaceDir,
      makeInput({ dataSource: ds })
    );
    expect(result.dataSource).toEqual(ds);
  });
});

// ─── load_artifact ──────────────────────────────────────────────────────────

describe("loadArtifact", () => {
  it("returns full artifact data", () => {
    saveArtifact(workspaceDir, makeInput({ source: "user", pinned: true }));
    const loaded = loadArtifact(workspaceDir, "test-artifact-1");

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("test-artifact-1");
    expect(loaded!.component).toBe("chart");
    expect(loaded!.title).toBe("Test Chart");
    expect(loaded!.pinned).toBe(true);
    expect(loaded!.source).toBe("user");
    expect(loaded!.props).toEqual({
      type: "bar",
      data: [{ x: 1, y: 2 }],
      dataKeys: ["y"],
    });
  });

  it("returns null for missing artifact", () => {
    const result = loadArtifact(workspaceDir, "nonexistent");
    expect(result).toBeNull();
  });

  it("returns null for corrupted artifact file", () => {
    saveArtifact(workspaceDir, makeInput());
    // Corrupt the file
    writeFileSync(
      join(workspaceDir, "artifacts", "test-artifact-1.json"),
      "NOT JSON",
      "utf-8"
    );
    const result = loadArtifact(workspaceDir, "test-artifact-1");
    expect(result).toBeNull();
  });
});

// ─── list_artifacts ─────────────────────────────────────────────────────────

describe("listArtifacts", () => {
  it("returns empty array for new workspace", () => {
    const result = listArtifacts(workspaceDir);
    expect(result).toEqual([]);
  });

  it("returns metadata for all artifacts", () => {
    saveArtifact(workspaceDir, makeInput({ id: "art-1", title: "First" }));
    saveArtifact(workspaceDir, makeInput({ id: "art-2", title: "Second" }));

    const result = listArtifacts(workspaceDir);
    expect(result).toHaveLength(2);
    // Should contain metadata fields but NOT full props
    for (const meta of result) {
      expect(meta).toHaveProperty("id");
      expect(meta).toHaveProperty("component");
      expect(meta).toHaveProperty("title");
      expect(meta).toHaveProperty("createdAt");
      expect(meta).toHaveProperty("updatedAt");
      expect(meta).toHaveProperty("pinned");
      expect(meta).not.toHaveProperty("props");
      expect(meta).not.toHaveProperty("source");
    }
  });

  it("returns sorted by updatedAt descending (most recent first)", async () => {
    saveArtifact(workspaceDir, makeInput({ id: "old", title: "Old" }));
    await new Promise((r) => setTimeout(r, 10));
    saveArtifact(workspaceDir, makeInput({ id: "new", title: "New" }));

    const result = listArtifacts(workspaceDir);
    expect(result[0].id).toBe("new");
    expect(result[1].id).toBe("old");
  });

  it("reflects updates in sort order", async () => {
    saveArtifact(workspaceDir, makeInput({ id: "first", title: "First" }));
    await new Promise((r) => setTimeout(r, 10));
    saveArtifact(workspaceDir, makeInput({ id: "second", title: "Second" }));
    await new Promise((r) => setTimeout(r, 10));
    // Update the first one — should now be most recent
    saveArtifact(workspaceDir, makeInput({ id: "first", title: "First Updated" }));

    const result = listArtifacts(workspaceDir);
    expect(result[0].id).toBe("first");
    expect(result[0].title).toBe("First Updated");
  });
});

// ─── delete_artifact ────────────────────────────────────────────────────────

describe("deleteArtifact", () => {
  it("removes artifact file and manifest entry", () => {
    saveArtifact(workspaceDir, makeInput());
    const result = deleteArtifact(workspaceDir, "test-artifact-1");

    expect(result).toBe(true);
    expect(loadArtifact(workspaceDir, "test-artifact-1")).toBeNull();
    expect(listArtifacts(workspaceDir)).toHaveLength(0);

    // Verify file is gone
    expect(
      existsSync(join(workspaceDir, "artifacts", "test-artifact-1.json"))
    ).toBe(false);
  });

  it("is idempotent for missing artifacts", () => {
    const result = deleteArtifact(workspaceDir, "nonexistent");
    expect(result).toBe(false);
  });

  it("handles deleting when file is missing but manifest entry exists", () => {
    saveArtifact(workspaceDir, makeInput());
    // Remove just the file
    rmSync(join(workspaceDir, "artifacts", "test-artifact-1.json"));

    const result = deleteArtifact(workspaceDir, "test-artifact-1");
    expect(result).toBe(true);
    expect(listArtifacts(workspaceDir)).toHaveLength(0);
  });

  it("does not affect other artifacts", () => {
    saveArtifact(workspaceDir, makeInput({ id: "keep" }));
    saveArtifact(workspaceDir, makeInput({ id: "remove" }));

    deleteArtifact(workspaceDir, "remove");

    expect(listArtifacts(workspaceDir)).toHaveLength(1);
    expect(loadArtifact(workspaceDir, "keep")).not.toBeNull();
  });
});

// ─── Manifest Integrity ─────────────────────────────────────────────────────

describe("manifest integrity", () => {
  it("creates workspace directory if missing", () => {
    const result = listArtifacts(workspaceDir);
    expect(result).toEqual([]);
    expect(existsSync(workspaceDir)).toBe(true);
    expect(existsSync(join(workspaceDir, "artifacts"))).toBe(true);
    expect(existsSync(join(workspaceDir, "manifest.json"))).toBe(true);
  });

  it("creates manifest.json if missing", () => {
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(join(workspaceDir, "artifacts"), { recursive: true });
    // No manifest.json yet

    const result = listArtifacts(workspaceDir);
    expect(result).toEqual([]);
    expect(existsSync(join(workspaceDir, "manifest.json"))).toBe(true);

    // Verify manifest structure
    const manifest = JSON.parse(
      readFileSync(join(workspaceDir, "manifest.json"), "utf-8")
    );
    expect(manifest.version).toBe(1);
    expect(manifest.artifacts).toEqual([]);
  });

  it("creates artifacts directory if missing", () => {
    mkdirSync(workspaceDir, { recursive: true });
    // No artifacts/ dir

    saveArtifact(workspaceDir, makeInput());
    expect(existsSync(join(workspaceDir, "artifacts"))).toBe(true);
  });

  it("manifest matches artifact files after multiple operations", () => {
    saveArtifact(workspaceDir, makeInput({ id: "a" }));
    saveArtifact(workspaceDir, makeInput({ id: "b" }));
    saveArtifact(workspaceDir, makeInput({ id: "c" }));
    deleteArtifact(workspaceDir, "b");
    saveArtifact(workspaceDir, makeInput({ id: "a", title: "Updated A" }));

    const list = listArtifacts(workspaceDir);
    expect(list).toHaveLength(2);

    const ids = list.map((a) => a.id).sort();
    expect(ids).toEqual(["a", "c"]);

    // Verify each manifest entry has a corresponding file
    for (const meta of list) {
      const filePath = join(workspaceDir, "artifacts", `${meta.id}.json`);
      expect(existsSync(filePath)).toBe(true);
    }
  });
});

// ─── migrateOldFiles ────────────────────────────────────────────────────────

describe("migrateOldFiles", () => {
  it("converts old format files to new artifact format", () => {
    mkdirSync(filesDir, { recursive: true });
    const oldFile = {
      component: "chart",
      props: { type: "bar", data: [{ x: 1 }], dataKeys: ["x"] },
      name: "Sales Chart",
      description: "Monthly sales data",
      tags: ["sales"],
      savedAt: "2025-01-15T10:00:00.000Z",
    };
    writeFileSync(
      join(filesDir, "sales-chart.json"),
      JSON.stringify(oldFile),
      "utf-8"
    );

    const count = migrateOldFiles(filesDir, workspaceDir);
    expect(count).toBe(1);

    const artifacts = listArtifacts(workspaceDir);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].id).toBe("sales-chart");
    expect(artifacts[0].component).toBe("chart");
    expect(artifacts[0].title).toBe("Sales Chart");

    const full = loadArtifact(workspaceDir, "sales-chart");
    expect(full).not.toBeNull();
    expect(full!.createdAt).toBe("2025-01-15T10:00:00.000Z");
    expect(full!.pinned).toBe(false);
    expect(full!.source).toBe("bot");
    expect(full!.dataSource).toBeNull();
    expect(full!.props).toEqual({
      type: "bar",
      data: [{ x: 1 }],
      dataKeys: ["x"],
    });
  });

  it("uses description as title fallback when name is missing", () => {
    mkdirSync(filesDir, { recursive: true });
    writeFileSync(
      join(filesDir, "widget.json"),
      JSON.stringify({
        component: "card",
        props: { body: "Hello" },
        description: "My Widget",
      }),
      "utf-8"
    );

    migrateOldFiles(filesDir, workspaceDir);
    const artifact = loadArtifact(workspaceDir, "widget");
    expect(artifact!.title).toBe("My Widget");
  });

  it("uses filename as title fallback when name and description missing", () => {
    mkdirSync(filesDir, { recursive: true });
    writeFileSync(
      join(filesDir, "data-view.json"),
      JSON.stringify({
        component: "data_table",
        props: { columns: ["A"], rows: [["1"]] },
      }),
      "utf-8"
    );

    migrateOldFiles(filesDir, workspaceDir);
    const artifact = loadArtifact(workspaceDir, "data-view");
    expect(artifact!.title).toBe("data-view");
  });

  it("skips malformed files", () => {
    mkdirSync(filesDir, { recursive: true });
    writeFileSync(join(filesDir, "bad.json"), "NOT JSON", "utf-8");
    writeFileSync(
      join(filesDir, "good.json"),
      JSON.stringify({ component: "card", props: { body: "Hi" } }),
      "utf-8"
    );
    // Missing component
    writeFileSync(
      join(filesDir, "no-component.json"),
      JSON.stringify({ props: { x: 1 } }),
      "utf-8"
    );
    // Missing props
    writeFileSync(
      join(filesDir, "no-props.json"),
      JSON.stringify({ component: "card" }),
      "utf-8"
    );

    const count = migrateOldFiles(filesDir, workspaceDir);
    expect(count).toBe(1);
    expect(listArtifacts(workspaceDir)).toHaveLength(1);
  });

  it("returns 0 when filesDir does not exist", () => {
    const count = migrateOldFiles(join(tempDir, "nonexistent"), workspaceDir);
    expect(count).toBe(0);
  });

  it("migrates multiple files", () => {
    mkdirSync(filesDir, { recursive: true });
    for (let i = 0; i < 5; i++) {
      writeFileSync(
        join(filesDir, `item-${i}.json`),
        JSON.stringify({
          component: "card",
          props: { body: `Card ${i}` },
          name: `Card ${i}`,
        }),
        "utf-8"
      );
    }

    const count = migrateOldFiles(filesDir, workspaceDir);
    expect(count).toBe(5);
    expect(listArtifacts(workspaceDir)).toHaveLength(5);
  });

  it("sanitizes filenames with special characters", () => {
    mkdirSync(filesDir, { recursive: true });
    writeFileSync(
      join(filesDir, "my file (1).json"),
      JSON.stringify({ component: "card", props: { body: "Hi" }, name: "Test" }),
      "utf-8"
    );

    migrateOldFiles(filesDir, workspaceDir);
    const artifacts = listArtifacts(workspaceDir);
    expect(artifacts).toHaveLength(1);
    // Spaces and parens replaced with underscores
    expect(artifacts[0].id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("ignores non-json files", () => {
    mkdirSync(filesDir, { recursive: true });
    writeFileSync(join(filesDir, "readme.txt"), "Hello", "utf-8");
    writeFileSync(
      join(filesDir, "valid.json"),
      JSON.stringify({ component: "card", props: {} }),
      "utf-8"
    );

    const count = migrateOldFiles(filesDir, workspaceDir);
    expect(count).toBe(1);
  });
});
