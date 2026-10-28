import { DesignText, EditorControls, designRootEvents, updateDesignProps } from "./design-editing.jsx";
export { openDesignSettings, closeDesignSettings, getActiveDesignBlock, flushDesignEdits, subscribeDesignEdits } from "./design-editing.jsx";
import { createReactBlockSpec } from "@blocknote/react";
import {
  DESIGN_LEVELS,
  DESIGN_MEDIA_TYPES,
  DESIGN_THEMES,
  DESIGN_TONES,
  MAX_ANNOTATED_NOTES,
  MAX_QUESTION_OPTIONS,
  normalizeDesignTheme,
  parseAnnotatedNotes,
  parseQuestionOptions,
  quoteOccursInPassage,
  safeHttpUrl,
} from "./design-data.js";

export { DESIGN_THEMES };
export const designThemes = DESIGN_THEMES;

const THEME_LABELS = Object.freeze({
  neutral: "기본",
  reading: "리딩",
  listening: "리스닝",
  writing: "라이팅",
  speaking: "스피킹",
});

const TONE_LABELS = Object.freeze({
  info: "안내",
  tip: "팁",
  warning: "주의",
});

const MEDIA_TYPE_LABELS = Object.freeze({
  link: "링크",
  audio: "오디오",
  video: "비디오",
});

const DEFAULT_NOTES = JSON.stringify([
  {
    quote: "예시 문장",
    note: "이 문장이 전달하는 핵심을 설명하세요.",
  },
]);

const DEFAULT_OPTIONS = JSON.stringify([
  {
    label: "A",
    text: "첫 번째 선택지",
    explanation: "이 선택지의 근거를 입력하세요.",
    correct: true,
  },
  {
    label: "B",
    text: "두 번째 선택지",
    explanation: "이 선택지가 맞거나 틀린 이유를 입력하세요.",
    correct: false,
  },
]);

function bookRootProps(kind, theme, extra = {}) {
  return {
    className: `book-design book-${kind}`,
    "data-book-kind": kind,
    "data-book-theme": normalizeDesignTheme(theme),
    ...extra,
  };
}

const updateBlockProps = updateDesignProps;

function TextControl({
  label,
  value,
  onChange,
  multiline = false,
  rows = 3,
  help,
  inputMode,
  spellCheck,
}) {
  const field = multiline ? (
    <textarea
      aria-label={label}
      value={value}
      rows={rows}
      inputMode={inputMode}
      spellCheck={spellCheck}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ) : (
    <input
      type="text"
      aria-label={label}
      value={value}
      inputMode={inputMode}
      spellCheck={spellCheck}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );

  return (
    <label>
      <span className="book-design-label">{label}</span>
      {field}
      {help ? <small className="book-design-note">{help}</small> : null}
    </label>
  );
}

