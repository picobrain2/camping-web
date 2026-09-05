## 다른 기기 동기화 (Firebase)

캠핑장 목록(JSON)은 그대로 두고, **즐겨찾기·숨김·리뷰·방문 다이어리**만 Firestore에 맞춥니다.

### 1. Firebase 프로젝트 만들기
1. https://console.firebase.google.com/ 에서 프로젝트 생성
2. **Authentication** → Sign-in method → **Google** 사용 설정
3. **Firestore Database** 만들기 (프로덕션 모드로 시작해도 됨)
4. 저장소 규칙을 `firestore.rules` 내용으로 교체 후 게시
5. 프로젝트 설정 → 웹 앱 추가 → 설정 값 복사

### 2. 로컬 개발
`.env.example`을 복사해 `.env.local`을 만들고 값을 채운 뒤 `npm run dev`

### 3. GitHub Pages 배포
저장소 Settings → Secrets and variables → Actions 에 아래를 추가:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Secrets를 넣은 뒤 Actions에서 **GitHub Pages** 워크플로를 다시 실행하세요.

### 4. 승인된 도메인
Firebase Authentication → Settings → Authorized domains 에 GitHub Pages 도메인을 추가
(예: `picobrain2.github.io`)

### 5. 앱에서 사용
`내 목록` → `계정` → **Google로 동기화**
