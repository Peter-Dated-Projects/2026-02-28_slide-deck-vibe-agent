# DESIGN.md — UI Design System Reference

> **Purpose:** This document catalogs every CSS token, Tailwind convention, and UI pattern used
> in this repository so that any model or developer can reproduce the look-and-feel without
> reading every file.

---

## 1. Technology Stack

| Layer       | Technology                                |
|-------------|-------------------------------------------|
| Framework   | React 18 + TypeScript (Vite)              |
| Styling     | **Tailwind CSS v3** with custom theme     |
| Icons       | `lucide-react`                            |
| Fonts       | **Inter** (Google Fonts), system fallback |
| Routing     | `react-router-dom` v6                     |
| Utilities   | Custom `cn()` classname joiner, `formatPrice()` |

---

## 2. Theme Tokens (CSS Custom Properties)

Defined in `frontend/src/index.css` inside `@layer base { :root { … } }`.  
All color tokens use **raw HSL values** (no `hsl()` wrapper) — the wrapper is applied in `tailwind.config.ts`.

### 2.1 Color Tokens

| Token                    | HSL Value          | Resolved Color  | Usage                              |
|--------------------------|--------------------|-----------------|-------------------------------------|
| `--background`           | `0 0% 100%`       | White           | Page background                    |
| `--foreground`           | `0 0% 20%`        | Dark gray       | Default text color                 |
| `--card`                 | `0 0% 100%`       | White           | Card surfaces                      |
| `--card-foreground`      | `0 0% 20%`        | Dark gray       | Text on cards                      |
| `--popover`              | `0 0% 100%`       | White           | Popover/dropdown surfaces          |
| `--popover-foreground`   | `0 0% 20%`        | Dark gray       | Text in popovers                   |
| `--primary`              | `311 100% 28%`    | **Purple**      | Primary actions, header bg, focus rings |
| `--primary-foreground`   | `0 0% 100%`       | White           | Text on primary surfaces           |
| `--secondary`            | `0 0% 96%`        | Light gray      | Secondary elements                 |
| `--secondary-foreground` | `0 0% 20%`        | Dark gray       | Text on secondary                  |
| `--muted`                | `0 0% 96%`        | Light gray      | Muted backgrounds, hover states    |
| `--muted-foreground`     | `0 0% 45%`        | Medium gray     | Subdued text, labels, metadata     |
| `--accent`               | `311 100% 20%`    | Darker purple   | Accent highlights                  |
| `--accent-foreground`    | `0 0% 100%`       | White           | Text on accent                     |
| `--destructive`          | `0 84.2% 60.2%`   | **Red**         | Destructive actions, errors        |
| `--destructive-foreground`| `0 0% 98%`       | Near-white      | Text on destructive                |
| `--border`               | `0 0% 90%`        | Light gray      | Borders (applied globally via `*`) |
| `--input`                | `0 0% 90%`        | Light gray      | Input borders                      |
| `--ring`                 | `311 100% 28%`    | Purple          | Focus ring color                   |

### 2.2 Spacing & Shape Tokens

| Token                | Value                                                                 | Usage              |
|----------------------|-----------------------------------------------------------------------|--------------------|
| `--radius`           | `0.5rem`                                                              | Base border radius |
| `--shadow-card`      | `0 1px 3px 0 hsl(0 0% 0% / 0.1), 0 1px 2px -1px hsl(0 0% 0% / 0.1)` | Card resting shadow |
| `--shadow-card-hover`| `0 4px 6px -1px hsl(0 0% 0% / 0.1), 0 2px 4px -2px hsl(0 0% 0% / 0.1)` | Card hover shadow |

---

## 3. Tailwind Config Extensions

Defined in `frontend/tailwind.config.ts`. All custom tokens map to the CSS variables above.

### 3.1 Extended Colors

All color values are `hsl(var(--token))`:

```
background, foreground, border, input, ring
primary      / primary-foreground
secondary    / secondary-foreground
destructive  / destructive-foreground
muted        / muted-foreground
accent       / accent-foreground
card         / card-foreground
popover      / popover-foreground
```

### 3.2 Extended Border Radius

