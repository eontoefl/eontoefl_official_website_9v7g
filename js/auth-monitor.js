/**
 * ================================================
 * auth-monitor.js
 * 인증시스템 — 학습 행동 감지 + 인증률 계산 + Supabase 기록 저장
 * ================================================
 * 
 * 감지 항목:
 * 1. 화면 이탈 (포커스 상실) — 위반은 아니지만 횟수 기록
 * 2. 시간 50% 미만 사용 — 1차 풀이에서 너무 빨리 끝낸 경우
 * 3. 2차 풀이에서 선택 안 함 — 더블체크를 건너뛴 경우 (reading/listening)
 * 4. 채점 화면에서 텍스트 없음 — 리뷰를 하지 않은 경우 (추후 구현)
 * 5. 전체 워크플로우 완료 여부 — 끝까지 진행했는지
 * 
 * ★ 기존 코드를 수정하지 않습니다.
 *   FlowController.start / .finish 를 감싸서(wrap) 시작/종료 시점을 감지합니다.
 *   WritingFlow.runStep12 도 감싸서 라이팅 종료를 감지합니다.
 */

const AuthMonitor = {
    // ========================================
    // 상태 추적 변수
    // ========================================
    isActive: false,                // 과제 진행 중 여부
    sectionType: null,              // 현재 섹션 타입
    moduleNumber: null,             // 현재 모듈 번호
    focusLostCount: 0,              // 화면 이탈 횟수
    firstAttemptStartTime: null,    // 1차 풀이 시작 시각
    firstAttemptEndTime: null,      // 1차 풀이 종료 시각
    timeLimit: 0,                   // 제한 시간 (초)
    secondAttemptChanged: false,    // 2차에서 답변을 변경했는지
    gradingTextEntered: false,      // 채점 화면에서 텍스트 입력했는지
    workflowCompleted: false,       // 전체 워크플로우 완료 여부

    // ========================================
    // 초기화 — 과제 시작 시 호출
    // ========================================
    start(sectionType, moduleNumber) {
        console.log('🔒 [AuthMonitor] 감시 시작:', sectionType, '모듈', moduleNumber);
        
        this.isActive = true;
        this.sectionType = sectionType;
        this.moduleNumber = moduleNumber;
        this.focusLostCount = 0;
        this.firstAttemptStartTime = Date.now();
        this.firstAttemptEndTime = null;
        this.timeLimit = this.getTimeLimit(sectionType);
        this.secondAttemptChanged = false;
        this.gradingTextEntered = false;
        this.workflowCompleted = false;

        // 화면 이탈 감지 시작
        this.startFocusMonitoring();
    },

    // ========================================
    // 종료 — 과제 완료 시 호출
    // ========================================
    stop() {
        console.log('🔒 [AuthMonitor] 감시 종료');
        this.isActive = false;
        this.sectionType = null;
        this.moduleNumber = null;
        this.stopFocusMonitoring();
    },

    // ========================================
    // 1. 화면 이탈 감지
    // ========================================
    _onVisibilityChange: null,
    _onBlur: null,

    startFocusMonitoring() {
        // 기존 리스너가 있으면 먼저 제거
        this.stopFocusMonitoring();

        // 탭 전환 감지
        this._onVisibilityChange = () => {
            if (document.hidden && this.isActive) {
                this.focusLostCount++;
                console.log('👁️ [AuthMonitor] 화면 이탈 감지 (탭 전환) — 횟수:', this.focusLostCount);
            }
        };

        // 창 포커스 상실 감지
        this._onBlur = () => {
            if (this.isActive) {
                this.focusLostCount++;
                console.log('👁️ [AuthMonitor] 화면 이탈 감지 (포커스 상실) — 횟수:', this.focusLostCount);
            }
        };

        document.addEventListener('visibilitychange', this._onVisibilityChange);
        window.addEventListener('blur', this._onBlur);
    },

    stopFocusMonitoring() {
        if (this._onVisibilityChange) {
            document.removeEventListener('visibilitychange', this._onVisibilityChange);
            this._onVisibilityChange = null;
        }
        if (this._onBlur) {
            window.removeEventListener('blur', this._onBlur);
            this._onBlur = null;
        }
    },

    // ========================================
    // 2. 시간 50% 미만 사용 감지
    // ========================================
    getTimeLimit(sectionType) {
        // 섹션별 기본 제한 시간 (초)
        const limits = {
            'reading': 1200,    // 20분
            'listening': 600,   // 약 10분 (전체 기준)
            'writing': 1800,    // 약 30분 (전체 기준)
            'speaking': 600     // 약 10분
        };
        return limits[sectionType] || 1200;
    },

    recordFirstAttemptEnd() {
        this.firstAttemptEndTime = Date.now();
        const usedSeconds = Math.round((this.firstAttemptEndTime - this.firstAttemptStartTime) / 1000);
        console.log('⏱️ [AuthMonitor] 1차 풀이 종료 기록 — 소요시간:', usedSeconds, '초');
    },

    isTimeFlagTriggered() {
        if (!this.firstAttemptStartTime || !this.firstAttemptEndTime) return false;
        const usedTime = (this.firstAttemptEndTime - this.firstAttemptStartTime) / 1000;
        const halfLimit = this.timeLimit / 2;
        const triggered = usedTime < halfLimit;
        console.log('⏱️ [AuthMonitor] 시간 체크: ' + Math.round(usedTime) + '초 사용 / 제한 ' + this.timeLimit + '초의 50% = ' + halfLimit + '초 → ' + (triggered ? '⚠️ 플래그' : '✅ 정상'));
        return triggered;
    },

    // ========================================
    // 3. 2차 풀이에서 선택 변경 여부
    // ========================================
    recordSecondAttemptChange() {
        this.secondAttemptChanged = true;
        console.log('✏️ [AuthMonitor] 2차 풀이에서 답변 변경 감지');
    },

    // ========================================
    // 4. 채점 화면에서 텍스트 입력 여부
    // ========================================
    recordGradingText() {
        this.gradingTextEntered = true;
        console.log('📝 [AuthMonitor] 채점 화면 텍스트 입력 감지');
    },

    // ========================================
    // 5. 워크플로우 완료 표시
    // ========================================
    recordWorkflowComplete() {
        this.workflowCompleted = true;
        console.log('✅ [AuthMonitor] 전체 워크플로우 완료');
    },

    // ========================================
    // 인증률 계산
    // ========================================
    calculateAuthRate() {
        var rate = 100;
        var flags = [];

        // 워크플로우 미완료: 인증률 0%
        if (!this.workflowCompleted) {
            console.log('🔒 [AuthMonitor] 워크플로우 미완료 → 인증률 0%');
            return { rate: 0, flags: ['workflow_incomplete'] };
        }

        // 시간 50% 미만 사용: -30%
        if (this.isTimeFlagTriggered()) {
            rate -= 30;
            flags.push('time_under_50');
        }

        // 2차 풀이에서 선택 안 함: -20% (reading/listening만 해당)
        if ((this.sectionType === 'reading' || this.sectionType === 'listening') && !this.secondAttemptChanged) {
            rate -= 20;
            flags.push('no_selection');
        }

        // 채점에서 텍스트 없음: -20% (추후 구현)
        // if (!this.gradingTextEntered) {
        //     rate -= 20;
        //     flags.push('no_grading_text');
        // }

        // 화면 이탈: 기록만 (감점 없음)
        if (this.focusLostCount > 0) {
            flags.push('focus_lost_' + this.focusLostCount);
        }

        rate = Math.max(0, Math.min(100, rate));
        console.log('🔒 [AuthMonitor] 인증률 계산: ' + rate + '% (플래그: ' + flags.join(', ') + ')');

        return { rate: rate, flags: flags };
    },

    // ========================================
    // Supabase에 기록 저장
    // ========================================
    async saveRecords() {
        // FlowController 또는 WritingFlow에서 결과 가져오기
        var fc = window.FlowController;
        var wf = window.WritingFlow;

        var user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
        if (!user || !user.id || user.id === 'dev-user-001') {
            console.log('🔒 [AuthMonitor] 개발 모드 — 기록 저장 생략');
            return;
        }

        // 결과 데이터 추출
        var firstResult = null;
        // ★ 스냅샷이 있으면 스냅샷에서, 없으면 현재 상태에서 데이터 가져오기
        var snap = this._snapshot || {};
        var sectionType = snap.sectionType || this.sectionType;
        var moduleNumber = snap.moduleNumber || this.moduleNumber;

        if (sectionType === 'writing' && wf && wf.arrange1stResult) {
            // WritingFlow에서 결과 추출
            firstResult = wf.arrange1stResult;
        } else if (snap.firstAttemptResult) {
            firstResult = snap.firstAttemptResult;
        } else if (fc) {
            firstResult = fc.firstAttemptResult;
        }

        // 점수 추출
        var score = 0;
        var total = 0;
        var timeSpent = 0;
        var detail = {};

        if (firstResult) {
            score = firstResult.correctCount || 0;
            total = firstResult.totalQuestions || 0;
            timeSpent = firstResult.totalTimeSpent || 0;

            // 컴포넌트별 상세 점수 추출
            if (firstResult.componentResults) {
                firstResult.componentResults.forEach(function(comp) {
                    var key = comp.componentType + '_' + (comp.setId || '1');
                    var correct = comp.correctCount || 0;
                    var compTotal = comp.totalQuestions || comp.questionsPerSet || 0;
                    detail[key] = correct + '/' + compTotal;
                });
            }
        }

        // 현재 주차/요일 정보 가져오기
        var scheduleInfo = this.getCurrentScheduleInfo();

        // tr_study_records 저장
        var studyRecordData = {
            user_id: user.id,
            week: scheduleInfo.week,
            day: scheduleInfo.day,
            task_type: sectionType,
            module_number: moduleNumber,
            attempt: 1,
            score: score,
            total: total,
            time_spent: timeSpent,
            detail: detail,
            completed_at: new Date().toISOString()
        };

        console.log('💾 [AuthMonitor] 학습 기록 저장 데이터:', JSON.stringify(studyRecordData));
        var studyRecord = await saveStudyRecord(studyRecordData);
        console.log('💾 [AuthMonitor] 학습 기록 저장:', studyRecord ? '성공' : '실패');

        // 인증률 계산
        var authResult = this.calculateAuthRate();

        // tr_auth_records 저장
        if (studyRecord && studyRecord.id) {
            var authRecordData = {
                user_id: user.id,
                study_record_id: studyRecord.id,
                auth_rate: authResult.rate,
                time_flag: authResult.flags.indexOf('time_under_50') !== -1,
                no_selection_flag: authResult.flags.indexOf('no_selection') !== -1,
                no_text_flag: authResult.flags.indexOf('no_grading_text') !== -1,
                focus_lost_count: this.focusLostCount
            };

            var authRecord = await saveAuthRecord(authRecordData);
            console.log('🔒 [AuthMonitor] 인증 기록 저장:', authRecord ? '성공' : '실패');
            console.log('🔒 [AuthMonitor] 인증률:', authResult.rate + '%');
        }
    },

    // ========================================
    // 현재 스케줄 정보 가져오기
    // ========================================
    getCurrentScheduleInfo() {
        // main.js에서 selectDay() 호출 시 currentTest에 저장됨
        var ct = window.currentTest;
        if (ct && ct.currentWeek) {
            return {
                week: ct.currentWeek,
                day: ct.currentDay || '월'
            };
        }
        // fallback
        return { week: 1, day: '월' };
    }
};

