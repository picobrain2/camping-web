# 어디캠 데이터 구조

## 공개 캠핑장 목록 → Firestore
- 프로젝트: `camping-cf64d`
- 컬렉션: `camps/{campId}` (문서 1곳 = 캠핑장 1곳)
- 메타: `catalog/meta` (`updatedAt`, `count`, `note`)
- 시드 JSON(`public/data/`)은 `npm run catalog:upload` 업로드용으로 유지
- 웹: https://camping-kr.web.app

## 개인 데이터 → Firestore (동기화)
- 즐겨찾기 / 숨김 / 내 리뷰 / 방문 다이어리
- Google 로그인 사용자 문서: `users/{uid}`
- 이 기기 로컬 프로필은 보조(같은 브라우저에서 이름 분리용)

Firestore가 비어 있거나 설정이 없으면 앱이 JSON 팩으로 잠깐 대체 로드합니다.
