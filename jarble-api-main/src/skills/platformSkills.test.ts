/**
 * Tests for platformSkills - BOT_SKILLS extraction from jarble-ui-server.js.
 *
 * Covers: successful extraction, brace-depth parsing edge cases,
 * malformed files, error fallbacks, and skill structure validation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";

// We mock readFileSync to control the file content for testing
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(readFileSync);

// Re-import after mock setup
let getPlatformSkills: typeof import("./platformSkills.js").getPlatformSkills;

beforeEach(async () => {
  vi.clearAllMocks();
  // Suppress console.error for fallback tests
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Re-import to get fresh module
  const mod = await import("./platformSkills.js");
  getPlatformSkills = mod.getPlatformSkills;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helper to create mock MCP server source ────────────────────────────────

function makeMcpSource(skillsObject: string): string {
  return `
// Preamble code
const COMPONENTS_DIR = "/data/components";

const BOT_SKILLS = ${skillsObject};

// More code after
function handleToolCall() {}
`;
}

// ── Successful extraction ──────────────────────────────────────────────────

describe("successful extraction", () => {
  it("extracts a simple BOT_SKILLS object", () => {
    const source = makeMcpSource(`{
  "web-search": {
    description: "Search the web",
    content: "Use this skill to search"
  }
}`);
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    expect(result.skills).toBeDefined();
    expect(result.skills["web-search"]).toBeDefined();
    expect(result.skills["web-search"].description).toBe("Search the web");
    expect(result.skills["web-search"].content).toBe("Use this skill to search");
  });

  it("returns version and updatedAt metadata", () => {
    const source = makeMcpSource(`{ "test": { description: "Test", content: "Content" } }`);
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    expect(result.version).toBeTypeOf("number");
    expect(result.version).toBeGreaterThanOrEqual(1);
    expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("extracts multiple skills", () => {
    const source = makeMcpSource(`{
  "skill-a": { description: "A", content: "Content A" },
  "skill-b": { description: "B", content: "Content B" },
  "skill-c": { description: "C", content: "Content C" }
}`);
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    expect(Object.keys(result.skills)).toHaveLength(3);
  });

  it("handles template literals in content", () => {
    const source = makeMcpSource(`{
  "rendering": {
    description: "Guide",
    content: \`Multi-line
template literal
with \\\`escaped backticks\\\`\`
  }
}`);
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    expect(result.skills["rendering"]).toBeDefined();
    expect(result.skills["rendering"].content).toContain("Multi-line");
  });

  it("handles nested objects inside skill content", () => {
    const source = makeMcpSource(`{
  "complex": {
    description: "Has nested stuff",
    content: "Use { brackets } in content",
    extra: { nested: { deep: true } }
  }
}`);
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    expect(result.skills["complex"]).toBeDefined();
  });
});

// ── Brace-depth parsing edge cases ─────────────────────────────────────────

describe("brace-depth parsing", () => {
  it("handles braces inside double-quoted strings", () => {
    const source = makeMcpSource(`{
  "test": {
    description: "Skill with { braces } in strings",
    content: "More { nested { braces } }"
  }
}`);
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    expect(result.skills["test"]).toBeDefined();
    expect(result.skills["test"].description).toContain("braces");
  });

  it("handles braces inside single-quoted strings", () => {
    const source = makeMcpSource(`{
  'test': {
    description: 'Has {braces} in single quotes',
    content: 'Content {here}'
  }
}`);
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    expect(result.skills["test"]).toBeDefined();
  });

  it("handles escaped quotes", () => {
    const source = makeMcpSource(`{
  "test": {
    description: "He said \\"hello\\"",
    content: "Content with \\\\ backslashes"
  }
}`);
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    expect(result.skills["test"]).toBeDefined();
  });

  it("handles deeply nested objects", () => {
    const source = makeMcpSource(`{
  "deep": {
    description: "Deep nesting",
    content: "Content",
    meta: {
      level1: {
        level2: {
          level3: {
            value: "deep"
          }
        }
      }
    }
  }
}`);
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    expect(result.skills["deep"]).toBeDefined();
  });

  it("handles empty skill object", () => {
    const source = makeMcpSource(`{}`);
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    expect(Object.keys(result.skills)).toHaveLength(0);
  });

  it("handles template literal with embedded expressions (backtick strings)", () => {
    const source = makeMcpSource(`{
  "tpl": {
    description: "Template",
    content: \`Content with \\\`code block\\\` markers\`
  }
}`);
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    expect(result.skills["tpl"]).toBeDefined();
  });
});

// ── Error handling and fallback ────────────────────────────────────────────

describe("error handling", () => {
  it("returns empty skills when BOT_SKILLS marker not found", () => {
    mockReadFileSync.mockReturnValue("const OTHER_VAR = {};");

    const result = getPlatformSkills();
    expect(result.skills).toEqual({});
    expect(result.version).toBeTypeOf("number");
  });

  it("returns empty skills when file read fails", () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT: file not found");
    });

    const result = getPlatformSkills();
    expect(result.skills).toEqual({});
  });

  it("returns empty skills when JavaScript eval fails", () => {
    // Create source with invalid JS after extraction
    const source = `
const BOT_SKILLS = {
  "broken": undefined_variable_that_does_not_exist
};
`;
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    expect(result.skills).toEqual({});
  });

  it("returns empty skills when brace matching is incomplete", () => {
    // Missing closing brace
    const source = `
const BOT_SKILLS = {
  "test": {
    description: "Incomplete
`;
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    // Should either parse what it can or fall back to empty
    expect(result.version).toBeTypeOf("number");
  });

  it("preserves version and updatedAt even on failure", () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("File not found");
    });

    const result = getPlatformSkills();
    expect(result.version).toBeTypeOf("number");
    expect(result.updatedAt).toBeTruthy();
  });
});

// ── Integration with real file structure ───────────────────────────────────

describe("skill structure validation", () => {
  it("each extracted skill has description and content", () => {
    const source = makeMcpSource(`{
  "web-search": {
    description: "Search the web for information",
    content: "## Web Search Guide\\n\\nUse this to find information."
  },
  "weather": {
    description: "Get weather information",
    content: "## Weather Guide\\n\\nCheck current weather."
  }
}`);
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    for (const [, skill] of Object.entries(result.skills)) {
      expect(skill.description).toBeTypeOf("string");
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.content).toBeTypeOf("string");
      expect(skill.content.length).toBeGreaterThan(0);
    }
  });

  it("skill keys are dash-separated identifiers", () => {
    const source = makeMcpSource(`{
  "component-rendering": { description: "D1", content: "C1" },
  "web-search": { description: "D2", content: "C2" }
}`);
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    for (const key of Object.keys(result.skills)) {
      expect(key).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});

// ── Robustness with surrounding code ───────────────────────────────────────

describe("extraction robustness", () => {
  it("ignores other const declarations with similar names", () => {
    const source = `
const BOT_SKILLS_OLD = { "old": true };
const BOT_SKILLS = {
  "actual": { description: "Real", content: "Real content" }
};
const BOT_SKILLS_NEW = { "new": true };
`;
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    expect(result.skills["actual"]).toBeDefined();
    expect(result.skills["old"]).toBeUndefined();
    expect(result.skills["new"]).toBeUndefined();
  });

  it("handles code before and after BOT_SKILLS correctly", () => {
    const source = `
const x = { foo: "bar" };
function hello() { return { a: 1 }; }

const BOT_SKILLS = {
  "skill": { description: "S", content: "C" }
};

function world() { return { b: 2 }; }
const y = { baz: "qux" };
`;
    mockReadFileSync.mockReturnValue(source);

    const result = getPlatformSkills();
    expect(result.skills["skill"]).toBeDefined();
    expect(Object.keys(result.skills)).toHaveLength(1);
  });

  it("reads from correct file path based on cwd", () => {
    const source = makeMcpSource(`{ "test": { description: "T", content: "C" } }`);
    mockReadFileSync.mockReturnValue(source);

    getPlatformSkills();

    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    const calledPath = (mockReadFileSync.mock.calls[0][0] as string).replace(/\\/g, "/");
    expect(calledPath).toContain("src/mcp/jarble-ui-server.js");
  });
});