| Tailwind Class | Value                      |
|----------------|----------------------------|
| `rounded-lg`   | `var(--radius)` = `0.5rem` |
| `rounded-md`   | `calc(var(--radius) - 2px)` |
| `rounded-sm`   | `calc(var(--radius) - 4px)` |

### 3.3 Extended Box Shadows

| Tailwind Class      | Value                    |
|---------------------|--------------------------|
| `shadow-card`       | `var(--shadow-card)`     |
| `shadow-card-hover` | `var(--shadow-card-hover)` |

---

## 4. Global Base Styles

```css
/* Applied via @layer base in index.css */
* { @apply border-border; }   /* all borders default to --border color */

body {
  @apply bg-background text-foreground;
  font-family: "Inter", system-ui, -apple-system, sans-serif;
}
```

---

## 5. Hardcoded Colors (Outside the Theme)

These colors appear directly in component classes, outside the token system:

| Color Code       | Where Used                                  | Purpose                             |
|------------------|---------------------------------------------|--------------------------------------|
| `#2E3330`        | Primary dark CTA buttons                    | Dark greenish-black background       |
| `#3a3f3c`        | Hover state for `#2E3330` buttons            | Slightly lighter on hover            |
| `emerald-*`      | Status badges, success icons, save buttons  | "Active" status, success states      |
| `amber-*`        | Status badges, low-stock warnings           | "Draft" status, warning states       |
| `gray-*`         | Archived status badge                       | "Archived" status                    |
| `slate-800`      | Header subtitle text                        | Contrast on green header             |

---

## 6. Component Catalog & Class Patterns

### 6.1 Layout Shell (`App.tsx`)

```
Root:          h-screen w-screen flex bg-background text-foreground overflow-hidden font-sans
Loading state: h-screen w-screen flex items-center justify-center bg-background text-foreground
```

### 6.2 Authentication (`LoginPage.tsx`)

```
Page Wrapper:  min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden
Backgrounds:   absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-primary/20 rounded-full blur-[120px] pointer-events-none (top)
               absolute bottom-0 right-0 w-[600px] h-[400px] bg-primary/10 rounded-full blur-[100px] pointer-events-none (bottom)
Logo Icon:     bg-primary/10 p-4 rounded-2xl border border-primary/20
Logo text:     text-center text-4xl font-extrabold text-foreground tracking-tight
Subtext:       text-center text-muted-foreground max-w-sm mx-auto
Login Card:    bg-card/50 backdrop-blur-xl py-12 px-4 shadow-card rounded-2xl sm:px-10 border border-border mx-4 sm:mx-0
Card title:    text-xl font-semibold text-card-foreground
Card subtext:  text-sm text-muted-foreground
```

### 6.3 Chat Interface (`ChatPage.tsx` - Left Panel)

```
Sidebar Wrapper: w-1/3 min-w-[350px] max-w-lg border-r border-border flex flex-col bg-card/50 backdrop-blur-3xl z-10 relative shadow-card
Header:          h-16 border-b border-border flex items-center justify-between px-6 shrink-0 bg-muted/50
Logo Box:        w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30
Header Title:    font-semibold text-foreground tracking-wide
Header Action:   text-muted-foreground hover:text-foreground transition-colors p-2 rounded-lg hover:bg-muted flex items-center gap-2
Chat Area:       flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth custom-scrollbar
Empty State:     h-full flex flex-col items-center justify-center text-center space-y-4 text-muted-foreground mt-12
Sparkle Box:     w-16 h-16 rounded-2xl bg-muted flex items-center justify-center border border-border
Message User:    bg-primary text-primary-foreground rounded-tr-sm shadow-card shadow-sm (max-w-[85%] rounded-2xl px-5 py-3.5 mt-2)
Message Agent:   bg-surface text-foreground rounded-tl-sm border border-border (same wrapper classes)
Message Text:    text-[15px] leading-relaxed whitespace-pre-wrap
Loading Ind.:    bg-surface rounded-2xl rounded-tl-sm px-5 py-4 border border-border flex items-center gap-3
Input Area:      p-4 bg-card border-t border-border shrink-0
Input Box:       w-full bg-background border border-border rounded-xl pl-4 pr-12 py-3.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all placeholder:text-muted-foreground
Submit Btn:      absolute right-2 p-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed
Notice Text:     text-[10px] text-center text-muted-foreground mt-3
```

