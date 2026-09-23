export const DESIGN_THEMES = Object.freeze([
  "neutral",
  "reading",
  "listening",
  "writing",
  "speaking",
]);

export const DESIGN_LEVELS = Object.freeze(["1", "2", "3"]);
export const DESIGN_TONES = Object.freeze(["info", "tip", "warning"]);
export const DESIGN_MEDIA_TYPES = Object.freeze(["link", "audio", "video"]);

const MAX_JSON_LENGTH = 100_000;
export const MAX_ANNOTATED_NOTES = 50;
export const MAX_QUESTION_OPTIONS = 30;
const MAX_URL_LENGTH = 4_096;

const hasOwn = (value, key) =>
  Object.prototype.hasOwnProperty.call(value, key);

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function normalizeDesignTheme(theme) {
  return DESIGN_THEMES.includes(theme) ? theme : "neutral";
}

export function safeHttpUrl(value) {
  if (typeof value !== "string") return null;

  if (/[\u0000-\u001F\u007F]/.test(value)) return null;

  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_URL_LENGTH) return null;

  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      !parsed.hostname
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

function parseBoundedArray(value, maxItems, normalizeItem, dataLabel) {
  if (typeof value !== "string") {
    return {
      items: [],
      error: `${dataLabel} 데이터가 문자열이 아닙니다.`,
      omittedCount: 0,
      invalidCount: 0,
    };
  }

  if (value.length > MAX_JSON_LENGTH) {
    return {
      items: [],
      error: `${dataLabel} 데이터가 너무 커서 표시하지 않았습니다.`,
      omittedCount: 0,
      invalidCount: 0,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      items: [],
      error: `${dataLabel} JSON 형식이 올바르지 않습니다.`,
      omittedCount: 0,
      invalidCount: 0,
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      items: [],
      error: `${dataLabel} 데이터는 배열이어야 합니다.`,
      omittedCount: 0,
      invalidCount: 0,
    };
  }

  const items = [];
  let invalidCount = 0;
  const bounded = parsed.slice(0, maxItems);

  for (const entry of bounded) {
    const normalized = normalizeItem(entry);
    if (normalized === null) {
      invalidCount += 1;
    } else {
      items.push(normalized);
    }
  }

  return {
    items,
    error: null,
    omittedCount: Math.max(0, parsed.length - maxItems),
    invalidCount,
  };
}

export function parseAnnotatedNotes(value) {
  return parseBoundedArray(
    value,
    MAX_ANNOTATED_NOTES,
    (entry) => {
      if (
        !isRecord(entry) ||
        !hasOwn(entry, "quote") ||
        !hasOwn(entry, "note") ||
        typeof entry.quote !== "string" ||
        typeof entry.note !== "string"
      ) {
        return null;
      }

      const item = { quote: entry.quote, note: entry.note };
      if (hasOwn(entry, "font")) {
        if (!["paperlogy", "leeSeoyun"].includes(entry.font)) return null;
        item.font = entry.font;
      }
      return item;
    },
    "인용 메모",
  );
}

export function parseQuestionOptions(value) {
  return parseBoundedArray(
    value,
    MAX_QUESTION_OPTIONS,
    (entry) => {
      if (
        !isRecord(entry) ||
        typeof entry.label !== "string" ||
        typeof entry.text !== "string" ||
        typeof entry.explanation !== "string" ||
        typeof entry.correct !== "boolean"
      ) {
        return null;
      }

      return {
        label: entry.label,
        text: entry.text,
        explanation: entry.explanation,
        correct: entry.correct,
      };
    },
    "문항 선택지",
  );
}

export function quoteOccursInPassage(passage, quote) {
  return (
    typeof passage === "string" &&
    typeof quote === "string" &&
    quote.length > 0 &&
    passage.includes(quote)
  );
}
