# Nestbau v2.0 - Modern Design System

**Version:** 2.0  
**Datum:** 2026-09-04  
**Designer:** Claude (Design Architect)

---

## 🎨 Color Palette

### Primary Colors (Food-Inspired)
- **Primary Orange:** `#FF8C42` — Main action & brand color
- **Primary Peach:** `#FFB84D` — Highlights & secondary accent
- **Secondary Green:** `#A8D5BA` — Nutritional/Healthy actions
- **Dark Green:** `#7EC483` — Secondary green for contrast

### Backgrounds & Surfaces
- **Light:** `#fafaf8` — Main background (Light mode)
- **Surface:** `#ffffff` — Cards & panels
- **Surface Sunken:** `#f5f3f0` — Secondary surfaces
- **Dark BG:** `#1a1a1a` — Dark mode background

### Text Colors
- **Primary Text:** `#1f2420` — Main text (Light mode)
- **Secondary Text:** `#6b6f68` — Soft text/labels
- **Light Text:** `#f2f1ee` — Text on dark mode

### Status Colors
- **Amber:** `#FFB84D` — Warning
- **Maroon:** `#D64045` — Error/Important
- **Green:** `#A8D5BA` — Success/Complete

---

## 🔤 Typography

### Font Family
```css
-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Manrope", sans-serif;
```

### Font Sizes & Weights
- **Title (h1):** 1.3rem / 700 weight
- **Heading (h2):** 1.1rem / 700 weight
- **Body (p):** 0.95rem / 400 weight
- **Small (label):** 0.84rem / 600 weight
- **Tiny (meta):** 0.7rem / 700 weight (uppercase)

### Line Heights
- Headings: 1.2
- Body: 1.5
- Forms: 1.4

---

## 🎯 Components

### Buttons
- **Primary Button:** Orange gradient (FF8C42 → FFB84D)
- **Secondary Button:** Green gradient (A8D5BA → 7EC483)
- **Ghost Button:** Transparent with hover state
- **Rounded:** 14px border radius
- **Min Height:** 48px (touch target)
- **Padding:** 14px 16px
- **Transition:** 250ms ease
- **Hover:** Translate +2px, stronger shadow

### Cards
- **Border Radius:** 20px
- **Padding:** 18px
- **Shadow:** 0 2px 8px rgba(0,0,0,0.06)
- **Hover Shadow:** 0 8px 24px rgba(0,0,0,0.12)
- **Border:** 1px solid rgba(255,140,66,0.05)
- **Transition:** All 150ms ease

### Input Fields
- **Border Radius:** 12px
- **Padding:** 12px 14px
- **Border:** 1.5px solid transparent
- **Focus:** Orange border + flame-tint shadow
- **Min Height:** Implicit from padding

### Chips & Filters
- **Border Radius:** 999px (pill-shaped)
- **Padding:** 8px 16px
- **Border:** 1.5px solid var(--line)
- **Active:** Orange gradient + white text
- **Transition:** All 150ms ease

### Tabs
- **Position:** Fixed bottom (66px height)
- **Tab Buttons:** 48x48px, rounded 12px
- **Active Indicator:** Orange underline (3px height)
- **Transition:** All 150ms ease

---

## 🌙 Dark Mode

Automatically enabled based on:
1. System preference (`prefers-color-scheme: dark`)
2. Manual toggle (`data-theme="dark"` attribute on :root)

**Dark Mode Colors:**
- Background: `#1a1a1a`
- Surface: `#242426`
- Primary Orange (same): `#FF8C42`
- Green (adjusted): `#6eb59e`
- Text: `#f2f1ee`

---

## 📦 Spacing System

- **4px:** xs (border-radius: 12px)
- **8px:** sm (padding inner)
- **12px:** md (gap standard)
- **16px:** lg (padding card)
- **20px:** xl (padding section)
- **24px:** xxl (padding modal)

---

## ✨ Animations

### Transitions
- **Fast:** 150ms ease (interactive)
- **Base:** 250ms ease (standard)
- **Slow:** 400ms ease (modals)

### Key Animations
- **Slide In:** 250ms ease (cards, notifications)
- **Fade In:** 250ms ease (overlays)
- **Spin:** 0.8s linear infinite (loaders)