// ========================================
// FlowController + WritingFlow 통합
// (기존 코드를 건드리지 않는 방식 — 함수 감싸기)
// ========================================
(function() {
    var setupDone = false;

    function setupIntegration() {
        if (setupDone) return;

        // ----- FlowController 통합 -----
        var fc = window.FlowController;
        if (!fc) return; // 아직 로드 안 됨 → 다음 시도 때 재확인

        // 1) FlowController.start 감싸기 → AuthMonitor 시작 + 기본 정보 즉시 저장
        var originalStart = fc.start.bind(fc);
        fc.start = function(sectionType, moduleNumber) {
            AuthMonitor.start(sectionType, moduleNumber);
            // ★ start 시점에 sectionType, moduleNumber를 확실히 보관
            AuthMonitor._snapshot = {
                sectionType: sectionType,
                moduleNumber: moduleNumber,
                firstAttemptResult: null
            };
            return originalStart(sectionType, moduleNumber);
        };

        // 2) FlowController.afterFirstAttempt 감싸기 → 1차 종료 시각 기록 + 결과 스냅샷
        var originalAfterFirst = fc.afterFirstAttempt.bind(fc);
        fc.afterFirstAttempt = function() {
            AuthMonitor.recordFirstAttemptEnd();
            // ★ 1차 결과를 스냅샷에 저장 (cleanup 전에 확보)
            if (AuthMonitor._snapshot && fc.firstAttemptResult) {
                AuthMonitor._snapshot.firstAttemptResult = fc.firstAttemptResult;
            }
            return originalAfterFirst();
        };

        // 3) FlowController.finish 감싸기 → 기록 저장 → 화면 정리
        var originalFinish = fc.finish.bind(fc);
        fc.finish = async function() {
            // ★ finish 시점에도 한번 더 스냅샷 시도 (아직 cleanup 전이면 잡힘)
            if (fc.sectionType) {
                AuthMonitor._snapshot = {
                    sectionType: fc.sectionType,
                    moduleNumber: fc.moduleNumber,
                    firstAttemptResult: fc.firstAttemptResult
                };
            }
            AuthMonitor.recordWorkflowComplete();
            // ★ result-screen, test-screen 등 모든 화면 숨기기
            document.querySelectorAll('.result-screen, .test-screen').forEach(function(el) {
                el.style.display = 'none';
            });
            // ★ 먼저 원래 finish 실행 (cleanup + backToSchedule)
            originalFinish();
            // ★ 그 다음 비동기로 저장 (화면 전환에 영향 없음)
            await AuthMonitor.saveRecords();
            AuthMonitor.stop();
            AuthMonitor._snapshot = null;
        };

        console.log('✅ [AuthMonitor] FlowController 통합 완료');

        // ----- WritingFlow 통합 (writing_mixed는 FlowController 대신 WritingFlow 사용) -----
        var wf = window.WritingFlow;
        if (wf && wf.runStep12) {
            var originalStep12 = wf.runStep12.bind(wf);
            wf.runStep12 = async function() {
                // WritingFlow가 별도 start를 가지므로, 여기서 감시가 시작 안 됐으면 시작
                if (!AuthMonitor.isActive) {
                    AuthMonitor.start('writing', wf.moduleNumber || 0);
                }
                AuthMonitor.recordWorkflowComplete();
                await AuthMonitor.saveRecords();
                AuthMonitor.stop();
                return originalStep12();
            };

            // WritingFlow.start도 감싸기 (AuthMonitor가 시작되도록)
            if (wf.start) {
                var originalWFStart = wf.start.bind(wf);
                wf.start = async function(moduleNumber, moduleConfig) {
                    AuthMonitor.start('writing', moduleNumber);
                    return originalWFStart(moduleNumber, moduleConfig);
                };
            }

            console.log('✅ [AuthMonitor] WritingFlow 통합 완료');
        }

        setupDone = true;
    }

    // 페이지 로드 후 연결 시도
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(setupIntegration, 500);
        });
    } else {
        setTimeout(setupIntegration, 500);
    }

    // 반복 체크 (FlowController가 늦게 로드될 경우 대비)
    var checkCount = 0;
    var checkInterval = setInterval(function() {
        if (setupDone || checkCount > 20) {
            clearInterval(checkInterval);
            if (!setupDone) {
                console.warn('⚠️ [AuthMonitor] FlowController를 찾을 수 없음 — 통합 실패');
            }
            return;
        }
        setupIntegration();
        checkCount++;
    }, 1000);
})();

console.log('✅ auth-monitor.js 로드 완료');
