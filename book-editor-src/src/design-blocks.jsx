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

function updateBlockProps(editor, block, patch) {
  editor.updateBlock(block.id, { props: patch });
}

function stopEditorEvent(event) {
  event.stopPropagation();
}

function EditorControls({ children }) {
  return (
    <details
      className="book-design-controls"
      contentEditable={false}
      onKeyDown={stopEditorEvent}
      onKeyUp={stopEditorEvent}
      onPointerDown={stopEditorEvent}
      onClick={stopEditorEvent}
    >
      <summary>디자인 편집</summary>
      <div>{children}</div>
    </details>
  );
}

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
      value={value}
      rows={rows}
      inputMode={inputMode}
      spellCheck={spellCheck}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ) : (
    <input
      type="text"
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
      {...bookRootProps("heading", block.props.theme, {
        "data-book-level": level,
      })}
    >
      <HeadingTag className="book-design-title" ref={contentRef} />
      {editable ? (
        <EditorControls>
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
      {...bookRootProps("callout", block.props.theme, {
        "data-book-tone": block.props.tone,
      })}
    >
      <h3 className="book-design-title">{block.props.title}</h3>
      <div className="book-design-body" data-book-font={block.props.bodyFont} ref={contentRef} />
      {editable ? (
        <EditorControls>
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

function CompareBody({ block }) {
  return (
    <>
      <h3 className="book-design-title">{block.props.title}</h3>
      <div className="book-design-columns">
        <section className="book-design-panel">
          <h4 className="book-design-label">{block.props.leftTitle}</h4>
          <div className="book-design-body">{block.props.leftBody}</div>
        </section>
        <section className="book-design-panel">
          <h4 className="book-design-label">{block.props.rightTitle}</h4>
          <div className="book-design-body">{block.props.rightBody}</div>
        </section>
      </div>
    </>
  );
}

function BookCompare({ block, editor, editable }) {
  return (
    <section
      {...bookRootProps("compare", block.props.theme)}
      contentEditable={editable ? false : undefined}
    >
      <CompareBody block={block} />
      {editable ? (
        <EditorControls>
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
      {...bookRootProps("annotated", block.props.theme)}
      contentEditable={editable ? false : undefined}
    >
      <h3 className="book-design-title">{block.props.title}</h3>
      <div className="book-design-panel">
        <div className="book-design-label">원문</div>
        <blockquote className="book-design-body" data-book-font={block.props.passageFont}>
          <p>{block.props.passage}</p>
        </blockquote>
      </div>
      <ol aria-label="인용문 해설">
        {parsed.items.map((item, index) => {
          const matched = quoteOccursInPassage(block.props.passage, item.quote);
          return (
            <li key={index} data-book-quote-matched={matched ? "true" : "false"}>
              <blockquote className="book-design-panel">
                <div className="book-design-label">인용문 {index + 1}</div>
                <p>{item.quote}</p>
              </blockquote>
              <div className="book-design-note" data-book-font={item.font || "paperlogy"}>{item.note}</div>
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
        <EditorControls>
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
              items={parsed.items}
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
      {...bookRootProps("question", block.props.theme)}
      contentEditable={editable ? false : undefined}
    >
      <h3 className="book-design-title">{block.props.title}</h3>
      <div className="book-design-body">{block.props.question}</div>
      <ol className="book-design-options">
        {parsed.items.map((option, index) => (
          <li
            className="book-design-option"
            data-correct={option.correct ? "true" : "false"}
            data-book-correct={option.correct ? "true" : "false"}
            key={index}
          >
            <div>
              <span className="book-design-label">
                {option.label || String(index + 1)}
              </span>{" "}
              <span>{option.text}</span>
            </div>
            <div className="book-design-note">
              <strong className="book-design-label">
                {option.correct ? "정답" : "오답"}
              </strong>
              {option.explanation ? `: ${option.explanation}` : null}
            </div>
          </li>
        ))}
      </ol>
      <DataWarnings result={parsed} />
      {editable ? (
        <EditorControls>
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
              items={parsed.items}
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
      {...bookRootProps("flow", block.props.theme)}
      contentEditable={editable ? false : undefined}
    >
      <h3 className="book-design-title">{block.props.title}</h3>
      <div className="book-design-flow-start">
        <span className="book-design-label">시작</span>
        <div className="book-design-body">{block.props.start}</div>
      </div>
      <div className="book-design-flow-decision">
        <span className="book-design-label">판단</span>
        <div className="book-design-body">{block.props.decision}</div>
      </div>
      <div className="book-design-flow-branches">
        <section className="book-design-flow-branch book-design-panel">
          <h4 className="book-design-label">{block.props.leftLabel}</h4>
          <div className="book-design-body">{block.props.leftBody}</div>
        </section>
        <section className="book-design-flow-branch book-design-panel">
          <h4 className="book-design-label">{block.props.rightLabel}</h4>
          <div className="book-design-body">{block.props.rightBody}</div>
        </section>
      </div>
      {editable ? (
        <EditorControls>
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
      {...bookRootProps("media", block.props.theme)}
      contentEditable={editable ? false : undefined}
    >
      <h3 className="book-design-title">{block.props.title}</h3>
      <div className="book-design-body">{block.props.description}</div>
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
        <EditorControls>
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
});

export function createDesignBlock(type, theme = "neutral") {
  const factory = BLOCK_DEFAULT_FACTORIES[type];
  if (!factory) {
    throw new RangeError(`지원하지 않는 디자인 블록 타입입니다: ${type}`);
  }

  return factory(normalizeDesignTheme(theme));
}