function SelectControl({ label, value, options, onChange }) {
  return (
    <label>
      <span className="book-design-label">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const THEME_OPTIONS = DESIGN_THEMES.map((theme) => ({
  value: theme,
  label: THEME_LABELS[theme],
}));

const LEVEL_OPTIONS = DESIGN_LEVELS.map((level) => ({
  value: level,
  label: `제목 ${level}`,
}));

const TONE_OPTIONS = DESIGN_TONES.map((tone) => ({
  value: tone,
  label: TONE_LABELS[tone],
}));

const MEDIA_TYPE_OPTIONS = DESIGN_MEDIA_TYPES.map((mediaType) => ({
  value: mediaType,
  label: MEDIA_TYPE_LABELS[mediaType],
}));

const CORRECT_OPTIONS = [
  { value: "true", label: "정답" },
  { value: "false", label: "오답" },
];

function DataWarnings({ result }) {
  if (!result.error && !result.invalidCount && !result.omittedCount) return null;

  return (
    <div className="book-design-note" role="status">
      {result.error ? <p>{result.error}</p> : null}
      {result.invalidCount ? (
        <p>{result.invalidCount}개의 잘못된 항목을 건너뛰었습니다.</p>
      ) : null}
      {result.omittedCount ? (
        <p>
          안전한 표시 한도를 넘어선 {result.omittedCount}개의 항목은 숨겼습니다.
        </p>
      ) : null}
    </div>
  );
}

function isValidEditableArray(result) {
  return !result.error && !result.invalidCount && !result.omittedCount;
}

function ArrayControls({
  items,
  maxItems,
  itemLabel,
  addLabel,
  createItem,
  onChange,
  renderFields,
}) {
  const updateItem = (index, patch) =>
    onChange(
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );

  const moveItem = (index, offset) => {
    const next = [...items];
    const target = index + offset;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div>
      {items.map((item, index) => (
        <fieldset className="book-design-panel" key={index}>
          <legend className="book-design-label">
            {itemLabel} {index + 1}
          </legend>
          {renderFields(item, (patch) => updateItem(index, patch))}
          <div>
            <button
              type="button"
              disabled={index === 0}
              onClick={() => moveItem(index, -1)}
            >
              위로
            </button>
            <button
              type="button"
              disabled={index === items.length - 1}
              onClick={() => moveItem(index, 1)}
            >
              아래로
            </button>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
            >
              삭제
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={items.length >= maxItems}
        onClick={() => onChange([...items, createItem()])}
      >
        {addLabel} ({items.length}/{maxItems})
      </button>
    </div>
  );
}

function ThemeControl({ block, editor }) {
  return (
    <SelectControl
      label="테마"
      value={block.props.theme}
      options={THEME_OPTIONS}
      onChange={(theme) => updateBlockProps(editor, block, { theme })}
    />
  );
}

function BookHeading({ block, editor, contentRef, editable }) {
  const level = DESIGN_LEVELS.includes(block.props.level)
    ? block.props.level
    : "2";
  const HeadingTag = `h${level}`;

  return (
    <div
      {...designRootEvents(editor, block, editable)}
      {...bookRootProps("heading", block.props.theme, {
        "data-book-level": level,
      })}
    >
      <HeadingTag className="book-design-title" ref={contentRef} />
      {editable ? (
        <EditorControls block={block} editor={editor}>
          <ThemeControl block={block} editor={editor} />
          <SelectControl
            label="제목 단계"
            value={level}
            options={LEVEL_OPTIONS}
            onChange={(level) => updateBlockProps(editor, block, { level })}
          />
        </EditorControls>
      ) : null}
    </div>
  );
}

function BookCallout({ block, editor, contentRef, editable }) {
  return (
    <aside
      {...designRootEvents(editor, block, editable)}
      {...bookRootProps("callout", block.props.theme, {
        "data-book-tone": block.props.tone,
      })}
    >
      <DesignText as="h3" className="book-design-title" block={block} editor={editor} editable={editable} field="title" />
      <div className="book-design-body" data-book-font={block.props.bodyFont} ref={contentRef} />
      {editable ? (
        <EditorControls block={block} editor={editor}>
          <ThemeControl block={block} editor={editor} />
          <SelectControl
            label="강조 종류"
            value={block.props.tone}
            options={TONE_OPTIONS}
            onChange={(tone) => updateBlockProps(editor, block, { tone })}
          />
          <SelectControl label="본문 글꼴" value={block.props.bodyFont} options={[{value:"paperlogy",label:"페이퍼로지"},{value:"leeSeoyun",label:"이서윤체"},{value:"nanumGothic",label:"나눔고딕"}]} onChange={(bodyFont)=>updateBlockProps(editor,block,{bodyFont})} />
          <TextControl
            label="제목"
            value={block.props.title}
            onChange={(title) => updateBlockProps(editor, block, { title })}
          />
        </EditorControls>
      ) : null}
    </aside>
  );
}

function CompareBody({ block, editor, editable }) {
  return (
    <>
      <DesignText as="h3" className="book-design-title" block={block} editor={editor} editable={editable} field="title" />
      <div className="book-design-columns">
        <section className="book-design-panel">
          <DesignText as="h4" className="book-design-label" block={block} editor={editor} editable={editable} field="leftTitle" />
          <DesignText as="div" className="book-design-body" block={block} editor={editor} editable={editable} field="leftBody" />
        </section>
        <section className="book-design-panel">
          <DesignText as="h4" className="book-design-label" block={block} editor={editor} editable={editable} field="rightTitle" />
          <DesignText as="div" className="book-design-body" block={block} editor={editor} editable={editable} field="rightBody" />
        </section>
      </div>
    </>
  );
}

function BookCompare({ block, editor, editable }) {
  return (
    <section
      {...designRootEvents(editor, block, editable)}
      {...bookRootProps("compare", block.props.theme)}
      contentEditable={editable ? false : undefined}
    >
      <CompareBody block={block} editor={editor} editable={editable} />
      {editable ? (
        <EditorControls block={block} editor={editor}>
          <ThemeControl block={block} editor={editor} />
          <TextControl
            label="전체 제목"
            value={block.props.title}
            onChange={(title) => updateBlockProps(editor, block, { title })}
          />
          <TextControl
            label="왼쪽 제목"
            value={block.props.leftTitle}
            onChange={(leftTitle) =>
              updateBlockProps(editor, block, { leftTitle })
            }
          />
          <TextControl
            label="왼쪽 내용"
            value={block.props.leftBody}
            multiline
            rows={4}
            onChange={(leftBody) => updateBlockProps(editor, block, { leftBody })}
          />
          <TextControl
            label="오른쪽 제목"
            value={block.props.rightTitle}
            onChange={(rightTitle) =>
              updateBlockProps(editor, block, { rightTitle })
            }
          />
          <TextControl
            label="오른쪽 내용"
            value={block.props.rightBody}
            multiline
            rows={4}
            onChange={(rightBody) =>
              updateBlockProps(editor, block, { rightBody })
            }
          />
        </EditorControls>
      ) : null}
    </section>
  );
}

function BookAnnotated({ block, editor, editable }) {
  const parsed = parseAnnotatedNotes(block.props.notes);

  return (
    <section
      {...designRootEvents(editor, block, editable)}
      {...bookRootProps("annotated", block.props.theme)}
      contentEditable={editable ? false : undefined}
    >
      <DesignText as="h3" className="book-design-title" block={block} editor={editor} editable={editable} field="title" />
      <div className="book-design-panel">
        <div className="book-design-label">원문</div>
        <blockquote className="book-design-body" data-book-font={block.props.passageFont}>
          <DesignText as="p" block={block} editor={editor} editable={editable} field="passage" />
        </blockquote>
      </div>
      <ol aria-label="인용문 해설">
        {parsed.items.map((item, index) => {
          const matched = quoteOccursInPassage(block.props.passage, item.quote);
          return (
            <li key={index} data-book-quote-matched={matched ? "true" : "false"}>
              <blockquote className="book-design-panel">
                <div className="book-design-label">인용문 {index + 1}</div>
                <DesignText as="p" block={block} editor={editor} editable={editable} field="notes" index={index} itemKey="quote">{item.quote}</DesignText>
              </blockquote>
              <DesignText as="div" className="book-design-note" data-book-font={item.font || "paperlogy"} block={block} editor={editor} editable={editable} field="notes" index={index} itemKey="note">{item.note}</DesignText>
              {!matched ? (
                <p className="book-design-note" role="alert">
                  확인 필요: 이 인용문은 현재 원문에서 찾을 수 없습니다.
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <DataWarnings result={parsed} />
      {editable ? (
        <EditorControls block={block} editor={editor}>
          <ThemeControl block={block} editor={editor} />
          <TextControl
            label="제목"
            value={block.props.title}
            onChange={(title) => updateBlockProps(editor, block, { title })}
          />
          <TextControl
            label="원문"
            value={block.props.passage}
            multiline
            rows={8}
            onChange={(passage) => updateBlockProps(editor, block, { passage })}
          />
          <SelectControl label="원문 글꼴" value={block.props.passageFont}
            options={[{ value: "paperlogy", label: "페이퍼로지" }, { value: "nanumGothic", label: "나눔고딕" }]}
            onChange={(passageFont) => updateBlockProps(editor, block, { passageFont })} />
          {isValidEditableArray(parsed) ? (
            <ArrayControls
              items={JSON.parse(block.props.notes)}
              maxItems={MAX_ANNOTATED_NOTES}
              itemLabel="인용 메모"
              addLabel="인용 메모 추가"
              createItem={() => ({ quote: "새 인용문", note: "해설을 입력하세요." })}
              onChange={(items) =>
                updateBlockProps(editor, block, { notes: JSON.stringify(items) })
              }
              renderFields={(item, updateItem) => (
                <>
                  <TextControl
                    label="인용문"
                    value={item.quote}
                    multiline
                    onChange={(quote) => updateItem({ quote })}
                  />
                  <TextControl
                    label="해설"
                    value={item.note}
                    multiline
                    onChange={(note) => updateItem({ note })}
                  />
                  <SelectControl label="해설 글꼴" value={item.font || "paperlogy"}
                    options={[{ value: "paperlogy", label: "페이퍼로지" }, { value: "leeSeoyun", label: "이서윤체" }]}
                    onChange={(font) => updateItem({ font })} />
                </>
              )}
            />
          ) : (
            <TextControl
              label="인용 메모 JSON 복구"
              value={block.props.notes}
              multiline
              rows={8}
              spellCheck={false}
              help='형식을 고치면 항목별 편집기로 돌아갑니다: [{"quote":"원문의 인용문","note":"해설"}]'
              onChange={(notes) => updateBlockProps(editor, block, { notes })}
            />
          )}
        </EditorControls>
      ) : null}
    </section>
  );
}

function BookQuestion({ block, editor, editable }) {
  const parsed = parseQuestionOptions(block.props.options);

  return (
    <section
      {...designRootEvents(editor, block, editable)}
      {...bookRootProps("question", block.props.theme)}
      contentEditable={editable ? false : undefined}
    >
      <DesignText as="h3" className="book-design-title" block={block} editor={editor} editable={editable} field="title" />
      <DesignText as="div" className="book-design-body" block={block} editor={editor} editable={editable} field="question" />
      <ol className="book-design-options">
        {parsed.items.map((option, index) => (
          <li
            className="book-design-option"
            data-correct={option.correct ? "true" : "false"}
            data-book-correct={option.correct ? "true" : "false"}
            key={index}
          >
            <div>
              <DesignText as="span" className="book-design-label" block={block} editor={editor} editable={editable} field="options" index={index} itemKey="label">{option.label || String(index + 1)}</DesignText>{" "}
              <DesignText as="span" block={block} editor={editor} editable={editable} field="options" index={index} itemKey="text">{option.text}</DesignText>
            </div>
            <div className="book-design-note">
              <strong className="book-design-label">
                {option.correct ? "정답" : "오답"}
              </strong>
              {editable ? <>: <DesignText as="span" block={block} editor={editor} editable={editable} field="options" index={index} itemKey="explanation">{option.explanation}</DesignText></> : option.explanation ? `: ${option.explanation}` : null}
            </div>
          </li>
        ))}
      </ol>
      <DataWarnings result={parsed} />
      {editable ? (
        <EditorControls block={block} editor={editor}>
          <ThemeControl block={block} editor={editor} />
          <TextControl
            label="제목"
            value={block.props.title}
            onChange={(title) => updateBlockProps(editor, block, { title })}
          />
          <TextControl
            label="문제"
            value={block.props.question}
            multiline
            rows={5}
            onChange={(question) => updateBlockProps(editor, block, { question })}
          />
          {isValidEditableArray(parsed) ? (
            <ArrayControls
              items={JSON.parse(block.props.options)}
              maxItems={MAX_QUESTION_OPTIONS}
              itemLabel="선택지"
              addLabel="선택지 추가"
              createItem={() => ({
                label: "",
                text: "새 선택지",
                explanation: "해설을 입력하세요.",
                correct: false,
              })}
              onChange={(items) =>
                updateBlockProps(editor, block, { options: JSON.stringify(items) })
              }
              renderFields={(item, updateItem) => (
                <>
                  <TextControl
                    label="라벨"
                    value={item.label}
                    onChange={(label) => updateItem({ label })}
                  />
                  <TextControl
                    label="선택지 내용"
                    value={item.text}
                    multiline
                    onChange={(text) => updateItem({ text })}
                  />
                  <TextControl
                    label="해설"
                    value={item.explanation}
                    multiline
                    onChange={(explanation) => updateItem({ explanation })}
                  />
                  <SelectControl
                    label="정답 여부"
                    value={String(item.correct)}
                    options={CORRECT_OPTIONS}
                    onChange={(correct) =>
                      updateItem({ correct: correct === "true" })
                    }
                  />
                </>
              )}
            />
          ) : (
            <TextControl
              label="선택지 JSON 복구"
              value={block.props.options}
              multiline
              rows={10}
              spellCheck={false}
              help='형식을 고치면 항목별 편집기로 돌아갑니다: [{"label":"A","text":"선택지","explanation":"해설","correct":true}]'
              onChange={(options) => updateBlockProps(editor, block, { options })}
            />
          )}
        </EditorControls>
      ) : null}
    </section>
  );
}

function BookFlow({ block, editor, editable }) {
  return (
    <section
      {...designRootEvents(editor, block, editable)}
      {...bookRootProps("flow", block.props.theme)}
      contentEditable={editable ? false : undefined}
    >
      <DesignText as="h3" className="book-design-title" block={block} editor={editor} editable={editable} field="title" />
      <div className="book-design-flow-start">
        <span className="book-design-label">시작</span>
        <DesignText as="div" className="book-design-body" block={block} editor={editor} editable={editable} field="start" />
      </div>
      <div className="book-design-flow-decision">
        <span className="book-design-label">판단</span>
        <DesignText as="div" className="book-design-body" block={block} editor={editor} editable={editable} field="decision" />
      </div>
      <div className="book-design-flow-branches">
        <section className="book-design-flow-branch book-design-panel">
          <DesignText as="h4" className="book-design-label" block={block} editor={editor} editable={editable} field="leftLabel" />
          <DesignText as="div" className="book-design-body" block={block} editor={editor} editable={editable} field="leftBody" />
        </section>
        <section className="book-design-flow-branch book-design-panel">
          <DesignText as="h4" className="book-design-label" block={block} editor={editor} editable={editable} field="rightLabel" />
          <DesignText as="div" className="book-design-body" block={block} editor={editor} editable={editable} field="rightBody" />
        </section>
      </div>
      {editable ? (
        <EditorControls block={block} editor={editor}>
          <ThemeControl block={block} editor={editor} />
          <TextControl
            label="제목"
            value={block.props.title}
            onChange={(title) => updateBlockProps(editor, block, { title })}
          />
          <TextControl
            label="시작"
            value={block.props.start}
            multiline
            onChange={(start) => updateBlockProps(editor, block, { start })}
          />
          <TextControl
            label="판단 질문"
            value={block.props.decision}
            multiline
            onChange={(decision) => updateBlockProps(editor, block, { decision })}
          />
          <TextControl
            label="왼쪽 분기 라벨"
            value={block.props.leftLabel}
            onChange={(leftLabel) =>
              updateBlockProps(editor, block, { leftLabel })
            }
          />
          <TextControl
            label="왼쪽 분기 내용"
            value={block.props.leftBody}
            multiline
            onChange={(leftBody) => updateBlockProps(editor, block, { leftBody })}
          />
          <TextControl
            label="오른쪽 분기 라벨"
            value={block.props.rightLabel}
            onChange={(rightLabel) =>
              updateBlockProps(editor, block, { rightLabel })
            }
          />
          <TextControl
            label="오른쪽 분기 내용"
            value={block.props.rightBody}
            multiline
            onChange={(rightBody) =>
              updateBlockProps(editor, block, { rightBody })
            }
          />
        </EditorControls>
      ) : null}
    </section>
  );
}

function BookMedia({ block, editor, editable }) {
  const safeUrl = safeHttpUrl(block.props.url);
  const mediaType = DESIGN_MEDIA_TYPES.includes(block.props.mediaType)
    ? block.props.mediaType
    : "link";
  const typeLabel = MEDIA_TYPE_LABELS[mediaType];

  return (
    <section
      {...designRootEvents(editor, block, editable)}
      {...bookRootProps("media", block.props.theme)}
      contentEditable={editable ? false : undefined}
    >
      <DesignText as="h3" className="book-design-title" block={block} editor={editor} editable={editable} field="title" />
      <DesignText as="div" className="book-design-body" block={block} editor={editor} editable={editable} field="description" />
      <div>
        <span className="book-design-label">{typeLabel}</span>{" "}
        {safeUrl ? (
          <a
            className="book-design-media-link"
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {typeLabel} 열기
          </a>
        ) : (
          <span className="book-design-note" role="alert">
            {block.props.url
              ? "안전한 http(s) 주소만 사용할 수 있습니다."
              : "자료 주소를 입력하세요."}
          </span>
        )}
      </div>
      {editable ? (
        <EditorControls block={block} editor={editor}>
          <ThemeControl block={block} editor={editor} />
          <TextControl
            label="제목"
            value={block.props.title}
            onChange={(title) => updateBlockProps(editor, block, { title })}
          />
          <SelectControl
            label="자료 종류"
            value={mediaType}
            options={MEDIA_TYPE_OPTIONS}
            onChange={(mediaType) =>
              updateBlockProps(editor, block, { mediaType })
            }
          />
          <TextControl
            label="URL"
            value={block.props.url}
            inputMode="url"
            spellCheck={false}
            help="http:// 또는 https:// 주소만 허용됩니다. 외부 미디어는 자동 재생하거나 삽입하지 않습니다."
            onChange={(url) => updateBlockProps(editor, block, { url })}
          />
          <TextControl
            label="설명"
            value={block.props.description}
            multiline
            rows={4}
            onChange={(description) =>
              updateBlockProps(editor, block, { description })
            }
          />
        </EditorControls>
      ) : null}
    </section>
  );
}

export const COVER_LOGO_URL = "https://qpqjevecjejvbeuogtbx.supabase.co/storage/v1/object/public/guide-images/book/1792681413418_pzrawx.png";

// Cover designs share one block. Each design is a fixed series layout; only
// the text fields are edited in place. Switching the design swaps the
// design-specific texts (tag, title) to that design's defaults.
export const COVER_VARIANTS = Object.freeze({
  intro: { label: "입문서", tag: "E-BOOK", title: "입문서" },
  voca: { label: "단어장", tag: "VOCABULARY", title: "단어장" },
  "voca-back": { label: "단어장 뒷표지", tag: "VOCABULARY", title: "이온토플 단어장" },
});
const COVER_VARIANT_OPTIONS = Object.entries(COVER_VARIANTS).map(([value, v]) => ({ value, label: v.label }));
function coverVariant(props) {
  return Object.hasOwn(COVER_VARIANTS, props.variant) ? props.variant : "intro";
}
// 단어장 cover: right-edge A–Z thumb tabs (fixed artwork, like the R/L/W/S tiles).
const VOCA_TABS = ["A–C", "D–F", "G–I", "J–L", "M–O", "P–R", "S–U", "V–Z"];

function CoverTop({ block, editor, editable, logo }) {
  return (
    <div className="book-cover-top">
      {logo ? (
        <img className="book-cover-logo" src={logo} alt="이온토플" />
      ) : (
        <span className="book-cover-logo-text">이온토플</span>
      )}
      <DesignText as="span" className="book-cover-tag" block={block} editor={editor} editable={editable} field="tag" />
    </div>
  );
}

function VocaCoverBody({ block, editor, editable }) {
  const text = (field, as, className) => (
    <DesignText as={as} className={className} block={block} editor={editor} editable={editable} field={field} />
  );
  return (
    <>
      <div className="book-cover-rule" aria-hidden="true" />
      {text("wordmark", "p", "book-cover-wordmark")}
      <div className="book-cover-entry">
        <p className="book-cover-headline">
          {text("headword", "span", "book-cover-headword")}
          {text("pron", "span", "book-cover-pron")}
        </p>
        <p className="book-cover-sense">
          {text("pos", "i", "book-cover-pos")}
          {text("meaning", "span", "book-cover-meaning")}
        </p>
        <p className="book-cover-syn">
          <span className="book-cover-syn-label">syn.</span>{" "}
          {text("syn", "span", "book-cover-syn-text")}
        </p>
        {text("title", "h1", "book-cover-title")}
      </div>
      <div className="book-cover-tabs" aria-hidden="true">
        {VOCA_TABS.map((t, i) => <span key={t} data-tab={i + 1}>{t}</span>)}
      </div>
    </>
  );
}

// 단어장 back cover: small VOCABULARY, small VOCA, footer with logo, book name and
// copyright. The book name is a paragraph (not a heading) so it stays out of the outline.
function VocaBackBody({ block, editor, editable, logo }) {
  const text = (field, as, className) => (
    <DesignText as={as} className={className} block={block} editor={editor} editable={editable} field={field} />
  );
  return (
    <>
      {text("tag", "span", "book-cover-tag book-cover-back-tag")}
      {text("wordmark", "p", "book-cover-wordmark book-cover-back-mark")}
      <div className="book-cover-back-foot">
        <div className="book-cover-back-brand">
          {logo ? (
            <img className="book-cover-logo" src={logo} alt="이온토플" />
          ) : (
            <span className="book-cover-logo-text">이온토플</span>
          )}
          {text("title", "p", "book-cover-back-name")}
        </div>
        {text("copyright", "p", "book-cover-back-copy")}
      </div>
    </>
  );
}

// Full-width e-book cover. Text is edited in place; the R/L/W/S tiles are
// fixed series artwork and scale with the cover width (container units).
function BookCover({ block, editor, editable }) {
  const logo = safeHttpUrl(block.props.logoUrl);
  const variant = coverVariant(block.props);
  return (
    <section
      {...designRootEvents(editor, block, editable)}
      {...bookRootProps("cover", "neutral", { "data-cover-variant": variant })}
    >
      {variant === "voca-back" ? (
        <VocaBackBody block={block} editor={editor} editable={editable} logo={logo} />
      ) : (
        <>
          <CoverTop block={block} editor={editor} editable={editable} logo={logo} />
          {variant === "voca" ? (
            <VocaCoverBody block={block} editor={editor} editable={editable} />
          ) : (
            <IntroCoverBody block={block} editor={editor} editable={editable} />
          )}
        </>
      )}
      {editable ? (
        <EditorControls block={block} editor={editor}>
          <SelectControl
            label="표지 디자인"
            value={variant}
            options={COVER_VARIANT_OPTIONS}
            onChange={(next) => {
              const v = COVER_VARIANTS[next];
              if (v) updateBlockProps(editor, block, { variant: next, tag: v.tag, title: v.title });
            }}
          />
          <TextControl
            label="로고 이미지 URL"
            value={block.props.logoUrl}
            inputMode="url"
            spellCheck={false}
            help="http:// 또는 https:// 주소만 허용됩니다. 비우면 '이온토플' 글자로 표시됩니다."
            onChange={(logoUrl) => updateBlockProps(editor, block, { logoUrl })}
          />
        </EditorControls>
      ) : null}
    </section>
  );
}

function IntroCoverBody({ block, editor, editable }) {
  return (
    <>
      <div className="book-cover-tiles" aria-hidden="true">
        <span data-tile="r">R</span>
        <span data-tile="l">L</span>
        <span data-tile="w">W</span>
        <span data-tile="s">S</span>
        <span data-tile="next">+</span>
      </div>
      <div className="book-cover-text">
        <DesignText as="p" className="book-cover-label" block={block} editor={editor} editable={editable} field="label" />
        <DesignText as="h1" className="book-cover-title" block={block} editor={editor} editable={editable} field="title" />
        <p className="book-cover-hook">
          <DesignText as="span" block={block} editor={editor} editable={editable} field="hook" />
          <DesignText as="strong" block={block} editor={editor} editable={editable} field="hookStrong" />
        </p>
      </div>
    </>
  );
}

const bookCoverSpec = createReactBlockSpec(
  {
    type: "bookCover",
    propSchema: {
      logoUrl: { default: COVER_LOGO_URL },
      tag: { default: "E-BOOK" },
      label: { default: "TOEFL iBT®" },
      title: { default: "입문서" },
      hook: { default: "남들이 문제부터 풀 때," },
      hookStrong: { default: "합격자들은 시험부터 읽었습니다" },
      // 단어장 design (variant "voca"). Ignored by the 입문서 design.
      variant: { default: "intro" },
      wordmark: { default: "VOCA" },
      headword: { default: "vo·cab·u·lar·y" },
      pron: { default: "/vəˈkæbjəleri/" },
      pos: { default: "n." },
      meaning: { default: "어휘, 단어 목록" },
      syn: { default: "lexicon, word list" },
      // 단어장 back cover (variant "voca-back").
      copyright: { default: "© 2027 이온. ALL RIGHTS RESERVED." },
    },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: (props) => <BookCover {...props} editable />,
    toExternalHTML: (props) => <BookCover {...props} editable={false} />,
  },
)();

// Chunked English passage paired with its Korean reading (DESIGN 4-6).
// Props are plain lines: en/ko chunks (one per line), links "word|question" (one per line, between chunks).
const PAIR_COLORS = 3;
function splitLines(v) { return String(v || "").split("\n").map((s) => s.trim()).filter(Boolean); }
function PairRow({ chunks, links, lang, label }) {
  const out = [];
  if (label) out.push(<span className="book-pairs-label" key="label">{label}</span>);
  chunks.forEach((text, i) => {
    out.push(
      <span className="book-pairs-chunk" data-pair={(i % PAIR_COLORS) + 1} key={"c" + i}>
        <b className="book-pairs-no">{i + 1}</b>{text}
      </span>,
    );
    if (i < chunks.length - 1 && links[i]) {
      const [word, question] = links[i].split("|");
      out.push(<span className="book-pairs-link" key={"l" + i}>{lang === "ko" ? (question || word) : word}</span>);
    }
  });
  return <p className={"book-pairs-" + lang}>{out}</p>;
}
function BookPairs({ block, editor, editable }) {
  const p = block.props;
  const en = splitLines(p.en), ko = splitLines(p.ko), links = splitLines(p.links);
  return (
    <section
      {...designRootEvents(editor, block, editable)}
      {...bookRootProps("pairs", "neutral")}
      contentEditable={editable ? false : undefined}
    >
      <PairRow chunks={en} links={links} lang="en" />
      <PairRow chunks={ko} links={links} lang="ko" label={p.label} />
      {editable ? (
        <EditorControls block={block} editor={editor}>
          <TextControl label="영어 덩어리 (한 줄에 하나)" value={p.en} multiline rows={5} onChange={(v) => updateBlockProps(editor, block, { en: v })} />
          <TextControl label="해석 덩어리 (한 줄에 하나, 영어와 같은 순서)" value={p.ko} multiline rows={5} onChange={(v) => updateBlockProps(editor, block, { ko: v })} />
          <TextControl label="덩어리 사이 연결어 (한 줄에 하나, 영어|질문)" value={p.links} multiline rows={3} onChange={(v) => updateBlockProps(editor, block, { links: v })} />
          <TextControl label="해석 앞 표시" value={p.label} onChange={(v) => updateBlockProps(editor, block, { label: v })} />
        </EditorControls>
      ) : null}
    </section>
  );
}

const bookPairsSpec = createReactBlockSpec(
  {
    type: "bookPairs",
    propSchema: {
      en: { default: "First chunk\nSecond chunk" },
      ko: { default: "첫 번째 덩어리\n두 번째 덩어리" },
      links: { default: "that|that 무엇을?" },
      label: { default: "해석" },
    },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: (props) => <BookPairs {...props} editable />,
    toExternalHTML: (props) => <BookPairs {...props} editable={false} />,
  },
)();

// Score report card ("My Scores" look, no ETS marks). Numbers are the book's own examples.
const SCORE_SECTIONS = [["r", "Reading"], ["l", "Listening"], ["w", "Writing"], ["s", "Speaking"]];
function scorePercent(value, max) {
  const v = parseFloat(String(value).replace(/[^0-9.]/g, "")); const m = parseFloat(max);
  if (!isFinite(v) || !isFinite(m) || m <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((v / m) * 100)));
}
function BookScoreCard({ block, editor, editable }) {
  const p = block.props;
  return (
    <section
      {...designRootEvents(editor, block, editable)}
      {...bookRootProps("scorecard", "neutral")}
      contentEditable={editable ? false : undefined}
    >
      <DesignText as="p" className="book-score-label" block={block} editor={editor} editable={editable} field="label" />
      <div className="book-score-row">
        <div className="book-score-overall">
          <p className="book-score-name">Overall Score</p>
          <div className="book-score-gauge" style={{ "--score": scorePercent(p.overall, p.overallMax) }}>
            <span className="book-score-value"><DesignText as="b" block={block} editor={editor} editable={editable} field="overall" /> <small>of {p.overallMax}</small></span>
          </div>
          <DesignText as="p" className="book-score-sub" block={block} editor={editor} editable={editable} field="sub" />
        </div>
        <div className="book-score-tiles">
          {SCORE_SECTIONS.map(([key, name]) => (
            <div className="book-score-tile" key={key}>
              <p className="book-score-name">{name}</p>
              <p className="book-score-tilev"><DesignText as="b" block={block} editor={editor} editable={editable} field={key} /> <small>of {p.max}</small></p>
            </div>
          ))}
        </div>
      </div>
      {editable ? (
        <EditorControls block={block} editor={editor}>
          <TextControl label="영역 만점 (6 또는 30)" value={p.max} onChange={(max) => updateBlockProps(editor, block, { max })} />
          <TextControl label="전체 만점 (6 또는 120)" value={p.overallMax} onChange={(overallMax) => updateBlockProps(editor, block, { overallMax })} />
        </EditorControls>
      ) : null}
    </section>
  );
}

const bookScoreCardSpec = createReactBlockSpec(
  {
    type: "bookScoreCard",
    propSchema: {
      label: { default: "이렇게 나와요 (예시)" },
      overall: { default: "5.0" },
      overallMax: { default: "6" },
      sub: { default: "" },
      max: { default: "6" },
      r: { default: "5.0" },
      l: { default: "5.0" },
      w: { default: "5.0" },
      s: { default: "5.0" },
    },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: (props) => <BookScoreCard {...props} editable />,
    toExternalHTML: (props) => <BookScoreCard {...props} editable={false} />,
  },
)();

// Small legal/notice text (copyright, trademark). Sits at the bottom of the page,
// just above the printed page number. Text is ordinary inline content.
function BookFinePrint({ block, contentRef }) {
  return (
    <div {...bookRootProps("fineprint", "neutral")}>
      <p className="book-fineprint-text" ref={contentRef} />
    </div>
  );
}

const bookFinePrintSpec = createReactBlockSpec(
  {
    type: "bookFinePrint",
    propSchema: {},
    content: "inline",
  },
  {
    render: (props) => <BookFinePrint {...props} />,
    toExternalHTML: (props) => <BookFinePrint {...props} />,
  },
)();

const bookHeadingSpec = createReactBlockSpec(
  {
    type: "bookHeading",
    propSchema: {
      theme: { default: "neutral", values: DESIGN_THEMES },
      level: { default: "2", values: DESIGN_LEVELS },
    },
    content: "inline",
  },
  {
    render: (props) => <BookHeading {...props} editable />,
    toExternalHTML: (props) => <BookHeading {...props} editable={false} />,
  },
)();

const bookCalloutSpec = createReactBlockSpec(
  {
    type: "bookCallout",
    propSchema: {
      theme: { default: "neutral", values: DESIGN_THEMES },
      tone: { default: "info", values: DESIGN_TONES },
      title: { default: "학습 포인트" },
      bodyFont: { default: "paperlogy", values: ["paperlogy", "leeSeoyun", "nanumGothic"] },
    },
    content: "inline",
  },
  {
    render: (props) => <BookCallout {...props} editable />,
    toExternalHTML: (props) => <BookCallout {...props} editable={false} />,
  },
)();

const bookCompareSpec = createReactBlockSpec(
  {
    type: "bookCompare",
    propSchema: {
      theme: { default: "neutral", values: DESIGN_THEMES },
      title: { default: "두 개념 비교" },
      leftTitle: { default: "개념 A" },
      leftBody: { default: "첫 번째 개념의 특징을 입력하세요." },
      rightTitle: { default: "개념 B" },
      rightBody: { default: "두 번째 개념의 특징을 입력하세요." },
    },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: (props) => <BookCompare {...props} editable />,
    toExternalHTML: (props) => <BookCompare {...props} editable={false} />,
  },
)();

const bookAnnotatedSpec = createReactBlockSpec(
  {
    type: "bookAnnotated",
    propSchema: {
      theme: { default: "neutral", values: DESIGN_THEMES },
      title: { default: "지문과 해설" },
      passage: { default: "예시 문장을 읽고 핵심을 확인하세요." },
      passageFont: { default: "paperlogy", values: ["paperlogy", "nanumGothic"] },
      notes: { default: DEFAULT_NOTES },
    },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: (props) => <BookAnnotated {...props} editable />,
    toExternalHTML: (props) => <BookAnnotated {...props} editable={false} />,
  },
)();

const bookQuestionSpec = createReactBlockSpec(
  {
    type: "bookQuestion",
    propSchema: {
      theme: { default: "neutral", values: DESIGN_THEMES },
      title: { default: "확인 문제" },
      question: { default: "다음 중 알맞은 답을 고르세요." },
      options: { default: DEFAULT_OPTIONS },
    },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: (props) => <BookQuestion {...props} editable />,
    toExternalHTML: (props) => <BookQuestion {...props} editable={false} />,
  },
)();

const bookFlowSpec = createReactBlockSpec(
  {
    type: "bookFlow",
    propSchema: {
      theme: { default: "neutral", values: DESIGN_THEMES },
      title: { default: "판단 흐름" },
      start: { default: "상황을 먼저 확인합니다." },
      decision: { default: "핵심 조건을 충족하나요?" },
      leftLabel: { default: "예" },
      leftBody: { default: "다음 단계로 진행합니다." },
      rightLabel: { default: "아니요" },
      rightBody: { default: "조건을 다시 검토합니다." },
    },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: (props) => <BookFlow {...props} editable />,
    toExternalHTML: (props) => <BookFlow {...props} editable={false} />,
  },
)();

const bookMediaSpec = createReactBlockSpec(
  {
    type: "bookMedia",
    propSchema: {
      theme: { default: "neutral", values: DESIGN_THEMES },
      title: { default: "추가 학습 자료" },
      url: { default: "" },
      description: { default: "자료의 내용과 활용 방법을 입력하세요." },
      mediaType: { default: "link", values: DESIGN_MEDIA_TYPES },
    },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: (props) => <BookMedia {...props} editable />,
    toExternalHTML: (props) => <BookMedia {...props} editable={false} />,
  },
)();

export const designBlockSpecs = Object.freeze({
  bookHeading: bookHeadingSpec,
  bookCallout: bookCalloutSpec,
  bookCompare: bookCompareSpec,
  bookAnnotated: bookAnnotatedSpec,
  bookQuestion: bookQuestionSpec,
  bookFlow: bookFlowSpec,
  bookMedia: bookMediaSpec,
  bookCover: bookCoverSpec,
  bookFinePrint: bookFinePrintSpec,
  bookScoreCard: bookScoreCardSpec,
  bookPairs: bookPairsSpec,
});

export const designPresets = Object.freeze([
  {
    type: "bookHeading",
    label: "교재 제목",
    description: "교재 섹션을 구분하는 1~3단계 제목",
  },
  {
    type: "bookCallout",
    label: "강조 상자",
    description: "안내, 팁, 주의 내용을 강조하는 상자",
  },
  {
    type: "bookCompare",
    label: "비교",
    description: "두 개념을 나란히 비교하는 카드",
  },
  {
    type: "bookAnnotated",
    label: "지문 해설",
    description: "원문과 인용문별 해설을 연결하는 블록",
  },
  {
    type: "bookQuestion",
    label: "확인 문제",
    description: "정답과 해설을 포함한 객관식 문항",
  },
  {
    type: "bookFlow",
    label: "판단 흐름",
    description: "질문에서 두 갈래로 이어지는 학습 흐름",
  },
  {
    type: "bookMedia",
    label: "학습 자료",
    description: "안전한 외부 링크, 오디오, 비디오 자료",
  },
  {
    type: "bookCover",
    label: "표지",
    description: "로고, 제목, 카피가 들어간 전자책 표지",
  },
  {
    type: "bookFinePrint",
    label: "작은 안내 문구",
    description: "저작권·상표 고지처럼 쪽 맨 아래에 들어가는 작은 글씨",
  },
  {
    type: "bookScoreCard",
    label: "점수 성적 카드",
    description: "실제 성적 화면처럼 전체 점수와 영역 점수를 보여주는 예시 카드",
  },
  {
    type: "bookPairs",
    label: "끊어 읽기 짝 맞추기",
    description: "끊어 읽은 영어 덩어리와 해석을 같은 색과 번호로 짝지은 지문",
  },
]);

const BLOCK_DEFAULT_FACTORIES = Object.freeze({
  bookHeading: (theme) => ({
    type: "bookHeading",
    props: { theme, level: "2" },
    content: "새 섹션 제목",
  }),
  bookCallout: (theme) => ({
    type: "bookCallout",
    props: { theme, tone: "info", title: "학습 포인트" },
    content: "핵심 내용을 간단히 입력하세요.",
  }),
  bookCompare: (theme) => ({
    type: "bookCompare",
    props: {
      theme,
      title: "두 개념 비교",
      leftTitle: "개념 A",
      leftBody: "첫 번째 개념의 특징을 입력하세요.",
      rightTitle: "개념 B",
      rightBody: "두 번째 개념의 특징을 입력하세요.",
    },
  }),
  bookAnnotated: (theme) => ({
    type: "bookAnnotated",
    props: {
      theme,
      title: "지문과 해설",
      passage: "예시 문장을 읽고 핵심을 확인하세요.",
      notes: DEFAULT_NOTES,
    },
  }),
  bookQuestion: (theme) => ({
    type: "bookQuestion",
    props: {
      theme,
      title: "확인 문제",
      question: "다음 중 알맞은 답을 고르세요.",
      options: DEFAULT_OPTIONS,
    },
  }),
  bookFlow: (theme) => ({
    type: "bookFlow",
    props: {
      theme,
      title: "판단 흐름",
      start: "상황을 먼저 확인합니다.",
      decision: "핵심 조건을 충족하나요?",
      leftLabel: "예",
      leftBody: "다음 단계로 진행합니다.",
      rightLabel: "아니요",
      rightBody: "조건을 다시 검토합니다.",
    },
  }),
  bookMedia: (theme) => ({
    type: "bookMedia",
    props: {
      theme,
      title: "추가 학습 자료",
      url: "",
      description: "자료의 내용과 활용 방법을 입력하세요.",
      mediaType: "link",
    },
  }),
  bookCover: () => ({
    type: "bookCover",
    props: {
      logoUrl: COVER_LOGO_URL,
      tag: "E-BOOK",
      label: "TOEFL iBT®",
      title: "입문서",
      hook: "남들이 문제부터 풀 때,",
      hookStrong: "합격자들은 시험부터 읽었습니다",
    },
  }),
  bookPairs: () => ({
    type: "bookPairs",
    props: { en: "First chunk\nSecond chunk", ko: "첫 번째 덩어리\n두 번째 덩어리", links: "that|that 무엇을?", label: "해석" },
  }),
  bookScoreCard: () => ({
    type: "bookScoreCard",
    props: { label: "이렇게 나와요 (예시)", overall: "5.0", overallMax: "6", sub: "", max: "6", r: "5.0", l: "5.0", w: "5.0", s: "5.0" },
  }),
  bookFinePrint: () => ({
    type: "bookFinePrint",
    content: "© 2026 EONTOEFL. All rights reserved.",
  }),
});

export function createDesignBlock(type, theme = "neutral") {
  const factory = BLOCK_DEFAULT_FACTORIES[type];
  if (!factory) {
    throw new RangeError(`지원하지 않는 디자인 블록 타입입니다: ${type}`);
  }

  return factory(normalizeDesignTheme(theme));
}
