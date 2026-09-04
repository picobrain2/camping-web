# 어디캠 데이터 구조

## 공개 캠핑장 목록 → JSON (유지)
- `public/data/index.json` + `public/data/packs/*.json`
- GitHub Pages 정적 배포, 고캠핑 동기화 스크립트/PR 흐름 그대로
- Firebase 없이도 검색·상세·지도 링크가 동작

## 개인 데이터 → Firestore (동기화)
- 즐겨찾기 / 숨김 / 내 리뷰
- Google 로그인 사용자 문서: `users/{uid}`
- 이 기기 로컬 프로필은 보조(같은 브라우저에서 이름 분리용)

캠핑장 마스터를 Firestore로 옮기는 작업은 하지 않는다.
관리·배포 없이 자주 고쳐야 할 때 다시 검토한다.
