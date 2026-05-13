---
description: "DEPRECATED. Jarble no longer ships canvas components — the Agent Harness owns the chat/render layer. Do not invoke."
status: deprecated
---

# new-component — DEPRECATED

Jarble has retired its own canvas component library as a product surface. The per-deployment chat UI is the Agent Harness's own webchat (OpenClaw's webchat today). Legacy canvas code in `Jarble-mvp/components/canvas/` is on a path to deletion, not extension.

If the user invokes `/new-component`, surface this deprecation, then ask what they actually want to do:

- For a per-deployment UI feature → propose it as a contribution to the harness upstream (e.g. OpenClaw).
- For a Jarble-platform UI surface that Jarble does own (dashboard, onboarding wizard, deployment config sidebar, orchestration canvas in `views/Deployments.tsx`) → edit those files directly; they are not "canvas components" in the deprecated sense.

Do not scaffold anything below this line.

---

(Original 5-step scaffold preserved below for reference only — do not execute.)

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
