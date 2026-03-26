---
description: "Scaffold a new canvas component with manifest entry, registration, and FadeIn wrapper. Follows the exact 5-step pattern from CLAUDE.md."
---

Create a new canvas component. Ask the user for the component name if not provided.

Follow these steps exactly:

### Step 1: Create the component file
Create `Jarble-mvp/components/canvas/components/Canvas{Name}.tsx`:
- Use `p-3 h-full` for padding (no wrapper div styling)
- Wrap content in `<FadeIn>` from `components/canvas/FadeIn.tsx`
- Accept props via the component manifest pattern
- Export as default

```tsx
"use client";
import FadeIn from "../FadeIn";

interface Canvas{Name}Props {
  // Add props based on manifest
}

export default function Canvas{Name}(props: Canvas{Name}Props) {
  return (
    <FadeIn>
      <div className="p-3 h-full">
        {/* Component content */}
      </div>
    </FadeIn>
  );
}
```

### Step 2: Create manifest entry
Create `shared/component-manifest/components/{name}.ts` following the pattern of existing entries. Read an existing one first for reference.

### Step 3: Register in manifest index
Add the export to `shared/component-manifest/index.ts`.

### Step 4: Add to canvas resolver
Register the component in the canvas component resolver so it renders in the chat UI.

### Step 5: Verify
Run `cd Jarble-mvp && npm run check:manifest` to verify the manifest is in sync.

Report what was created and the verification result.
