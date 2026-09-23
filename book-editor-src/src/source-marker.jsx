// Custom BlockNote inline content: a small, allowlisted glyph marker used to annotate exact
// positions inside migrated source text (e.g. a separate geometry-reading worker drops an
// "X" / "✓" / arrow marker at an exact source DOM text-node offset). Atomic (content:"none"):
// it never becomes an editable text run itself, so it can sit inside a paragraph's inline
// content without absorbing keystrokes or merging with surrounding text.
//
// Safety: only the 12 vetted glyphs below are ever rendered. There is no free-text prop, no
// raw-HTML injection of any kind, and no URL/href here at all — nothing user- or worker-supplied
// reaches the DOM except one of these exact characters.
import { createReactInlineContentSpec } from "@blocknote/react";

// Exhaustive allowlist, in the order given by the migration/reference-geometry worker's marker
// set. Keep this in sync with the duplicate copy in js/book-markdown.js (plain browser script,
// can't import this module) used for lossless Markdown export.
export const BOOK_SOURCE_MARKER_GLYPHS = Object.freeze([
  "X", "✓", "○", "●", "→", "↗", "↘", "↓", "↙", "←", "↖", "↑",
]);

export function isBookSourceMarkerGlyph(value) {
  return typeof value === "string" && BOOK_SOURCE_MARKER_GLYPHS.includes(value);
}

// Red for the "wrong/removed" X, green for the "correct" check. Everything else (circles,
// arrows) is positional/directional rather than right-or-wrong, so it stays neutral and
// inherits the surrounding text color instead of picking an arbitrary third color.
const GLYPH_COLOR = Object.freeze({ X: "#c0392b", "✓": "#1e8e3e" });

function markerStyle(glyph) {
  return {
    fontWeight: "bold", // inherited font-family/size on purpose, only weight+color are forced
    color: GLYPH_COLOR[glyph], // undefined for neutral glyphs -> inherits ambient text color
    margin: "0 0.05em", // small inline gap so the marker doesn't collide with adjacent source text
  };
}

function BookSourceMarker({ inlineContent }) {
  const glyph = inlineContent.props.glyph;
  return (
    <span data-book-source-marker={glyph} style={markerStyle(glyph)}>
      {glyph}
    </span>
  );
}

export const bookSourceMarkerSpec = createReactInlineContentSpec(
  {
    type: "bookSourceMarker",
    propSchema: {
      glyph: { default: BOOK_SOURCE_MARKER_GLYPHS[0], values: BOOK_SOURCE_MARKER_GLYPHS },
      // The inserting worker only ever sends {type:'bookSourceMarker', props:{glyph}}, but the
      // schema also accepts an optional id so a future id-bearing insert still validates.
      id: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => <BookSourceMarker {...props} />,
    toExternalHTML: (props) => <BookSourceMarker {...props} />,
    // Round-trips <span data-book-source-marker="…"> back into this inline content type (e.g.
    // if the editor ever re-parses its own exported HTML). Unknown/tampered glyph values are
    // rejected outright here, never coerced into something renderable.
    parse: (el) => {
      const glyph = el.getAttribute("data-book-source-marker");
      if (!isBookSourceMarkerGlyph(glyph)) return undefined;
      return { glyph };
    },
  },
);

export const sourceMarkerInlineContentSpecs = Object.freeze({
  bookSourceMarker: bookSourceMarkerSpec,
});
