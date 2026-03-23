# Theme Transition Prompt for Cursor Agent

**Context:** Apply the visual design and theme from the Jarble waitlist site to our main app. **Keep all existing logic and code structure**—only change the look (colors, typography, spacing, animations, component styling). Do not refactor or change behavior.

---

## 1. Color Palette (Clean Paper Theme)

Apply these exact colors throughout the app:

| Purpose | CSS Variable | Hex Value |
|---------|--------------|-----------|
| **Background** | `--background` | `#ffffff` |
| **Foreground** | `--foreground` | `#1a1a1a` |
| **Primary** | `--primary` | `#000000` |
| **Primary text on primary** | `--primary-foreground` | `#ffffff` |
| **Secondary / surfaces** | `--secondary` | `#f4f4f5` |
| **Muted background** | `--muted` | `#fafafa` |
| **Muted text** | `--muted-foreground` | `#666666` |
| **Border** | `--border` | `#e4e4e7` |
| **Input border** | `--input` | `#e4e4e7` |
| **Card** | `--card` | `#ffffff` |
| **Radius** | `--radius` | `0.75rem` |

**Usage patterns:**
- Nav links: `text-muted-foreground hover:text-primary transition-colors`
- Primary buttons: `bg-primary text-primary-foreground hover:bg-primary/90`
- Form inputs: `bg-background/50` or `bg-background/50`
- Cards: `bg-card/80 backdrop-blur-md border border-border`

---

## 2. Typography

**Fonts:**
- **Sans:** Inter (body text, labels, UI)
- **Serif:** Playfair Display (headings h1–h6)

Add to `@theme` or Tailwind config:
```css
--font-sans: 'Inter', sans-serif;
--font-serif: 'Playfair Display', serif;
```

**Apply to headings:**
```css
h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-serif);
}
```

**Sizes:**
- Hero headline: `text-6xl lg:text-7xl font-serif font-medium leading-[1.1] tracking-tight`
- Section headings: `text-4xl font-serif font-medium`
- Subsection: `text-3xl font-serif font-medium` or `text-2xl font-semibold`
- Body: `text-xl` or `text-lg`, `text-muted-foreground`
- Labels: `text-sm font-medium text-muted-foreground`

---

## 3. Watercolor Blob Background (CRITICAL)

The home page has a soft **watercolor blob** background. Multiple blurred, semi-transparent blobs with pastel colors create an organic, paper-like feel.

**Blob colors** (hex):
- `#bfdbfe` (blue)
- `#ddd6fe` (lavender)
- `#fbcfe8` (pink)
- `#99f6e4` (teal)
- `#c7d2fe` (indigo)

**Implementation:**
- Random positions (top, left, width, height) on each page load
- `filter: blur(100–140px)` on each blob
- Opacity: 0.45–0.5
- Organic `border-radius` values like `60% 40% 50% 70% / 50% 60% 40% 60%`
- Fixed position, behind content (`z-index: 0`), `pointer-events: none`

**Mobile optimizations:**
- Reduce blur to 40px on mobile
- Reduce opacity to 0.3 on mobile
- Consider pausing blob morph animations on mobile for performance

**CSS for blob:**
```css
.watercolor-blob {
  position: absolute;
  z-index: 0;
  pointer-events: none;
  filter: blur(var(--blob-blur, 100px));
}
```

---

## 4. CSS Animations (CRITICAL – No Framer Motion)

The site uses **CSS keyframe animations**, not Framer Motion. This is the main visual differentiator.

**Hero / above-the-fold:**
```css
@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-up {
  animation: fade-in-up 0.6s ease-out forwards;
}
```

**Faster variant (tab content, lists):**
```css
@keyframes fade-in-up-fast {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-up-fast {
  animation: fade-in-up-fast 0.2s ease-out forwards;
}
```

**Scale-in (hero media, images):**
```css
@keyframes fade-in-scale {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
.animate-fade-in-scale {
  animation: fade-in-scale 0.8s ease-out 0.2s forwards;
  opacity: 0;
}
```

**Apply to elements:**
- Hero text block: `animate-fade-in-up`
- Hero video/image: `animate-fade-in-scale`
- Feature cards/list items: `animate-fade-in-up-fast` (in grid/parent with `animate-fade-in-up-fast`)
- Legal pages: `animate-fade-in-up` on main content wrapper

---

## 5. Buttons

**Primary CTA:**
```tsx
className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium"
```

**Outline (secondary CTA):**
```tsx
className="rounded-full border-input bg-background/50 backdrop-blur-sm hover:bg-secondary/50"
```

**Pills:** Use `rounded-full` for all primary buttons.

---

## 6. Layout & Spacing

- **Max width:** `max-w-7xl` for nav/footer, `max-w-6xl` or `max-w-5xl` for hero/sections
- **Padding:** `px-4 sm:px-6 lg:px-8`
- **Section padding:** `py-24` for sections, `pt-32 pb-20 lg:pt-48 lg:pb-32` for hero
- **Scroll margin:** `scroll-mt-20` on sections with hash anchors

---

## 7. Badge / Pill (e.g. "No-Code AI Platform")

```tsx
className="inline-flex items-center px-3 py-1 rounded-full bg-secondary/80 backdrop-blur-sm text-xs font-medium text-muted-foreground border border-border/50"
```

---

## 8. Navbar

- **Background:** `bg-background/80 backdrop-blur-md`
- **Fixed:** `fixed inset-x-0 top-0 z-50`
- **Brand:** `font-serif font-bold text-2xl tracking-tight`
- **Links:** `text-sm font-medium text-muted-foreground hover:text-primary transition-colors`
- **Mobile:** Hamburger (Menu/X icons), dropdown with `border-t border-border bg-background`

---

## 9. Form / Card Sections

- **Form container:** `bg-card/80 backdrop-blur-md border border-border rounded-2xl p-8 shadow-sm`
- **Form section background:** `bg-secondary/30 backdrop-blur-sm`
- **Inputs:** `bg-background/50` for light fill

---

## 10. Feature Tabs (if applicable)

- **Tab buttons:** `rounded-full`, active: `bg-primary text-primary-foreground`, inactive: `bg-secondary/80 text-muted-foreground hover:bg-secondary hover:text-foreground`
- **Tab content cards:** `p-6 rounded-xl border border-border bg-card/60 backdrop-blur-sm`
- **Checkmark:** `text-green-600` for feature list items

---

## 11. Hero Media

- **Desktop:** Video or large image with `animate-fade-in-scale`
- **Glow effect:** `absolute inset-0 bg-gradient-to-tr from-gray-100 to-transparent rounded-full blur-3xl opacity-60` behind media
- **Mobile:** Can use a smaller image or hide; ensure hero text remains readable

---

## 12. Theme Default

- Use **light theme by default**: `defaultTheme="light"` on ThemeProvider
- No dark mode needed unless the app already supports it

---

## 13. Summary Checklist

- [ ] Light theme: white background, black primary, #666 muted
- [ ] Fonts: Inter (body) + Playfair Display (headings)
- [ ] Watercolor blobs: pastel colors, blur, random positions
- [ ] CSS animations: `fade-in-up`, `fade-in-up-fast`, `fade-in-scale`
- [ ] Buttons: `rounded-full`, primary = black
- [ ] Nav: `backdrop-blur-md`, `bg-background/80`
- [ ] Cards: `bg-card/80 backdrop-blur-md border border-border rounded-2xl`
- [ ] **Do not change logic, routing, or component structure**—only styling and animations
