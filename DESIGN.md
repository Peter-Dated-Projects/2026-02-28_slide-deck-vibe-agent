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
| `--primary`              | `122 56% 66%`     | **Green**       | Primary actions, header bg, focus rings |
| `--primary-foreground`   | `0 0% 100%`       | White           | Text on primary surfaces           |
| `--secondary`            | `0 0% 96%`        | Light gray      | Secondary elements                 |
| `--secondary-foreground` | `0 0% 20%`        | Dark gray       | Text on secondary                  |
| `--muted`                | `0 0% 96%`        | Light gray      | Muted backgrounds, hover states    |
| `--muted-foreground`     | `0 0% 45%`        | Medium gray     | Subdued text, labels, metadata     |
| `--accent`               | `122 56% 50%`     | Darker green    | Accent highlights                  |
| `--accent-foreground`    | `0 0% 100%`       | White           | Text on accent                     |
| `--destructive`          | `0 84.2% 60.2%`   | **Red**         | Destructive actions, errors        |
| `--destructive-foreground`| `0 0% 98%`       | Near-white      | Text on destructive                |
| `--border`               | `0 0% 90%`        | Light gray      | Borders (applied globally via `*`) |
| `--input`                | `0 0% 90%`        | Light gray      | Input borders                      |
| `--ring`                 | `122 56% 66%`     | Green           | Focus ring color                   |

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

### 6.1 Layout Shell (`Layout.tsx`)

```
Root:          min-h-screen bg-background
Header:        sticky top-0 z-40 bg-primary/95 backdrop-blur
               supports-[backdrop-filter]:bg-primary/80
Header Inner:  mx-auto flex flex-col gap-3 px-4 py-3
               md:flex-row md:items-center md:justify-between md:py-4
Title:         text-2xl font-bold text-black md:text-3xl
Subtitle:      text-sm text-slate-800 md:text-base
Nav Link:      inline-flex items-center gap-1.5 rounded-md border px-3 py-2
               text-sm font-medium transition-colors
  Active:      border-black/20 bg-black/10 text-black
  Inactive:    border-primary-foreground/30 bg-transparent
               text-secondary-foreground hover:bg-primary-foreground/20
Main Content:  mx-auto max-w-7xl px-4 py-6
```

### 6.2 Product Card (`ProductCard.tsx`)

```
Card Link:     group flex h-[340px] flex-col overflow-hidden rounded-lg border
               bg-card text-card-foreground shadow-card transition-all duration-200
               hover:shadow-card-hover
Image Zone:    relative flex h-40 items-center justify-center overflow-hidden bg-muted
  Placeholder: h-12 w-12 text-muted-foreground/40  (Package icon)
Status Badge:  absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs font-semibold
  active:      bg-emerald-100 text-emerald-800
  draft:       bg-amber-100 text-amber-800
  archived:    bg-gray-200 text-gray-600
Variant Badge: absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full
               bg-background/80 px-3 py-1 text-xs font-medium backdrop-blur
Content Area:  flex flex-1 flex-col p-4
Category:      mb-1 flex items-center gap-1 text-xs text-muted-foreground
Name (h3):    line-clamp-2 text-base font-bold leading-tight text-foreground
Price:         mt-1 text-sm text-muted-foreground
Inventory:     inline-flex items-center rounded-full border px-2.5 py-0.5
               text-xs font-semibold
  Out-of-stock: border-destructive/30 bg-destructive/10 text-destructive
  Low-stock:    border-amber-300/50 bg-amber-50 text-amber-700
  In-stock:     border text-muted-foreground
View Button:   inline-flex items-center gap-1 rounded-md border px-2.5 py-1
               text-xs font-medium text-muted-foreground transition-colors
               group-hover:border-foreground/30 group-hover:text-foreground
```

### 6.3 Product Grid (`ProductsPage.tsx`)

```
Product Grid:  grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3
               lg:grid-cols-4 xl:grid-cols-5
Filter Bar:    mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4
Search Input:  flex h-10 w-full rounded-md border border-input bg-background
               px-3 py-2 pl-9 text-sm ring-offset-background
               placeholder:text-muted-foreground focus-visible:outline-none
               focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
Select:        flex h-10 w-full items-center rounded-md border border-input
               bg-background px-3 py-2 text-sm (same focus ring as input)
Clear Button:  inline-flex h-10 items-center gap-1.5 rounded-md border border-input
               bg-background px-3 text-sm font-medium transition-colors hover:bg-muted
Result Count:  mb-4 text-sm text-muted-foreground
Empty State:   flex flex-col items-center justify-center py-20 text-muted-foreground
```

### 6.4 Data Tables (`CategoriesPage.tsx`, `ProductDetailPage.tsx`)

```
Table Wrapper: overflow-hidden rounded-lg border bg-card shadow-card
Table:         w-full caption-bottom text-sm
Thead Row:     border-b bg-muted/50 transition-colors
               [&_tr]:border-b  (on thead)
Th:            h-12 px-4 text-left align-middle text-xs font-medium uppercase
               tracking-wider text-muted-foreground
  Right align: text-right
Tbody:         [&_tr:last-child]:border-0
Td:            p-4 align-middle
  Font-mono:   font-mono text-xs  (for SKUs)
  Font-medium: font-medium  (for names)
  Numeric:     text-right tabular-nums
Row Hover:     border-b transition-colors hover:bg-muted/50
Editing Row:   border-b bg-muted/30 transition-colors
Error Row:     border-b bg-destructive/5
```

### 6.5 Inline Edit Inputs (Variant Row)