### 6.4 Slide Canvas (`ChatPage.tsx` - Right Panel)

```
Canvas Wrapper: flex-1 relative bg-muted flex flex-col items-center justify-center overflow-hidden
Background:     absolute inset-0 opacity-20 pointer-events-none (with radial gradient)
Empty State:    flex flex-col items-center justify-center text-muted-foreground space-y-4
Empty Icon:     w-16 h-16 opacity-30
Empty Text:     text-xl font-medium tracking-wide
Carousel Wrap:  relative w-full h-full p-12 lg:p-24 flex items-center justify-center
Slide Box:      w-full max-w-6xl aspect-video relative
Card (Active):  absolute inset-0 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] opacity-100 translate-x-0 z-10
Card (Prev):    opacity-0 -translate-x-full z-0
Card (Next):    opacity-0 translate-x-full z-0
Controls Wrap:  absolute bottom-12 flex items-center gap-6 bg-card/80 backdrop-blur-xl border border-border px-6 py-3 rounded-full shadow-card z-20
Control Btn:    p-2 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors
Dot Active:     h-1.5 rounded-full transition-all duration-300 w-6 bg-primary
Dot Inactive:   w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60
```

### 6.5 Settings Modal (`ChatPage.tsx`)

```
Modal Wrapper: absolute top-12 right-0 w-80 bg-card border border-border rounded-xl shadow-card p-6 z-50 animate-in fade-in slide-in-from-top-2
Header:        flex justify-between items-start mb-4
Title:         text-lg font-semibold text-foreground
Close Btn:     text-muted-foreground hover:text-foreground
Profile Pic:   w-12 h-12 rounded-full border border-border
Profile Alt:   w-12 h-12 rounded-full bg-primary flex items-center justify-center text-lg text-primary-foreground font-bold shadow-sm
Name:          text-[15px] font-medium text-foreground
Email:         text-[13px] text-muted-foreground
Info Box:      space-y-3 mb-6 bg-muted/20 rounded-lg p-3 border border-border
Info Label:    text-[13px] text-muted-foreground
Info Value:    text-[13px] text-foreground
Action Row:    w-full flex items-center justify-center gap-2 bg-muted hover:bg-muted/80 text-foreground py-2.5 rounded-lg transition-colors text-sm font-medium border border-border
Delete Row:    w-full flex items-center justify-center gap-2 bg-destructive/10 hover:bg-destructive/20 text-destructive py-2.5 rounded-lg transition-colors text-sm font-medium border border-destructive/20 disabled:opacity-50
```

---

## 7. Reusable Button Patterns

| Button Style            | Classes                                                               |
|-------------------------|-----------------------------------------------------------------------|
| **Primary CTA (green)** | `bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90` |
| **Dark CTA**            | `bg-[#2E3330] px-4 py-2 text-sm font-medium text-white hover:bg-[#3a3f3c]` |
| **Outline / Ghost**     | `border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-muted` |
| **Destructive**         | `bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90` |
| **Destructive Outline** | `border border-destructive/30 bg-background text-destructive hover:bg-destructive/10` |
| **Small Table Action**  | `border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground` |

All buttons share: `inline-flex items-center justify-center gap-1.5 rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none`

---

## 8. Badge / Pill Patterns

| Variant         | Classes                                                         |
|-----------------|-----------------------------------------------------------------|
| **Active**      | `rounded-full border-emerald-200 bg-emerald-50 text-emerald-700` |
| **Draft**       | `rounded-full border-amber-200 bg-amber-50 text-amber-700`      |
| **Archived**    | `rounded-full border-gray-200 bg-gray-100 text-gray-600`        |
| **Out of stock**| `rounded-full border-destructive/30 bg-destructive/10 text-destructive` |
| **Low stock**   | `rounded-full border-amber-300/50 bg-amber-50 text-amber-700`   |
| **Neutral**     | `rounded-full border text-muted-foreground`                      |

