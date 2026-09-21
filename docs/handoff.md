# 어디캠 (camping-web) — 핸드오프

> 작성 기준: 2026-09-21

## 한 줄 요약
**어디캠** = 캠핑장 검색 PWA.  
공개 목록 = **Firestore `camps`**, 개인 = **Firestore `users/{uid}` + Google**.  
라이브: **https://camping-kr.web.app** (프로젝트 `camping-cf64d`)

| | |
|---|---|
| 경로 | `/Users/picobrain/code/Game/camping-web` |
| 원격 | https://github.com/picobrain2/camping-web |
| 라이브 | https://camping-kr.web.app |
| 스택 | vanilla TS + Vite · Firebase Hosting + Firestore |

## 배포
```bash
npm run catalog:upload   # JSON 시드 → Firestore
npm run deploy           # hosting(camping-kr) + rules
```

## 자주 건드리는 파일
- `src/app.ts` / `src/lib/cloud.ts` / `src/lib/catalog.ts`
- `scripts/upload-catalog-firestore.mjs`
- `public/data/` (업로드 시드)
- `firebase.json` · `firestore.rules`
