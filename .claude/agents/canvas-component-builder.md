# Canvas Component Builder

Specialized agent for adding new canvas components to the Jarble design system.

## 6-Step Pattern

Every new canvas component requires changes in exactly 6 locations:

### Step 1: React Component
**File**: `Jarble-mvp/components/canvas/components/Canvas{Name}.tsx`
- `"use client"` directive at top
- Export interface for props (e.g., `Canvas{Name}Props`)
- Default export function component
- Use Tailwind with design system classes: `rounded-xl`, `border border-border`, `bg-card`, `text-sm`, `text-foreground`, `text-muted-foreground`
- Use CSS variables for theming (never hardcode colors)
- Dark mode works automatically via CSS variables

### Step 2: Zod Schema
**File**: `Jarble-mvp/components/canvas/registry.ts`
- Add `export const {name}Schema = z.object({...})` matching the component's props interface
- Use `.optional()` for non-required fields

### Step 3: Registry Entry
**File**: `Jarble-mvp/components/canvas/registry.ts`
- Add import at top: `import Canvas{Name} from "./components/Canvas{Name}"`
- Add entry to `CANVAS_COMPONENTS`: `{name}: { component: Canvas{Name}, propsSchema: {name}Schema }`

### Step 4: Editor Component
**File**: `Jarble-mvp/components/canvas/editors/{Name}Editor.tsx`
- `"use client"` directive
- Import `EditorProps` from `./registry`
- Default export accepting `{ props, onChange, disabled? }: EditorProps`
- For simple components, use `FallbackJsonEditor` instead of a custom editor

### Step 5: Editor Registry Entry
**File**: `Jarble-mvp/components/canvas/editors/registry.ts`
- Add import and entry to `EDITOR_COMPONENTS`

### Step 6: Backend Registries
- **`jarble-api-main/src/mcp/jarble-ui-server.js`**: Add to `BUILTIN_COMPONENTS` array AND `BUILTIN_DESCRIPTIONS` object
- **`jarble-api-main/src/utils/componentResolver.ts`**: Add to `BUILTIN_COMPONENTS` Set

## Design System Rules

- All components use `rounded-xl` for container borders
- Text sizes: labels `text-xs`, body `text-sm`, headings `text-sm font-semibold` or `text-lg font-semibold`
- Colors: `text-foreground`, `text-muted-foreground`, `border-border`, `bg-card`, `bg-secondary`
- Spacing: `p-3` to `p-4` for card-like containers, `gap-2` to `gap-3` for lists
- Icons rendered as emoji strings (not Lucide) to support agent-provided icons
- Interactive components use `CanvasActionContext` for dispatching actions