All badges share: `inline-flex items-center px-2.5 py-0.5 text-xs font-semibold`

---

## 9. Input / Form Control Patterns

| Element     | Pattern |
|-------------|---------|
| **Text Input** | `h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm` + focus ring |
| **Select**     | Same as text input |
| **Textarea**   | Same without fixed height |
| **Label**      | `text-sm font-medium text-foreground` (primary) or `text-xs font-medium text-muted-foreground` (secondary) |

**Focus ring pattern (Products page style):**
```
ring-offset-background focus-visible:outline-none
focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
```

**Focus ring pattern (Create page style):**
```
focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary
```

---

## 10. Spacing & Layout Conventions

| Pattern                | Token / Value                             |
|------------------------|-------------------------------------------|
| Page max-width         | `max-w-7xl` (general), `max-w-4xl` (forms) |
| Page padding           | `px-4 py-6`                                |
| Section spacing        | `space-y-8` between form sections          |
| Card internal padding  | `p-4` (compact) or `p-6` (modal/form)      |
| Grid gap               | `gap-6`                                     |
| Stack gap              | `gap-2` to `gap-4`                          |
| Back-link margin       | `mb-4`                                      |
| Page heading margin    | `mb-6`                                      |

---

## 11. Typography Scale

| Element    | Classes                                                   |
|------------|-----------------------------------------------------------|
| Page Title | `text-2xl font-bold tracking-tight text-foreground md:text-3xl` |
| Section H2 | `text-lg font-semibold text-foreground`                   |
| Card Name  | `text-base font-bold leading-tight text-foreground`       |
| Body Text  | `text-sm text-foreground` or `text-sm text-muted-foreground` |
| Meta/Label | `text-xs text-muted-foreground` or `text-xs font-medium uppercase tracking-wider text-muted-foreground` |
| Monospace  | `font-mono text-xs` (SKUs)                                |
| Tabular    | `tabular-nums` (prices, inventory counts, countdowns)      |

---

## 12. Icon Sizing Conventions (lucide-react)

| Context          | Size Class   | Icons Used                          |
|------------------|-------------|--------------------------------------|
| Nav items        | `h-4 w-4`  | `Package`, `LayoutGrid`              |
| Card placeholder | `h-12 w-12`| `Package`                            |
| Button inline    | `h-4 w-4`  | `Plus`, `ArrowLeft`, `Save`, `Trash2`, `Edit`, `Pencil`, `X`, `Search` |
| Small actions    | `h-3 w-3`  | `Check`, `X`, `Pencil`, `Layers`, `Tag` |
| Modal icon       | `h-5 w-5` - `h-6 w-6` | `AlertTriangle`, `CheckCircle` |
| Large empty-state| `h-10 w-10`| `PackageSearch`                      |
| Spinner          | `h-4 w-4 animate-spin` | `Loader2`                  |

---

## 13. Responsive Breakpoints

Standard Tailwind breakpoints used:

| Prefix | Min-width | Usage                                       |
|--------|-----------|----------------------------------------------|
| `sm:`  | 640px     | Filter bar row layout, grid 2-col, modal footer row |
| `md:`  | 768px     | Header row layout, form grid 2-col, title sizing |
| `lg:`  | 1024px    | Product grid 4-col                           |
| `xl:`  | 1280px    | Product grid 5-col                           |

---

## 14. Animation & Transition Patterns

| Pattern           | Classes                                       |
|-------------------|-----------------------------------------------|
| General hover     | `transition-colors`                           |
| Card hover        | `transition-all duration-200`                 |
| Backdrop          | `transition-opacity`                          |
| Modal panel       | `transition-all`                              |
| Spinner           | `animate-spin`                                |
| Backdrop blur     | `backdrop-blur`, `supports-[backdrop-filter]` |

---

## 15. Utility Functions (`lib/utils.ts`)

```typescript
// Classname joiner — filters out falsy values (replaces clsx/classnames)
function cn(...classes: (string | false | null | undefined)[]): string

// Format cents as dollar string (1999 → "$19.99")
function formatPrice(cents: number): string
```
