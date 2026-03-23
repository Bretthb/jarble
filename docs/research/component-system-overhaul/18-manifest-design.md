# Single Component Manifest System — Design Document

**Date**: 2026-02-28
**Agent**: manifest-architect
**Status**: Complete

---

## Problem Analysis

Component data is duplicated across **5 locations** (not 4 — a 5th was discovered):

| # | File | What it stores |
|---|------|---------------|
| 1 | `Jarble-mvp/components/canvas/registry.ts` | Component name → React component + Zod schema (37 entries + 1 alias) |
| 2 | `jarble-api-main/src/mcp/jarble-ui-server.js` | BUILTIN_COMPONENTS array (36 entries), BUILTIN_DESCRIPTIONS (36 entries), COMPONENT_REFERENCE (24 entries with prop schemas), categories for reference grouping |
| 3 | `jarble-api-main/src/utils/componentResolver.ts` | BUILTIN_COMPONENTS Set (38 entries including "canvas" alias) |
| 4 | `jarble-api-main/src/runtimes/handlers/openclaw.ts` | JARBLE_UI_PROMPT constant — full inline component quick reference (37 entries), rendering order, layout hints, design principles |
| 5 | `jarble-api-main/src/mcp/tools/listComponents.ts` | BUILTIN_DESCRIPTIONS (duplicated from #2, 35 entries — slightly different!) |

**Current drift**: The descriptions in `listComponents.ts` (#5) already differ from `jarble-ui-server.js` (#2) — e.g., "chart" says "Bar, line, pie, or area chart (Recharts)" vs "Bar, line, pie, or area chart with data series (recharts)". The COMPONENT_REFERENCE in the MCP server only covers 24 of 37 components.

---

## Manifest Format: TypeScript

TypeScript (not JSON) because:
- Zod schemas can't be serialized to JSON and back without losing transforms
- Type safety in the frontend
- JSON Schema, descriptions, and prompt text derived from it
- Both frontend and backend can import from a shared package

## Directory Structure

```
shared/component-manifest/
├── index.ts              # Main export: COMPONENT_MANIFEST
├── types.ts              # TypeScript types for manifest entries
├── components/           # One file per component (37 files)
├── derive/
│   ├── promptText.ts     # Generate soul.md quick reference
│   ├── mcpReference.ts   # Generate COMPONENT_REFERENCE for MCP
│   └── nameList.ts       # Generate BUILTIN_COMPONENTS array/Set
└── schemas/              # Zod schemas (moved from registry.ts)
    └── index.ts
```

## Manifest Entry Type

```typescript
export interface ComponentManifestEntry {
  name: string;
  description: string;
  reference: string;
  propsSchema: ZodType;
  category: ComponentCategory;
  layout: {
    defaultHint: "full-width" | "half" | "third" | "compact" | "auto";
    defaultSize: { width: number; height: number };
  };
  loading: "static" | "dynamic";
  expensive: boolean;
  aliases?: string[];
  splittable?: {
    itemsKey: string;
    splitComponent: string;
    transformItem: (item: unknown, index: number) => Record<string, unknown>;
    minItems: number;
  };
  tags?: string[];
  builtin: boolean;
  renderOrder: number;
  promptGuidance?: string;
}
```

## Example Entries

See full examples for `chart`, `metric_card`, and `sandbox` in the agent report.

## Consumer Migration

Each system reads from the manifest differently:
1. **Frontend registry**: Imports React components separately, gets Zod schemas from manifest
2. **MCP server**: Build script generates JSON snapshot (plain JS can't import TS)
3. **Component resolver**: `import { ALL_NAMES } from "@jarble/component-manifest"`
4. **Soul.md prompt**: `generatePromptReference(COMPONENT_MANIFEST)` generates inline reference
5. **listComponents.ts**: `generateBuiltinDescriptions(COMPONENT_MANIFEST)`

## Sharing Mechanism

TypeScript path aliases in both `tsconfig.json` files:
```json
{ "paths": { "@jarble/component-manifest": ["../shared/component-manifest/index.ts"] } }
```

## Migration Plan (4 phases, 10 steps)

1. Create shared directory with types
2. Move Zod schemas from registry.ts
3. Create 37 manifest entry files
4. Write verification test (derived output = current hardcoded values)
5. Migrate componentResolver.ts (simplest)
6. Migrate listComponents.ts
7. Migrate registry.ts
8. Migrate types.ts
9. Migrate jarble-ui-server.js (build script)
10. Migrate openclaw.ts (prompt generation)

**Net effect**: Adding a component goes from 5-8 files → 2 files.
