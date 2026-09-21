# Firebase 동기화 · 호스팅

프로젝트 **camping-cf64d** · 웹 **https://camping-kr.web.app**

## 구성
- 공개 캠핑장: Firestore `camps` + `catalog/meta`
- 개인 데이터: Firestore `users/{uid}` (Google 로그인)
- 호스팅: Firebase Hosting 사이트 `camping-kr`

## 로컬
1. `.env.example` → `.env.local` (웹 앱 설정)
2. `npm run dev`
3. 목록 갱신: JSON 팩 수정 후 `npm run catalog:upload`

## 배포
```bash
npm run catalog:upload    # 캠핑장 → Firestore (firebase login 또는 FIREBASE_TOKEN)
npm run deploy            # 빌드 + Hosting + rules
```

## 주간 자동 갱신
GitHub Actions `Weekly camp sync` (매주 월 00:00 UTC):

1. 고캠핑 API → **신규만** `public/data/` JSON
2. **같은 잡에서** `npm run catalog:upload` → Firestore 반영
3. JSON 변경 PR 생성 (시드 백업)

최초 1회 전체 적재: Actions → Run workflow → mode=`full`  
(고캠핑 전체 업서트 · 수정 반영 · API 제외분은 폐업 처리 · Firestore 삭제)

필요한 Secrets:

- `GOCAMPING_KEY`
- `FIREBASE_SERVICE_ACCOUNT` (서비스 계정 JSON, 권장) 또는 `FIREBASE_TOKEN` (`firebase login:ci`)

## Authentication
- Sign-in method → Google 사용
- Authorized domains에 `camping-kr.web.app` 포함 필수
  (없으면 로그인 직후 튕김)

## GitHub Secrets (선택 · Pages/CI용)
`VITE_FIREBASE_*` 6개를 `camping-cf64d` 웹 앱 값으로 맞춥니다.
