// ===== 마감 규칙 (공홈 관리자용) =====
//
// 원본은 테스트룸(nevelup-testroom) origin/main 의 아래 파일·행이다. 규칙이 바뀌면 여기도 같이 바꾼다.
//   - js/timezone-utils.js            67행 dateInTimezone(), 116행 getTaskDeadline()
//   - js/correction/correction-session.js
//       295행 getCorrSessionStartDate(), 333행 _parseCorrSessionDates(), 380행 getCorrSessionDate(),
//       470행 _pickCorrExt(), 485행 _applyCorrExt(), 500행 getCorrDraft1Deadline(),
//       512행 getCorrDraft2DeadlineFromRelease()
//   - js/correction-schedule-data.js / -aus.js  dayOffset 표
//   - js/correction/correction-main.js 283행  과제 라벨 순서(일반=라이팅 먼저, 호주=스피킹 먼저)
//   - js/mypage.js 135~136행                  내챌 연장 마감 = getTaskDeadline(원래 날짜) + extra_days×24h
//
// 테스트룸 원본은 sessionStorage 의 로그인 학생 시간대(getUserTimezone)와 트랙(getCorrectionTrack)에
// 의존하지만, 관리자 화면에는 그런 것이 없으므로 시간대를 인자로 받도록만 최소 수정했다. 로직은 동일.
//
// 브라우저 전역 함수 방식(다른 js 파일과 동일). supabase-config.js 다음에 로드한다.

// ------------------------------------------------------------
// 1. 시간대 계산 (테스트룸 js/timezone-utils.js 그대로)
// ------------------------------------------------------------

/**
 * 특정 타임존의 특정 날짜 HH:MM을 UTC Date 객체로 변환
 * @param {number} year
 * @param {number} month - 0-based (JS Date 기준)
 * @param {number} date
 * @param {number} hours
 * @param {number} minutes
 * @param {string} timezone - IANA timezone
 * @returns {Date} UTC 기준 Date 객체
 */
function dateInTimezone(year, month, date, hours, minutes, timezone) {
    // 해당 타임존의 날짜/시간을 ISO 문자열로 만들고 offset 계산
    var target = new Date(Date.UTC(year, month, date, hours, minutes, 0));

    // target을 해당 timezone으로 해석했을 때의 실제 시각을 구함
    var formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });

    // 이진 탐색으로 정확한 UTC 시각 찾기
    // 원리: UTC 시각을 조정해서 해당 timezone으로 변환했을 때 원하는 날짜/시간이 나오게 함
    var low = target.getTime() - 24 * 60 * 60 * 1000;
    var high = target.getTime() + 24 * 60 * 60 * 1000;

    for (var i = 0; i < 30; i++) {
        var mid = Math.floor((low + high) / 2);
        var midDate = new Date(mid);
        var parts = formatter.formatToParts(midDate);
        var p = {};
        parts.forEach(function(part) {
            if (part.type === 'year') p.year = parseInt(part.value);
            if (part.type === 'month') p.month = parseInt(part.value);
            if (part.type === 'day') p.day = parseInt(part.value);
            if (part.type === 'hour') p.hour = parseInt(part.value) === 24 ? 0 : parseInt(part.value);
            if (part.type === 'minute') p.minute = parseInt(part.value);
        });

        var targetVal = year * 100000000 + (month + 1) * 1000000 + date * 10000 + hours * 100 + minutes;
        var midVal = p.year * 100000000 + p.month * 1000000 + p.day * 10000 + p.hour * 100 + p.minute;

        if (midVal === targetVal) return midDate;
        if (midVal < targetVal) low = mid;
        else high = mid;
    }

    return new Date(Math.floor((low + high) / 2));
}

/**
 * 과제 날짜(YYYY-MM-DD or Date)에 대한 데드라인(다음날 04:00) 계산
 * 학생의 타임존 기준으로 계산됨
 *
 * @param {Date|string} taskDate - 과제 날짜
 * @param {string} [timezone] - IANA timezone (생략 시 Asia/Seoul — 원본은 로그인 학생 시간대 getUserTimezone())
 * @returns {Date} 데드라인 (UTC Date 객체, 비교 가능)
 */
