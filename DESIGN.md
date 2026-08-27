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

---

## 7. 후속메일 시스템 (Follow-up Mail) — 발송 전 검토·관리 대시보드

> 신청 퍼널에서 이탈했거나 다음 단계로 넘어갈 학생에게 보내는 "후속메일"을 원래 대상 시점에 자동 생성하고, 자동 발송 전에 대표가 확인·수정·취소할 수 있게 하는 **공홈 측 관리자 화면**. 생성·검사·발송 파이프라인 본체는 별도 폴더(`C:\후속메일 자동화\`)에서 관리한다.

### 7.1 구성 요소 (이 저장소)
*   **`admin-followup.html`** — 관리자 전용 대시보드. 최종 형태는 전체·발송 예정·검사 보류·발송 제외를 구분한다. 발송 예정 건에는 남은 시간·받는 사람·제목·본문과 `수정 저장`·`발송 취소`·`지금 발송`을 제공한다.
*   **Edge Function `supabase/functions/followup-admin/`** — `followup_jobs` + `followup_messages` + 신청서(`applications`) + 발송 제외 목록(`followup_suppressions`)을 읽고, 최종 형태에서는 발송 예정 메일의 수정·한 통 취소·지금 발송 요청도 처리한다. v2 관측 컬럼 적용 전 라이브 표도 읽을 수 있도록 v1 호환 조회를 둔다.

### 7.2 데이터 테이블 (Supabase, RLS 로 anon 전면 차단 → service_role 만 접근)
*   **`followup_jobs`** — 누구에게 / 어떤 단계(`stage1`·`stage2`·`stage3a`·`stage3b`) / 언제(`scheduled_at`) 보낼지 + 상태(`scheduled`…`sent`·`canceled`·`held`).
*   **`followup_messages`** — 생성된 제목·본문 + 관측 컬럼(`used_review_id`·`used_materials`·`machine_check_result`·`self_check`·`tone_score`). 재생성은 제자리 upsert(`unique(job_id)`).
*   **`followup_activity_logs`** — 예약·수정·승인·취소·발송·실패 이력.
*   **`followup_suppressions`** — 대표·직원·시험용 계정과 연락 중단 요청자를 모든 단계에서 제외하는 영구 발송 제외 목록. 활성 회원번호 또는 정규화 이메일이 일치하면 후보에서 빠진다.
*   **참조 데이터 표** — `reviews`(후기표)·`story_materials`(실화재료)·`score_table`(환산표)·`lexicon`(검사어휘표)·`review_combo`(결합 마스크)·`rule_bundles`(규칙 배포본). 모두 RLS 잠금.

### 7.3 절대 규칙 (Non-negotiable)
*   **학생에게 실제 메일을 보내는 기능(Gmail 발송)은 대표 명시 승인 전까지 금지.** 후보 스캔·초안 생성도 실발송과 묶여 승인 전엔 자동 가동하지 않는다. 이 저장소의 화면·함수는 **읽기·관측·보류 표시까지만** 한다.
*   후속메일 테이블은 **anon 직접 조회 불가**(RLS). 반드시 서버 함수(service_role) 경유로만 읽는다.
*   중복발송 방지(`unique(application_id, stage)` + 원자선점)·대상 신선도 상한은 파이프라인 본체의 불변 규칙이며 화면에서 건드리지 않는다.
*   신선도 상한을 지난 건은 뒤늦게 메일을 만들지 않고 `skipped` 기록만 남긴다. 발송 예정 목록에는 표시하지 않는다.
*   정상 대상은 원래 시점에 초안을 만든 뒤 `awaiting_review`로 발송 예정 목록에 올린다. 대표가 유예 시간 안에 아무 작업도 하지 않으면 자동 발송한다. 정확한 유예 시간은 회의에서 확정한다(현재 제안 1시간).
*   신청서 종류는 `applications.application_type`으로 구별하고, 학생 이메일은 `applications.email`을 사용한다. 공통값 `admin`이 들어 있는 `applications.user_email`은 학생 구별에 쓰지 않는다.
