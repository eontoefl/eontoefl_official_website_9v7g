# Design System Specification: The Ethereal Dashboard

## 1. Overview & Creative North Star
**Creative North Star: "The Digital Curator"**
This design system rejects the "cluttered utility" of traditional admin panels in favor of a high-end, editorial experience. We treat data not as a commodity to be crammed into boxes, but as content to be curated. By moving away from rigid grids and 1px borders, we create a "breathable" interface that feels more like a premium workspace than a technical tool.

**The Signature Look:** 
We achieve sophistication through **Intentional Asymmetry** and **Tonal Depth**. Instead of standard "containers," we use overlapping layers and shifting background tones to guide the eye. This creates an interface that feels liquid and light, prioritizing cognitive ease for the power user.

---

## 2. Colors & Surface Philosophy
The palette is rooted in a high-contrast relationship between the soaring `Sky Blue` and the grounded `Warm Coral`.

### The "No-Line" Rule
**Borders are prohibited for sectioning.** To define boundaries, designers must use background color shifts or tonal transitions. A `surface-container-low` section sitting on a `surface` background provides all the separation necessary. If a separator is required for accessibility, use a "Ghost Border" (the `outline-variant` token at 15% opacity).

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers, similar to stacked sheets of frosted glass.
- **Base Layer:** `surface` (#f8f9fa)
- **Primary Containers:** `surface-container-lowest` (#ffffff) to provide "pop" for main cards.
- **De-emphasized Zones:** `surface-container-low` (#f3f4f5) for sidebars or secondary utilities.

### The Glass & Gradient Rule
To move beyond "flat" design, primary CTAs and high-level metric cards should utilize a subtle linear gradient:
*   **Signature Gradient:** `primary` (#006688) → `primary-container` (#50c9ff) at a 135° angle.
*   **Glassmorphism:** For floating menus or tooltips, use `surface-container-lowest` with a 12px `backdrop-blur` and 80% opacity.

---

## 3. Typography
We use **Inter** as our typographic anchor. It provides the mathematical precision required for data, but when scaled, it takes on an authoritative editorial voice.

*   **Display (lg/md/sm):** Used for "Hero Metrics" or page headers. Letter-spacing should be set to `-0.02em` to create a tight, premium feel.
*   **Headline (lg/md/sm):** Reserved for section titles. These should be `on-surface` with high contrast against the background.
*   **Body (lg/md):** Use `on-surface-variant` (#3e484f) for general text to reduce eye strain, reserving `on-surface` for active content.
*   **Label (md/sm):** Used for metadata and button text. Always set to `Medium (500)` or `Semi-Bold (600)` weight to ensure legibility against light backgrounds.

---

## 4. Elevation & Depth
Depth is achieved through **Tonal Layering** rather than structural lines.

### The Layering Principle
Place a `surface-container-lowest` card on a `surface-container-low` section. This creates a soft, natural "lift." Avoid shadows on static components; save them for interactive elements.

### Ambient Shadows
When a component must "float" (modals, dropdowns):
*   **Blur:** 24px - 40px.
*   **Opacity:** 4% - 6%.
*   **Color:** Use a tinted version of `on-surface` (#191c1d) rather than pure black to mimic natural light.

---

## 5. Components

### Buttons
*   **Primary:** Uses the Signature Gradient (`primary` to `primary-container`). Roundedness: `DEFAULT` (0.5rem). No border.
*   **Secondary:** `surface-container-high` background with `on-primary-container` text.
*   **Tertiary:** Ghost style. No background; `primary` text. Use for low-emphasis actions.

### Cards & Lists
*   **Strict Rule:** No divider lines between list items. Use **Spacing Scale 3** (1rem) as vertical padding to create separation through whitespace.
*   **Metrics Cards:** Use `headline-lg` for the data point and `label-sm` for the descriptor. Accentuate with a `secondary-container` (Soft Green) sparkline for success metrics.

### Input Fields
*   **State:** Unfocused inputs should use `surface-container-highest` background with no border. 
*   **Focus:** Transition to a 2px `outline` using `primary-fixed-dim` (#76d1ff).
*   **Error:** Use `error` (#ba1a1a) for the helper text and a 1px `error` border only during the error state.

### High-End Dash Components (Additional)
*   **The "Contextual Blade":** A slide-out panel using `surface-container-lowest` with a heavy `backdrop-blur` to provide details without losing the dashboard's context.
*   **Metric Glint:** A tiny 4px `primary` dot next to "Live" data to provide a sense of activity without distracting animations.

---

## 6. Do's and Don'ts

### Do:
*   **Use Whitespace as a Tool:** If a section feels crowded, don't add a border; add 1.4rem (`spacing-4`) of padding.
*   **Layer Surfaces:** Use `surface-container-low` for your sidebar and `surface` for the main content area to create an immediate hierarchy.
*   **Be Intentional with Coral:** Only use `tertiary` (#a53b22 / #FF7E5F) for critical alerts or "Delete" actions. It is a high-energy color; use it sparingly.

### Don't:
*   **Don't use 100% Black:** Never use #000000. Use `on-surface` (#191c1d) for text to maintain the premium, soft aesthetic.
*   **Don't use standard Drop Shadows:** If it looks like a "box-shadow," it's too heavy. It should look like a glow or a soft atmospheric occlusion.
*   **Don't use Dividers:** Avoid horizontal rules (`<hr>`). If you cannot distinguish items without a line, your spacing scale is likely too small.