function getTaskDeadline(taskDate, timezone) {
    var tz = timezone || 'Asia/Seoul';

    var td;
    if (typeof taskDate === 'string') {
        var parts = taskDate.split('-');
        td = { year: parseInt(parts[0]), month: parseInt(parts[1]) - 1, date: parseInt(parts[2]) };
    } else {
        // Date 객체 → 타임존 무관하게 날짜 부분만 추출
        // taskDate는 startDate 기준으로 setDate()로 만들어진 로컬 Date이므로 그대로 사용
        td = { year: taskDate.getFullYear(), month: taskDate.getMonth(), date: taskDate.getDate() };
    }

    // 다음날 04:00
    var nextDay = new Date(td.year, td.month, td.date + 1);
    return dateInTimezone(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate(), 4, 0, tz);
}

// ------------------------------------------------------------
// 2. 첨삭 세션 배정일 (테스트룸 js/correction/correction-session.js 그대로)
// ------------------------------------------------------------

/**
 * 세션의 기준 시작일 반환
 *   - 1학기(phase 1): scheduleData.start_date
 *   - 2학기/연장(phase 2): scheduleData.extension_start_date
 * 연장 시작일이 없으면 안전하게 start_date로 폴백.
 * @param {object} scheduleData - correction_schedules 행
 * @param {object} session - CORRECTION_SCHEDULE 항목
 * @returns {string} 'YYYY-MM-DD'
 */
function getCorrSessionStartDate(scheduleData, session) {
    if (session && session.phase === 2 && scheduleData && scheduleData.extension_start_date) {
        return scheduleData.extension_start_date;
    }
    return scheduleData ? scheduleData.start_date : null;
}

/**
 * 저장된 확정 일정표(session_dates) 파싱.
 * 문자열이면 JSON.parse, 객체면 그대로. dates가 길이 12 배열이고 각 원소가 YYYY-MM-DD면 반환, 아니면 null.
 * @param {string|object} raw
 * @returns {{start:string, end:string, dates:string[]}|null}
 */
function _parseCorrSessionDates(raw) {
    if (!raw) return null;
    var obj;
    if (typeof raw === 'string') {
        try { obj = JSON.parse(raw); } catch (e) { return null; }
    } else if (typeof raw === 'object') {
        obj = raw;
    } else {
        return null;
    }
    if (!obj || !Array.isArray(obj.dates) || obj.dates.length !== 12) return null;
    for (var i = 0; i < 12; i++) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(obj.dates[i])) return null;
    }
    return { start: obj.start, end: obj.end, dates: obj.dates };
}

/**
 * 세션의 배정 날짜(로컬 00:00 Date) 또는 null.
 *   - phase 1이고 저장된 확정 일정표(session_dates)에 그 세션 날짜가 있으면 그 날짜(자기주도).
 *   - phase 2이고 연장 확정 일정표(extension_session_dates)에 그 세션 날짜가 있으면 그 날짜(연장 자기주도).
 *   - 그 외: (해당 학기 시작일) + dayOffset. (기존 학생·연장·호주 전부 이 줄.)
 * @param {object} scheduleData
 * @param {object} session - CORRECTION_SCHEDULE 항목
 * @returns {Date|null}
 */
function getCorrSessionDate(scheduleData, session) {
    if (session && session.phase !== 2) {
        var parsed = _parseCorrSessionDates(scheduleData && scheduleData.session_dates);
        if (parsed && parsed.dates[session.session - 1]) {
            return new Date(parsed.dates[session.session - 1] + 'T00:00:00');
        }
    } else if (session && session.phase === 2) {
        var parsedExt = _parseCorrSessionDates(scheduleData && scheduleData.extension_session_dates);
        if (parsedExt && parsedExt.dates[session.session - 13]) {
            return new Date(parsedExt.dates[session.session - 13] + 'T00:00:00');
        }
    }
    var base = getCorrSessionStartDate(scheduleData, session);
    if (!base) return null;
    var d = new Date(base + 'T00:00:00');
    d.setDate(d.getDate() + session.dayOffset);
    return d;
}

// ------------------------------------------------------------
// 3. 연장 적용 + 1차/2차 마감 (테스트룸 js/correction/correction-session.js 그대로)
// ------------------------------------------------------------

