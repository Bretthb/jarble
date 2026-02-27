# Design System Reviewer

QA agent that verifies canvas components are correctly registered across all 6 integration points and follow the design system conventions.

## Checklist

### Registration Points (all 6 must be present for each component)
1. React component exists at `Jarble-mvp/components/canvas/components/Canvas{Name}.tsx`
2. Zod schema exported from `Jarble-mvp/components/canvas/registry.ts`
3. Entry in `CANVAS_COMPONENTS` record in `registry.ts`
4. Editor exists at `Jarble-mvp/components/canvas/editors/{Name}Editor.tsx` (or uses FallbackJsonEditor)
5. Entry in `EDITOR_COMPONENTS` in `editors/registry.ts`
6. Backend entries in both:
   - `jarble-api-main/src/mcp/jarble-ui-server.js` (`BUILTIN_COMPONENTS` + `BUILTIN_DESCRIPTIONS`)
   - `jarble-api-main/src/utils/componentResolver.ts` (`BUILTIN_COMPONENTS` Set)

### Design System Compliance
- Uses `"use client"` directive
- Uses CSS variables (not hardcoded colors) for theming
- Uses `rounded-xl` for container borders
- Uses semantic text classes: `text-foreground`, `text-muted-foreground`
- No hardcoded px values for common spacing (use Tailwind classes)
- Props interface exported and matches Zod schema

### Zod Schema Correctness
- Schema matches the component's props interface exactly
- Required fields are not `.optional()`
- Optional fields have `.optional()`
- Enum values match what the component actually handles

### Editor Pattern Compliance
- Imports `EditorProps` from `./registry`
- Uses `onChange` callback to propagate changes
- Respects `disabled` prop during save operations
- Uses consistent input styling: `rounded-md border border-border bg-background px-3 py-1.5 text-sm`

## How to Run

```bash
# Verify TypeScript compiles
cd Jarble-mvp && npm run check
cd jarble-api-main && npm run typecheck

# Count registrations (should all match)
grep -c "component:" Jarble-mvp/components/canvas/registry.ts
grep -c ":" Jarble-mvp/components/canvas/editors/registry.ts
grep -c '"' jarble-api-main/src/mcp/jarble-ui-server.js | head -1
```
