# 🎓 이온토플 (IonTOEFL)

TOEFL 학원 온라인 관리 시스템

## 🌐 배포 정보

- **배포 상태**: 🟢 Live
- **배포 URL**: [추후 업데이트 예정]
- **호스팅**: Vercel
- **데이터베이스**: Supabase

## ✨ 주요 기능

### 👥 사용자 기능
- ✅ 회원가입 및 로그인
- ✅ 프로그램 신청서 작성
- ✅ 내 신청서 조회 및 관리
- ✅ 학생 대시보드
- ✅ 비밀번호 찾기/변경

### 🔧 관리자 기능
- ✅ 관리자 대시보드
- ✅ 신청서 관리 (승인, 반려, 상태 변경)
- ✅ 회원 관리 (등급 설정, 차단 기능)
- ✅ 계약서 관리 (버전 관리, 활성화/비활성화)
- ✅ 사이트 설정 (입금 계좌, 고객 지원 정보)
- ✅ 이용 가이드 편집기

## 🛠️ 기술 스택

### Frontend
- HTML5, CSS3, JavaScript (Vanilla)
- Font Awesome (아이콘)
- Pretendard (폰트)

### Backend & Database
- Supabase (PostgreSQL)
- RESTful Table API

### Deployment
- Vercel (호스팅)
- GitHub (버전 관리)

## 📂 프로젝트 구조

```
iontoefl-website/
├── index.html                  # 홈페이지
├── application-form.html       # 신청서 작성
├── application.html            # 신청 현황
├── application-detail.html     # 신청서 상세
├── my-dashboard.html           # 학생 대시보드
├── login.html                  # 로그인
├── register.html               # 회원가입
├── find-id.html                # 아이디 찾기
├── find-password.html          # 비밀번호 찾기
├── change-password.html        # 비밀번호 변경
├── admin-dashboard.html        # 관리자 대시보드
├── admin-applications.html     # 신청서 관리
├── admin-users.html            # 회원 관리
├── admin-contracts.html        # 계약서 관리
├── admin-settings.html         # 사이트 설정
├── admin-guide-editor.html     # 가이드 편집기
├── usage-guide.html            # 이용 가이드
├── css/
│   ├── style.css               # 공통 스타일
│   ├── admin.css               # 관리자 스타일
│   ├── admin-settings-tabs.css # 설정 탭 스타일
│   ├── admin-guide-editor.css  # 가이드 편집기 스타일
│   ├── application-form.css    # 신청서 스타일
│   └── page-layout.css         # 페이지 레이아웃
└── js/
    ├── main.js                 # 메인 스크립트
    ├── common.js               # 공통 함수
    ├── register.js             # 회원가입
    ├── login.js                # 로그인
    ├── application.js          # 신청 현황
    ├── application-detail.js   # 신청서 상세
    ├── application-form.js     # 신청서 작성
    ├── dashboard.js            # 학생 대시보드
    ├── admin-applications.js   # 신청서 관리
    ├── admin-users.js          # 회원 관리
    ├── admin-contracts.js      # 계약서 관리
    ├── admin-settings-tabs.js  # 설정 탭
    ├── admin-guide-editor.js   # 가이드 편집기
    ├── admin-utils.js          # 관리자 유틸
    ├── contract-utils.js       # 계약서 유틸
    └── change-password.js      # 비밀번호 변경
```

## 💾 데이터베이스 스키마

### users (회원)
- id, email, password, name, phone
- level (1: 비회원, 2: 학생, 5: 선생님, 10: 최고관리자)
- blocked, role, created_at

### applications (신청서)
- id, email, name, phone, birth_date, gender
- status, assigned_program
- current_score, target_score, target_level
- schedule_start, schedule_end
- final_price, deposit_amount, deposit_confirmed
- shipping_status, shipping_address, shipping_recipient, shipping_phone
- admin_comment, created_at, updated_at

### contracts (계약서)
- id, version, title, content
- active, created_at, updated_at

### site_settings (사이트 설정)
- id, bank_name, account_number, account_holder
- support_phone, support_email, kakao_link, business_hours
- updated_at

### guide_content (가이드 콘텐츠)
- id, sections (JSONB), updated_at, updated_by

### guide_versions (가이드 버전)
- id, content, created_at, created_by, version_name

## 🔐 보안 기능

- 비밀번호 암호화 저장
- 마스터 비밀번호 (999999) - 모든 계정 접근 가능
- 임시 비밀번호 (000000) - 비밀번호 초기화 시
- 관리자 권한 체크
- 본인 신청서만 조회 가능
- 차단된 사용자 로그인 불가

## 🚀 배포 과정

### 1. Supabase 설정
1. Supabase 프로젝트 생성
2. SQL 스크립트로 테이블 생성
3. API URL 및 anon key 복사

### 2. Vercel 배포
1. GitHub 저장소에 코드 업로드
2. Vercel에서 프로젝트 import
3. 배포 설정 및 Deploy

## 📝 개발 히스토리

- **2026-02-11**: 프로젝트 시작, 기본 구조 설계
- **2026-02-12**: 신청서 시스템 구현
- **2026-02-13**: 관리자 대시보드 구현
- **2026-02-14**: 계약서 관리 시스템 구현
- **2026-02-15**: 사이트 설정 및 가이드 편집기 구현
- **2026-02-18**: 회원 관리 시스템 구현, 준비중 페이지 처리, 배포 준비 완료

## 👤 계정 정보

### 테스트 계정
- **관리자**: 
  - 이메일: admin@iontoefl.com
  - 비밀번호: (설정 필요)
  
- **학생**: 
  - 이메일: student@test.com
  - 비밀번호: (설정 필요)

### 마스터 비밀번호
- 모든 계정: `999999` (관리자 전용)

## 📞 문의

- **카카오톡**: [카카오톡 채널 링크]
- **이메일**: info@iontoefl.com
- **전화**: 02-1234-5678

## 📄 라이선스

© 2024 이온토플. All rights reserved.

---

**Last Updated**: 2026-02-18
