// Display search results - 전체 정보 표시
function displayResults(applications) {
    const container = document.getElementById('resultsContainer');
    const resultsList = document.getElementById('resultsList');
    
    // Sort by created_at descending
    applications.sort((a, b) => b.created_at - a.created_at);
    
    resultsList.innerHTML = applications.map(app => {
        const statusClass = app.status === '승인' ? 'status-approved' : 
                          app.status === '거부' ? 'status-rejected' : 'status-pending';
        const statusIcon = app.status === '승인' ? 'check-circle' : 
                          app.status === '거부' ? 'times-circle' : 'clock';
        
        return `
            <div class="program-card" style="margin-bottom: 30px; padding: 24px;">
                <!-- 상단: 프로그램 & 상태 -->
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 2px solid #e5e7eb;">
                    <div>
                        <h3 class="program-title" style="font-size: 18px; margin-bottom: 8px; color: #1e293b;">
                            ${escapeHtml(app.assigned_program || app.preferred_program || '프로그램 미정')}
                        </h3>
                        <p style="font-size: 13px; color: #64748b;">
                            신청일: ${formatDate(app.created_at)}
                        </p>
                    </div>
                    <span class="status-badge ${statusClass}">
                        <i class="fas fa-${statusIcon}"></i> ${escapeHtml(app.status)}
                    </span>
                </div>
                
                <!-- 기본 정보 -->
                <div style="margin-bottom: 20px;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #475569; margin-bottom: 12px;">
                        <i class="fas fa-user"></i> 기본 정보
                    </h4>
                    <div style="background: #f8fafc; padding: 16px; border-radius: 8px;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">이름</div>
                                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.name)}</div>
                            </div>
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">이메일</div>
                                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.email)}</div>
                            </div>
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">전화번호</div>
                                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.phone)}</div>
                            </div>
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">주소</div>
                                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.address)}</div>
                            </div>
                            ${app.occupation ? `
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">직업</div>
                                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.occupation)}</div>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
                
                <!-- 환불 계좌 정보 -->
                ${app.bank_name || app.account_number ? `
                <div style="margin-bottom: 20px;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #475569; margin-bottom: 12px;">
                        <i class="fas fa-university"></i> 환불 계좌 정보
                    </h4>
                    <div style="background: #f8fafc; padding: 16px; border-radius: 8px;">
                        <div style="font-size: 13px; color: #1e293b;">
                            ${escapeHtml(app.bank_name || '')} ${escapeHtml(app.account_number || '')} ${escapeHtml(app.account_holder || '')}
                        </div>
                    </div>
                </div>
                ` : ''}
                
                <!-- 현재 토플 점수 -->
                <div style="margin-bottom: 20px;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #475569; margin-bottom: 12px;">
                        <i class="fas fa-chart-line"></i> 현재 토플 점수
                    </h4>
                    <div style="background: #f8fafc; padding: 16px; border-radius: 8px;">
                        ${app.has_toefl_score === 'yes' ? `
                            <div style="margin-bottom: 8px;">
                                <span style="font-size: 13px; color: #64748b;">버전: </span>
                                <span style="font-weight: 600; color: #1e293b;">${app.score_version === 'old' ? '개정전 (0-120점)' : '개정후 (1-6 레벨)'}</span>
                            </div>
                            <div style="margin-bottom: 8px;">
                                <span style="font-size: 13px; color: #64748b;">총점: </span>
                                <span style="font-weight: 700; font-size: 18px; color: #9480c5;">${app.total_score || '-'}</span>
                            </div>
                            ${app.score_version === 'old' ? `
                                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px;">
                                    <div><span style="color: #64748b; font-size: 12px;">Reading:</span> <strong>${app.score_reading_old || '-'}</strong></div>
                                    <div><span style="color: #64748b; font-size: 12px;">Listening:</span> <strong>${app.score_listening_old || '-'}</strong></div>
                                    <div><span style="color: #64748b; font-size: 12px;">Speaking:</span> <strong>${app.score_speaking_old || '-'}</strong></div>
                                    <div><span style="color: #64748b; font-size: 12px;">Writing:</span> <strong>${app.score_writing_old || '-'}</strong></div>
                                </div>
                            ` : `
                                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px;">
                                    <div><span style="color: #64748b; font-size: 12px;">Reading:</span> <strong>${app.score_reading_new || '-'}</strong></div>
                                    <div><span style="color: #64748b; font-size: 12px;">Listening:</span> <strong>${app.score_listening_new || '-'}</strong></div>
                                    <div><span style="color: #64748b; font-size: 12px;">Writing:</span> <strong>${app.score_writing_new || '-'}</strong></div>
                                    <div><span style="color: #64748b; font-size: 12px;">Speaking:</span> <strong>${app.score_speaking_new || '-'}</strong></div>
                                </div>
                            `}
                            ${app.score_history ? `
                                <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
                                    <div style="color: #64748b; font-size: 12px; margin-bottom: 4px;">추가 설명</div>
                                    <div style="font-size: 13px; color: #1e293b;">${escapeHtml(app.score_history)}</div>
                                </div>
                            ` : ''}
                        ` : `
                            <div style="color: #64748b; font-size: 13px;">점수 없음 (영작 샘플 제출)</div>
                            ${app.writing_sample_1 ? `
                                <div style="margin-top: 12px; padding: 12px; background: white; border-radius: 6px; border: 1px solid #e5e7eb;">
                                    <div style="font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 6px;">Writing Sample 1</div>
                                    <div style="font-size: 13px; color: #1e293b; white-space: pre-wrap;">${escapeHtml(app.writing_sample_1)}</div>
                                </div>
                            ` : ''}
                            ${app.writing_sample_2 ? `
                                <div style="margin-top: 8px; padding: 12px; background: white; border-radius: 6px; border: 1px solid #e5e7eb;">
                                    <div style="font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 6px;">Writing Sample 2</div>
                                    <div style="font-size: 13px; color: #1e293b; white-space: pre-wrap;">${escapeHtml(app.writing_sample_2)}</div>
                                </div>
                            ` : ''}
                        `}
                    </div>
                </div>
                
                <!-- 학습 현황 -->
                ${app.current_study_method || app.daily_study_time ? `
                <div style="margin-bottom: 20px;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #475569; margin-bottom: 12px;">
                        <i class="fas fa-book-reader"></i> 학습 현황
                    </h4>
                    <div style="background: #f8fafc; padding: 16px; border-radius: 8px;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                            ${app.current_study_method ? `
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">현재 공부 방법</div>
                                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.current_study_method)}</div>
                            </div>
                            ` : ''}
                            ${app.daily_study_time ? `
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">하루 평균 공부 시간</div>
                                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.daily_study_time)}</div>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
                ` : ''}
                
                <!-- 목표 점수 -->
                <div style="margin-bottom: 20px;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #475569; margin-bottom: 12px;">
                        <i class="fas fa-bullseye"></i> 목표 점수
                    </h4>
                    <div style="background: #f8fafc; padding: 16px; border-radius: 8px;">
                        <div style="margin-bottom: 8px;">
                            <span style="font-size: 13px; color: #64748b;">버전: </span>
                            <span style="font-weight: 600; color: #1e293b;">${app.target_version === 'old' ? '개정전 (0-120점)' : '개정후 (1-6 레벨)'}</span>
                        </div>
                        <div style="margin-bottom: 8px;">
                            <span style="font-size: 13px; color: #64748b;">목표 커트라인: </span>
                            <span style="font-weight: 700; font-size: 18px; color: #77bf7e;">${app.target_cutoff_old || app.target_cutoff_new || '-'}</span>
                        </div>
                        ${app.target_version === 'old' ? `
                            ${(app.target_reading_old || app.target_listening_old || app.target_speaking_old || app.target_writing_old) ? `
                                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px;">
                                    ${app.target_reading_old ? `<div><span style="color: #64748b; font-size: 12px;">Reading:</span> <strong>${app.target_reading_old}</strong></div>` : ''}
                                    ${app.target_listening_old ? `<div><span style="color: #64748b; font-size: 12px;">Listening:</span> <strong>${app.target_listening_old}</strong></div>` : ''}
                                    ${app.target_speaking_old ? `<div><span style="color: #64748b; font-size: 12px;">Speaking:</span> <strong>${app.target_speaking_old}</strong></div>` : ''}
                                    ${app.target_writing_old ? `<div><span style="color: #64748b; font-size: 12px;">Writing:</span> <strong>${app.target_writing_old}</strong></div>` : ''}
                                </div>
                            ` : ''}
                        ` : `
                            ${(app.target_reading_new || app.target_listening_new || app.target_speaking_new || app.target_writing_new) ? `
                                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px;">
                                    ${app.target_reading_new ? `<div><span style="color: #64748b; font-size: 12px;">Reading:</span> <strong>${app.target_reading_new}</strong></div>` : ''}
                                    ${app.target_listening_new ? `<div><span style="color: #64748b; font-size: 12px;">Listening:</span> <strong>${app.target_listening_new}</strong></div>` : ''}
                                    ${app.target_writing_new ? `<div><span style="color: #64748b; font-size: 12px;">Writing:</span> <strong>${app.target_writing_new}</strong></div>` : ''}
                                    ${app.target_speaking_new ? `<div><span style="color: #64748b; font-size: 12px;">Speaking:</span> <strong>${app.target_speaking_new}</strong></div>` : ''}
                                </div>
                            ` : ''}
                        `}
                        ${app.target_notes ? `
                            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
                                <div style="color: #64748b; font-size: 12px; margin-bottom: 4px;">목표 점수 관련 노트</div>
                                <div style="font-size: 13px; color: #1e293b;">${escapeHtml(app.target_notes)}</div>
                            </div>
                        ` : ''}
                    </div>
                </div>
                
                <!-- 마감 기한 -->
                ${app.submission_deadline || app.preferred_completion ? `
                <div style="margin-bottom: 20px;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #475569; margin-bottom: 12px;">
                        <i class="fas fa-calendar-alt"></i> 마감 기한
                    </h4>
                    <div style="background: #f8fafc; padding: 16px; border-radius: 8px;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                            ${app.submission_deadline ? `
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">마지막 응시 가능 시험일</div>
                                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.submission_deadline)}</div>
                            </div>
                            ` : ''}
                            ${app.preferred_completion ? `
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">희망 목표 달성 시점</div>
                                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.preferred_completion)}</div>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
                ` : ''}
                
                <!-- 토플 필요 이유 -->
                ${app.toefl_reason || app.toefl_reason_detail ? `
                <div style="margin-bottom: 20px;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #475569; margin-bottom: 12px;">
                        <i class="fas fa-question-circle"></i> 토플 점수가 필요한 이유
                    </h4>
                    <div style="background: #f8fafc; padding: 16px; border-radius: 8px;">
                        ${app.toefl_reason ? `
                            <div style="margin-bottom: 8px;">
                                <span style="color: #64748b; font-size: 13px;">목적: </span>
                                <span style="font-weight: 600; color: #1e293b;">${escapeHtml(app.toefl_reason)}</span>
                            </div>
                        ` : ''}
                        ${app.toefl_reason_detail ? `
                            <div style="font-size: 13px; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">
                                ${escapeHtml(app.toefl_reason_detail)}
                            </div>
                        ` : ''}
                    </div>
                </div>
                ` : ''}
                
                <!-- 기억에 남는 블로그 글 -->
                ${app.memorable_blog_content ? `
                <div style="margin-bottom: 20px;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #475569; margin-bottom: 12px;">
                        <i class="fas fa-blog"></i> 기억에 남는 블로그 글
                    </h4>
                    <div style="background: #f8fafc; padding: 16px; border-radius: 8px;">
                        <div style="font-size: 13px; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">
                            ${escapeHtml(app.memorable_blog_content)}
                        </div>
                    </div>
                </div>
                ` : ''}
                
                <!-- 프로그램 및 일정 -->
                <div style="margin-bottom: 20px;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #475569; margin-bottom: 12px;">
                        <i class="fas fa-graduation-cap"></i> 프로그램 및 일정
                    </h4>
                    <div style="background: #f8fafc; padding: 16px; border-radius: 8px;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">희망 프로그램</div>
                                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.preferred_program || '-')}</div>
                            </div>
                            ${app.assigned_program ? `
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">배정 프로그램</div>
                                <div style="font-weight: 600; color: #9480c5;">${escapeHtml(app.assigned_program)}</div>
                            </div>
                            ` : ''}
                            ${app.preferred_start_date ? `
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">희망 수업 시작일</div>
                                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.preferred_start_date)}</div>
                            </div>
                            ` : ''}
                        </div>
                        ${app.program_note ? `
                            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
                                <div style="color: #64748b; font-size: 12px; margin-bottom: 4px;">프로그램 관련 추가 의견</div>
                                <div style="font-size: 13px; color: #1e293b;">${escapeHtml(app.program_note)}</div>
                            </div>
                        ` : ''}
                    </div>
                </div>
                
                <!-- 유입 경로 -->
                ${(app.referral_search_keyword || app.referral_social_media || app.referral_friend === 'yes' || app.referral_other) ? `
                <div style="margin-bottom: 20px;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #475569; margin-bottom: 12px;">
                        <i class="fas fa-share-alt"></i> 이온토플을 알게 된 경로
                    </h4>
                    <div style="background: #f8fafc; padding: 16px; border-radius: 8px;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                            ${app.referral_search_keyword ? `
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">검색 키워드</div>
                                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.referral_search_keyword)}</div>
                            </div>
                            ` : ''}
                            ${app.referral_social_media ? `
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">SNS</div>
                                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.referral_social_media)}</div>
                            </div>
                            ` : ''}
                            ${app.referral_friend === 'yes' ? `
                            <div>
                                <div style="color: #64748b; margin-bottom: 4px;">지인 추천</div>
                                <div style="font-weight: 600; color: #1e293b;">예${app.referral_friend_name ? ` (${escapeHtml(app.referral_friend_name)})` : ''}</div>
                            </div>
                            ` : ''}
                        </div>
                        ${app.referral_other ? `
                            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
                                <div style="color: #64748b; font-size: 12px; margin-bottom: 4px;">기타 경로</div>
                                <div style="font-size: 13px; color: #1e293b;">${escapeHtml(app.referral_other)}</div>
                            </div>
                        ` : ''}
                    </div>
                </div>
                ` : ''}
                
                <!-- 추가 전달 사항 -->
                ${app.additional_notes ? `
                <div style="margin-bottom: 20px;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #475569; margin-bottom: 12px;">
                        <i class="fas fa-sticky-note"></i> 추가 전달 사항
                    </h4>
                    <div style="background: #f8fafc; padding: 16px; border-radius: 8px;">
                        <div style="font-size: 13px; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">
                            ${escapeHtml(app.additional_notes)}
                        </div>
                    </div>
                </div>
                ` : ''}
                
                <!-- 관리자 메시지 -->
                ${app.admin_comment ? `
                    <div style="background: #e8e0f5; border-left: 4px solid #9480c5; padding: 16px; border-radius: 6px; margin-bottom: 16px;">
                        <div style="font-size: 13px; font-weight: 700; color: #5e4a8b; margin-bottom: 8px;">
                            <i class="fas fa-comment-dots"></i> 관리자 메시지
                        </div>
                        <div style="font-size: 14px; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">
                            ${escapeHtml(app.admin_comment)}
                        </div>
                    </div>
                ` : ''}
                
                <!-- 상태별 안내 메시지 -->
                ${app.status === '대기중' || app.status === '접수완료' ? `
                    <div style="padding: 14px; background: #fef3c7; border-radius: 6px; font-size: 13px; color: #92400e;">
                        <i class="fas fa-hourglass-half"></i> 신청서를 검토 중입니다. 곧 연락드리겠습니다.
                    </div>
                ` : ''}
                
                ${app.status === '승인' ? `
                    <div style="padding: 14px; background: #e8f5e9; border-radius: 6px; font-size: 13px; color: #2e7d32;">
                        <i class="fas fa-check-circle"></i> 신청이 승인되었습니다! 등록된 연락처로 안내해드리겠습니다.
                    </div>
                ` : ''}
                
                ${app.status === '거부' ? `
                    <div style="padding: 14px; background: #fee2e2; border-radius: 6px; font-size: 13px; color: #991b1b;">
                        <i class="fas fa-times-circle"></i> 죄송합니다. 현재 해당 프로그램의 정원이 마감되었습니다.
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    container.style.display = 'block';
}