/**
 * 연장 묶음에서 해당 차수의 연장을 꺼낸다.
 * 예전 형태(숫자 / 차수 없는 객체)도 그대로 받아준다.
 *
 * @param {number} round - 1 = 1차, 2 = 2차
 */
function _pickCorrExt(ext, round) {
    if (!ext) return null;
    if (typeof ext === 'number') return ext > 0 ? { hours: ext, at: null } : null;
    if (ext.hours) return ext;   // 차수 구분 없는 옛 형태
    var e = (round === 2) ? ext.r2 : ext.r1;
    return (e && e.hours) ? e : null;
}

/**
 * 마감에 연장을 적용한다.
 *
 * 기준점 = max(원래 마감, 연장을 건 시각)
 *   - 마감 전에 연장 → 원래 마감 + N시간 (기존과 동일)
 *   - 마감 후에 연장 → 연장을 건 시각 + N시간 (이전에는 이미 지난 시각이 나와 무의미했다)
 */
function _applyCorrExt(base, ext, round) {
    var e = _pickCorrExt(ext, round);
    if (!e) return base;
    var anchor = (e.at && e.at > base) ? e.at : base;
    return new Date(anchor.getTime() + e.hours * 60 * 60 * 1000);
}

/**
 * 1차 Draft 데드라인: sessionDate 다음날 04:00 (학생 타임존 기준) + 연장.
 * sessionDate(로컬 Date)는 getCorrSessionDate()가 결정한다 — 자기주도/기존/연장/호주 한 출처.
 * sessionDate가 null이면 null 반환(호출처는 잠금·마감 행을 생략).
 * @param {Date|null} sessionDate
 * @param {object} ext
 * @param {string} timezone - 학생 시간대 (원본은 getUserTimezone())
 * @returns {Date|null}
 */
function getCorrDraft1Deadline(sessionDate, ext, timezone) {
    if (!sessionDate) return null;
    return _applyCorrExt(getTaskDeadline(sessionDate, timezone), ext, 1);
}

/**
 * 2차 Draft 데드라인: 1차 첨삭 **공개** 시각(released_1_at) + 24시간 (+연장). 스케줄 바닥 없음.
 * 카톡(1차 첨삭 완료 안내)의 "수정본 마감"과 같은 기준이라 앱·카톡 숫자가 일치한다.
 * 앵커가 없으면 feedback_1_at(레거시 행 예비), 둘 다 없으면 null → 호출처는 null이면 차단·카운트다운을 생략한다.
 */
function getCorrDraft2DeadlineFromRelease(releasedAt, feedback1At, ext) {
    var anchor = releasedAt || feedback1At;
    if (!anchor) return null;
    return _applyCorrExt(new Date(new Date(anchor).getTime() + 24 * 60 * 60 * 1000), ext, 2);
}

// ------------------------------------------------------------
// 4. 공홈 추가분 — 세션 표, 과제 라벨, 알림톡 표기
// ------------------------------------------------------------

/**
 * 세션별 dayOffset (테스트룸 correction-schedule-data.js / -aus.js 와 동일).
 * 1~12세션은 start_date 기준, 13~24세션은 extension_start_date 기준으로 같은 표를 반복한다.
 */
var CORR_DAY_OFFSETS = [0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25];

/**
 * 세션 번호 → getCorrSessionDate()가 받는 세션 항목 { session, phase, dayOffset }
 * @param {number|string} sessionNumber - 1~24
 * @returns {object|null}
 */
function getCorrSessionMeta(sessionNumber) {
    var s = parseInt(sessionNumber, 10);
    if (!s || s < 1 || s > 24) return null;
    return {
        session: s,
        phase: s >= 13 ? 2 : 1,
        dayOffset: CORR_DAY_OFFSETS[(s - 1) % 12]
    };
}

/**
 * 연장 행(correction_deadline_extensions) → _applyCorrExt 가 받는 연장 정보 { hours, at }
 * 테스트룸은 행의 created_at 을 '연장을 건 시각'으로 읽는다(덮어써도 처음 값). 그대로 따른다.
 */
function corrExtFromRow(row) {
    if (!row || !row.extended_hours) return null;
    return {
        hours: row.extended_hours,
        at: row.created_at ? new Date(row.created_at) : null
    };
}

