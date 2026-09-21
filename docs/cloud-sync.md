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
npm run deploy:rules      # Firestore 규칙
npm run catalog:upload    # 캠핑장 → Firestore
npm run deploy            # 빌드 + Hosting + rules
```

## Authentication
- Sign-in method → Google 사용
- Authorized domains에 `camping-kr.web.app` 포함 확인

## GitHub Secrets (선택 · Pages/CI용)
`VITE_FIREBASE_*` 6개를 `camping-cf64d` 웹 앱 값으로 맞춥니다.