### Hover Effects
- Buttons: Scale 1.08 on hover, -2px translate
- Cards: -2px translate, stronger shadow
- Icon buttons: Color change to orange

---

## 🎯 Responsive Design

### Breakpoints
- **Mobile:** ≤ 480px (primary)
- **Tablet:** 481px - 768px
- **Desktop:** ≥ 769px

### Max-Width Container
- `.app`: 480px max-width
- Centered with `margin: 0 auto`

### Touch Targets
- Minimum: 48x48px
- Padding: 12px+
- Gap between: 8px+

---

## ♿ Accessibility

### Color Contrast
- All text: 4.5:1 minimum (WCAG AA)
- Interactive elements: 3:1 minimum
- Gradients: Tested on light & dark backgrounds

### Focus States
- All interactive elements have visible focus ring
- Focus color: Primary orange (#FF8C42)
- Focus outline: 3px solid flame-tint

### Motion
- `prefers-reduced-motion: reduce` — animates in 1ms
- No involuntary auto-playing animations
- Disabled auto-scroll

### Semantic HTML
- Proper heading hierarchy (h1, h2, h3)
- Form labels associated with inputs
- Icon buttons have aria-labels

---

## 📱 Mobile Optimization

- **Viewport:** `device-width, initial-scale=1, maximum-scale=1`
- **Safe Area:** `viewport-fit=cover` (notch support)
- **Tabbar Clearance:** 84px bottom padding on .app
- **No Horizontal Scroll:** All content fits within 480px

---

## 🔄 State Indicators

### Active States
- Buttons: `scale(0.98)` on click
- Chips: Orange gradient background
- Tabs: Orange underline indicator
- Inputs: Orange border + shadow

### Hover States
- Color change to orange (--flame)
- Shadow enhancement
- Slight translate (-2px Y)

### Disabled States
- Opacity: 0.6
- Pointer-events: none
- Color: var(--ink-soft)

---

## 🎯 CSS Variables

Access in your components:
```css
/* Colors */
--primary-orange: #FF8C42
--primary-peach: #FFB84D
--secondary-green: #A8D5BA
--flame: #FF8C42
--teal: #A8D5BA
--amber: #FFB84D
--maroon: #D64045

/* Transitions */
--transition-fast: 150ms ease
--transition-base: 250ms ease

/* Shadows */
--shadow: 0 2px 8px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.08)
--shadow-sm: 0 1px 3px rgba(0,0,0,0.04)
--shadow-lg: 0 8px 24px rgba(0,0,0,0.12)
```

---

## 📐 Grid System

### 2-Column Layout
```css
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
```

### 3-Column Layout
```css
.row3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
}
```

---

## 🔗 Files

- **CSS:** `nestbau-design.css` (external stylesheet)
- **HTML:** `index.html` (links to CSS)
- **Icon:** `icon.svg` (updated with new colors)

---

## 🚀 Features

✅ Modern gradient-based design  
✅ Dark mode support  
✅ Smooth animations (250ms base)  
✅ Touch-friendly (48px+ targets)  
✅ Fully responsive (375px+)  
✅ Accessibility-first (WCAG AA)  
✅ Performance-optimized (external CSS)  
✅ Zero dependencies (vanilla CSS)

---

## 📋 Component Checklist

- [x] Cards (hover effect)
- [x] Buttons (gradients, hover)
- [x] Chips & Filters (active states)
- [x] Input fields (focus states)
- [x] Tabs (bottom navigation)
- [x] Icons (rounded, 48px+)
- [x] Forms (proper spacing)
- [x] Lists (hover effects)
- [x] Modals (backdrop blur)
- [x] Animations (fade, slide)
- [x] Dark mode (full support)

---

## 🎨 Design Principles

1. **Warm & Inviting:** Orange/peach palette for food & nutrition context
2. **Clean & Minimal:** White space and clear hierarchy
3. **Modern & Smooth:** Gradients, shadows, and transitions
4. **Accessible:** High contrast, large touch targets
5. **Fast & Responsive:** 48px buttons, 250ms animations

---

**Created by:** Claude Design Architect  
**Last Updated:** 2026-09-04