/**
 * 알림톡용 과제 라벨 (테스트룸 카드와 같은 글자).
 * admin-correction.js 의 CORR_TASK_META 라벨은 호주가 줄임말(토라 등)이라 알림톡에는 쓰지 않는다.
 */
var CORR_ALIMTALK_TASK_LABELS = {
    writing_email:            'Email',
    writing_discussion:       'Discussion',
    speaking_interview:       'Interview',
    writing_aus_discussion:   'DISCUSSION',
    writing_aus_integrated:   'INT WRT',
    speaking_aus_independent: 'IND SPK',
    speaking_aus_int2:        'INT SPK 2',
    speaking_aus_int3:        'INT SPK 3',
    speaking_aus_int4:        'INT SPK 4'
};

function getCorrAlimtalkTaskLabel(taskType) {
    return CORR_ALIMTALK_TASK_LABELS[(taskType || '').toLowerCase()] || (taskType || '');
}

/**
 * 세션에 배정된 과제 2개(task_type)를 테스트룸 카드 순서로.
 *   일반 (1~24): 라이팅 홀수=Email / 짝수=Discussion, 스피킹은 항상 Interview. 라이팅 먼저.
 *   호주 (1~12): 라이팅 홀수=DISCUSSION / 짝수=INT WRT, 스피킹은 IND SPK→INT SPK 2→3→4 순환. 스피킹 먼저.
 */
function getCorrSessionTaskTypes(sessionNumber, isAus) {
    var s = parseInt(sessionNumber, 10);
    if (!s) return [];

    if (isAus) {
        var writingAus = (s % 2 === 1) ? 'writing_aus_discussion' : 'writing_aus_integrated';
        var speakingCycle = ['speaking_aus_independent', 'speaking_aus_int2',
                             'speaking_aus_int3', 'speaking_aus_int4'];
        return [speakingCycle[(s - 1) % 4], writingAus];
    }

    var writing = (s % 2 === 1) ? 'writing_email' : 'writing_discussion';
    return [writing, 'speaking_interview'];
}

/**
 * 과제 유형 목록 → 알림톡 #{tasks} 문자열. 세션 순서(일반=라이팅 먼저, 호주=스피킹 먼저)로 정렬해 ' + '로 잇는다.
 * @param {string[]} taskTypes
 * @param {number|string} sessionNumber
 * @param {boolean} isAus
 */
function formatCorrTasksForAlimtalk(taskTypes, sessionNumber, isAus) {
    var order = getCorrSessionTaskTypes(sessionNumber, isAus);
    var sorted = (taskTypes || []).slice().sort(function(a, b) {
        var ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return sorted.map(getCorrAlimtalkTaskLabel).join(' + ');
}

/** 세션 전체 과제 라벨 (예: 'Email + Interview', 'INT SPK 2 + INT WRT') */
function getCorrSessionTasksLabel(sessionNumber, isAus) {
    return formatCorrTasksForAlimtalk(getCorrSessionTaskTypes(sessionNumber, isAus), sessionNumber, isAus);
}

var _ALIMTALK_DAY_KR = { Sun: '일', Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토' };

/**
 * 알림톡 #{deadline} 표기: 학생 시간대로 'M/D(요일) HH:MI'. 시간대가 Asia/Seoul 이 아니면 ' (현지 시간)'을 붙인다.
 * @param {Date} date
 * @param {string} timezone
 */
function formatDeadlineForAlimtalk(date, timezone) {
    var tz = timezone || 'Asia/Seoul';
    var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        month: 'numeric', day: 'numeric', weekday: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(date);
    var p = {};
    parts.forEach(function(part) { p[part.type] = part.value; });
    var hour = parseInt(p.hour, 10) === 24 ? '00' : p.hour;
    var text = p.month + '/' + p.day + '(' + (_ALIMTALK_DAY_KR[p.weekday] || '') + ') ' + hour + ':' + p.minute;
    if (tz !== 'Asia/Seoul') text += ' (현지 시간)';
    return text;
}

/**
 * 알림톡 #{task_date} 표기: 'YYYY-MM-DD' → 'M/D(요일)'
 */
function formatTaskDateForAlimtalk(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return ymd || '';
    var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    var dayKr = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + dayKr + ')';
}