```
SKU Input:     w-32 rounded border border-input bg-background px-2 py-1
               font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring
Name Input:    w-36 rounded border border-input bg-background px-2 py-1
               text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring
Price Input:   w-24 rounded border border-input bg-background px-2 py-1
               text-right text-sm tabular-nums (same focus ring)
Inventory Input: w-20 rounded border border-input bg-background px-2 py-1
               text-right text-sm tabular-nums (same focus ring)
Save Button:   inline-flex items-center gap-1 rounded-md border border-emerald-300
               bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700
               transition-colors hover:bg-emerald-100 disabled:opacity-50
Cancel Button: inline-flex items-center gap-1 rounded-md border px-2.5 py-1
               text-xs font-medium text-muted-foreground transition-colors
               hover:bg-muted hover:text-foreground disabled:opacity-50
```

### 6.6 Form Cards (`CreateProductPage.tsx`)

```
Page Wrapper:  mx-auto max-w-4xl pb-16
Section Card:  rounded-xl border border-divider bg-card p-6 shadow-sm
Section Title: mb-4 text-lg font-semibold text-foreground
Form Grid:     grid gap-6 md:grid-cols-2
Label:         text-sm font-medium text-foreground
Small Label:   text-xs font-medium text-muted-foreground
Text Input:    w-full rounded-md border border-divider bg-background
               px-3 py-2 text-sm text-foreground
               focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary
Textarea:      (same as text input pattern, rows=3)
Select:        (same as text input pattern)
Variant Card:  grid gap-4 rounded-lg border border-divider bg-background p-4
               sm:grid-cols-5
Error Banner:  mb-6 rounded-md bg-destructive/10 p-4 text-sm text-destructive
Add Variant:   mt-4 flex items-center gap-2 rounded-md
               border border-dashed border-divider bg-background px-4 py-2
               text-sm font-medium text-foreground transition-colors
               hover:border-primary hover:text-primary
Submit Button: flex items-center gap-2 rounded-md bg-primary px-4 py-2
               text-sm font-medium text-primary-foreground transition-colors
               hover:bg-primary/90 disabled:opacity-50
Cancel Link:   rounded-md border border-divider bg-background px-4 py-2
               text-sm font-medium text-foreground transition-colors hover:bg-muted
```

### 6.7 Modals

#### Confirm Delete Modal (`ConfirmDeleteModal.tsx`)

```
Backdrop:      fixed inset-0 z-50 bg-black/50 transition-opacity
Container:     fixed left-1/2 top-1/2 z-50 w-full max-w-md
               -translate-x-1/2 -translate-y-1/2 p-4
Panel:         relative flex w-full flex-col overflow-hidden rounded-lg
               border bg-background text-left align-middle shadow-xl transition-all
Close Button:  absolute right-4 top-4 rounded-sm opacity-70
               ring-offset-background transition-opacity hover:opacity-100
               focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
               disabled:pointer-events-none
               data-[state=open]:bg-accent data-[state=open]:text-muted-foreground
Icon Circle:   flex h-10 w-10 flex-shrink-0 items-center justify-center
               rounded-full bg-destructive/10 text-destructive
Title:         text-lg font-semibold leading-none tracking-tight
Description:   mt-2 text-sm text-muted-foreground
Footer:        flex flex-col-reverse justify-end gap-2 bg-muted/40 p-4
               sm:flex-row sm:items-center
Cancel Button: inline-flex h-10 items-center justify-center rounded-md
               border border-input bg-background px-4 py-2 text-sm font-medium
               transition-colors hover:bg-accent hover:text-accent-foreground
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
               focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50
Delete Button: inline-flex h-10 items-center justify-center rounded-md
               bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground
               transition-colors hover:bg-destructive/90
               (same focus-visible & disabled patterns)
```

#### Page Error / Success Modal (`PageErrorModal.tsx`)

```
Backdrop:      fixed inset-0 z-50 flex items-center justify-center bg-black/40
Panel:         relative mx-4 w-full max-w-sm rounded-md border bg-card p-6 shadow-xl
Close Button:  absolute right-3 top-3 rounded-md p-1 text-muted-foreground
               transition-colors hover:bg-muted hover:text-foreground
Error Icon:    mb-4 flex h-12 w-12 items-center justify-center rounded-full
               bg-destructive/10   (AlertTriangle, text-destructive)
Success Icon:  mb-4 flex h-12 w-12 items-center justify-center rounded-full
               bg-emerald-100      (CheckCircle, text-emerald-600)
Title:         text-base font-semibold text-foreground
Message:       mt-1.5 text-sm text-muted-foreground
Countdown:     text-xs text-muted-foreground
               -> number span: tabular-nums text-foreground font-medium
CTA Button:    ml-auto inline-flex items-center gap-1.5 rounded-md
               bg-[#2E3330] px-4 py-2 text-sm font-medium text-white
               transition-colors hover:bg-[#3a3f3c]
```

### 6.8 Product Not Found Page (`ProductNotFoundPage.tsx`)

```
Container:     flex flex-col items-center justify-center py-24 text-center
Icon Circle:   mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-muted
               (PackageSearch, h-10 w-10 text-muted-foreground)
Heading:       text-2xl font-bold tracking-tight text-foreground
Subtext:       mt-2 max-w-sm text-sm text-muted-foreground
Countdown:     mt-4 text-sm font-medium text-muted-foreground
               -> number: tabular-nums text-foreground
CTA Link:      mt-6 inline-flex h-10 items-center gap-2 rounded-md
               bg-[#2E3330] px-5 text-sm font-medium text-white shadow-sm
               transition-colors hover:bg-[#3a3f3c]
```

### 6.9 Loading Spinner

```
spinner: h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent
wrapper: flex items-center justify-center py-20
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
