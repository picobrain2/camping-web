import { loadFileCatalog, mergeCatalog, normalizeCamp, overlayToJson, parseCampList } from "./lib/catalog";
import { wonRange, esc, kindLabels, mapLink, scoreText, slugify, todayISO, coverPhoto, displayPhotos } from "./lib/format";
import { geocodePlace, type PlaceHit } from "./lib/geocode";
import { driveLabel, drivingTable, estimateDrives, haversineKm, naverCarDirections, type DriveETA, type GeoPos } from "./lib/geo";
import { officialLayoutImage, placeLinks } from "./lib/places";
import {
  bootCloudAuth,
  getCloudUser,
  isCloudConfigured,
  mergeBundles,
  pullCloudBundle,
  pushCloudBundle,
  signInWithGoogle,
  signOutCloud,
  type CloudUser,
} from "./lib/cloud";
import { displayScore, favoriteCamps, featuredCamps, filterCamps, priceRange, relevance, reviewedCamps, visitedCampIds } from "./lib/search";
import {
  bindCloudSync,
  createAccount,
  currentAccount,
  deleteAccount,
  flushCloudPush,
  listAccounts,
  loadDiary,
  loadFavorites,
  loadHidden,
  loadOverlay,
  loadRecent,
  loadReviews,
  loginAccount,
  logoutAccount,
  peekPersonalBundle,
  reloadPersonalData,
  rememberQuery,
  replacePersonalBundle,
  saveDiary,
  saveFavorites,
  saveHidden,
  saveOverlay,
  saveReviews,
  isGateDismissed,
  setGateDismissed,
} from "./lib/storage";
import {
  Camp,
  CampKind,
  KIND_LABEL,
  LocalAccount,
  OverlayDraft,
  PersonalReview,
  REGION_OPTIONS,
  LOCATION_TAGS,
  FACILITY_TAGS,
  SavedCampRef,
  VisitDiaryEntry,
} from "./types";

let camps: Camp[] = [];
let reviews: Record<string, PersonalReview> = loadReviews();
let diary: VisitDiaryEntry[] = loadDiary();
let overlay: OverlayDraft[] = loadOverlay();
let recent: string[] = loadRecent();
let favorites: SavedCampRef[] = loadFavorites();
let hidden: SavedCampRef[] = loadHidden();
let account: LocalAccount | null = currentAccount();
let cloudUser: CloudUser | null = null;
let cloudBusy = false;
let cloudNote: string | null = null;
let cloudAuthReady = !isCloudConfigured();
let showLoginGate = false;
let accountError: string | null = null;
let accountMode: "home" | "create" | "login" = "home";
let loginTargetId: string | null = null;
let catalogNote = "";
let catalogUpdated = "";
let loadError: string | null = null;

let query = "";
let regions: string[] = [];
let kind = "all";
let tags: string[] = [];
let sort: "recommend" | "rating" | "distance" = "recommend";
let selectedId: string | null = null;
let panel: "none" | "add" | "data" | "lists" = "none";
let listsTab: "favorites" | "visited" | "hidden" | "diary" | "account" = "favorites";
let editingDiaryId: string | null = null;
let diaryMonth = todayISO().slice(0, 7);
let diaryDay: string | null = null;
let diaryCampQuery = "";
let diaryCampHits: Camp[] = [];
let diaryDraftCampId: string | null = null;
let diaryCampTimer = 0;
let filtersOpen = false;
let originOpen = false;
let searchTimer = 0;
let imeComposing = false;
let layoutPopup: { title: string; url: string; image?: string } | null = null;
let myPos: GeoPos | null = null;
let originQuery = "";
let originHits: PlaceHit[] = [];
let originLoading = false;
let locError: string | null = null;
let locLoading = false;
let driveById: Record<string, DriveETA> = {};
let driveSeq = 0;

let root: HTMLElement;

export async function boot(): Promise<void> {
  root = document.getElementById("app")!;
  root.innerHTML = `<div class="boot">캠핑장 파일 DB를 불러오는 중…</div>`;
  bindCloudSync({
    isReady: () => isCloudConfigured() && Boolean(getCloudUser()),
    getUid: () => getCloudUser()?.uid ?? null,
    push: async (uid, bundle) => {
      const user = getCloudUser();
      await pushCloudBundle(uid, bundle, { email: user?.email, name: user?.name });
    },
  });
  try {
    const file = await loadFileCatalog();
    catalogNote = file.note ?? "";
    catalogUpdated = file.updatedAt;
    camps = mergeCatalog(file.camps, overlay);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "불러오기 실패";
  }
  applyRoute();
  window.addEventListener("hashchange", () => {
    applyRoute();
    render();
  });
  render();
  registerServiceWorker();
  void restoreCloudSession();
}

async function restoreCloudSession(): Promise<void> {
  if (!isCloudConfigured()) {
    cloudAuthReady = true;
    showLoginGate = false;
    render();
    return;
  }
  try {
    cloudUser = await bootCloudAuth();
    if (cloudUser) {
      await syncFromCloud(false);
      showLoginGate = false;
    } else {
      showLoginGate = !isGateDismissed();
    }
  } catch (error) {
    cloudNote = error instanceof Error ? error.message : "클라우드 동기화에 실패했습니다.";
    showLoginGate = !isGateDismissed();
  } finally {
    cloudAuthReady = true;
    render();
  }
}

async function syncFromCloud(announce: boolean): Promise<void> {
  const user = getCloudUser() ?? cloudUser;
  if (!user) return;
  cloudBusy = true;
  if (announce) render();
  try {
    const remote = await pullCloudBundle(user.uid);
    const local = peekPersonalBundle();
    const merged = remote ? mergeBundles(local, remote) : local;
    replacePersonalBundle(merged);
    await pushCloudBundle(user.uid, merged, { email: user.email, name: user.name });
    applyPersonalData();
    cloudUser = user;
    cloudNote = announce ? "다른 기기와 목록을 맞췄습니다." : cloudNote;
  } finally {
    cloudBusy = false;
    render();
  }
}

async function connectGoogleSync(fromGate = false): Promise<void> {
  if (!isCloudConfigured()) {
    accountError = "아직 클라우드 설정이 없습니다. 관리자에게 Firebase 연결을 요청해 주세요.";
    render();
    return;
  }
  cloudBusy = true;
  accountError = null;
  cloudNote = null;
  render();
  try {
    cloudUser = await signInWithGoogle();
    await syncFromCloud(true);
    showLoginGate = false;
    setGateDismissed(true);
    if (fromGate) go("");
    else {
      listsTab = "favorites";
      go("lists");
    }
  } catch (error) {
    cloudBusy = false;
    const message = error instanceof Error ? error.message : "구글 로그인에 실패했습니다.";
    if (message.includes("이동합니다")) {
      cloudNote = message;
    } else {
      accountError = message;
    }
    render();
  }
}

async function disconnectGoogleSync(): Promise<void> {
  cloudBusy = true;
  render();
  try {
    await flushCloudPush();
    await signOutCloud();
    cloudUser = null;
    cloudNote = "구글 동기화를 껐습니다. 이 기기 목록은 그대로 남아 있습니다.";
    showLoginGate = true;
    setGateDismissed(false);
  } catch (error) {
    accountError = error instanceof Error ? error.message : "로그아웃에 실패했습니다.";
  } finally {
    cloudBusy = false;
    render();
  }
}

function applyRoute(): void {
  const hash = location.hash.replace(/^#\/?/, "");
  if (hash === "add") {
    panel = "add";
    selectedId = null;
    return;
  }
  if (hash === "data") {
    panel = "data";
    selectedId = null;
    return;
  }
  if (hash === "lists" || hash === "favorites" || hash === "visited" || hash === "hidden" || hash === "diary" || hash === "account") {
    panel = "lists";
    listsTab =
      hash === "visited"
        ? "visited"
        : hash === "hidden"
          ? "hidden"
          : hash === "diary"
            ? "diary"
            : hash === "account"
              ? "account"
              : "favorites";
    selectedId = null;
    return;
  }
  if (hash.startsWith("camp/")) {
    panel = "none";
    selectedId = decodeURIComponent(hash.slice(5)) || null;
    return;
  }
  panel = "none";
  selectedId = null;
}

function go(path: string): void {
  const next = path ? `#/${path}` : "#/";
  if (location.hash === next) {
    applyRoute();
    render();
    return;
  }
  location.hash = next;
}

function listsTabFromDataset(tab: string | undefined): typeof listsTab {
  if (tab === "visited") return "visited";
  if (tab === "hidden") return "hidden";
  if (tab === "diary") return "diary";
  if (tab === "account") return "account";
  return "favorites";
}

function listsHash(tab: typeof listsTab): string {
  if (tab === "visited") return "visited";
  if (tab === "hidden") return "hidden";
  if (tab === "diary") return "diary";
  if (tab === "account") return "account";
  return "lists";
}

function selected(): Camp | undefined {
  return camps.find((c) => c.id === selectedId);
}

function favoriteIdSet(): Set<string> {
  return new Set(favorites.map((item) => item.id));
}

function diaryVisitedSet(): Set<string> {
  return visitedCampIds(diary);
}

type VisitedCampSummary = {
  campId: string;
  campName: string;
  region: string;
  city: string;
  visitCount: number;
  lastVisitedAt: string;
  lastRating?: number;
};

/** 다이어리 기준으로 캠핑장별 다녀온 곳 요약 */
function visitedCampSummaries(): VisitedCampSummary[] {
  const map = new Map<string, VisitedCampSummary>();
  for (const entry of diary) {
    const prev = map.get(entry.campId);
    if (!prev) {
      map.set(entry.campId, {
        campId: entry.campId,
        campName: entry.campName,
        region: entry.region,
        city: entry.city,
        visitCount: 1,
        lastVisitedAt: entry.visitedAt,
        lastRating: entry.rating,
      });
      continue;
    }
    prev.visitCount += 1;
    if ((entry.visitedAt || "") > (prev.lastVisitedAt || "")) {
      prev.lastVisitedAt = entry.visitedAt;
      prev.lastRating = entry.rating;
      prev.campName = entry.campName || prev.campName;
      prev.region = entry.region || prev.region;
      prev.city = entry.city || prev.city;
    }
  }
  return [...map.values()].sort((a, b) => (b.lastVisitedAt || "").localeCompare(a.lastVisitedAt || ""));
}

function hiddenIdSet(): Set<string> {
  return new Set(hidden.map((item) => item.id));
}

function isFavorite(id: string): boolean {
  return favorites.some((item) => item.id === id);
}

function isHidden(id: string): boolean {
  return hidden.some((item) => item.id === id);
}

function toSavedRef(camp: Camp): SavedCampRef {
  return {
    id: camp.id,
    name: camp.name,
    region: camp.region,
    city: camp.city,
    savedAt: todayISO(),
  };
}

function toggleFavorite(id: string): void {
  if (isFavorite(id)) {
    favorites = favorites.filter((item) => item.id !== id);
    saveFavorites(favorites);
    return;
  }
  const camp = camps.find((c) => c.id === id);
  const existing = favorites.find((item) => item.id === id);
  const ref =
    camp
      ? toSavedRef(camp)
      : existing ?? { id, name: id, region: "", city: "", savedAt: todayISO() };
  // 숨긴 상태에서 즐겨찾기하면 다시 보이게
  if (isHidden(id)) {
    hidden = hidden.filter((item) => item.id !== id);
    saveHidden(hidden);
  }
  favorites = [ref, ...favorites.filter((item) => item.id !== id)];
  saveFavorites(favorites);
}

function hideCamp(id: string): void {
  const camp = camps.find((c) => c.id === id);
  const existing = hidden.find((item) => item.id === id);
  const ref =
    camp
      ? toSavedRef(camp)
      : existing ?? { id, name: id, region: "", city: "", savedAt: todayISO() };
  favorites = favorites.filter((item) => item.id !== id);
  saveFavorites(favorites);
  hidden = [ref, ...hidden.filter((item) => item.id !== id)];
  saveHidden(hidden);
}

/** 숨긴 캠핑장을 뺀 목록 (검색·홈·거리 계산용) */
function browsable(): Camp[] {
  const blocked = hiddenIdSet();
  return camps.filter((camp) => !blocked.has(camp.id));
}

function visible(): Camp[] {
  return filterCamps(browsable(), query, regions, kind, tags, reviews, sort, driveById, favoriteIdSet(), diaryVisitedSet());
}

let skipDriveSchedule = false;
function render(): void {
  // 한글 IME 조합 중에 DOM을 갈아끼우면 자모가 분리된다
  if (imeComposing) return;
  const activeId = (document.activeElement as HTMLElement | null)?.id;
  if (activeId === "search-input" || activeId === "origin-input") {
    refreshSearchList();
    return;
  }
  const keep = preserveCaret("search-input") ?? preserveCaret("origin-input");
  if (isCloudConfigured() && !cloudAuthReady) {
    root.innerHTML = `<div class="boot">로그인 상태를 확인하는 중…</div>`;
    bindOnce();
    return;
  }
  if (showLoginGate && !cloudUser) {
    root.innerHTML = renderLoginGate();
    bindOnce();
    return;
  }
  root.innerHTML = `
    <div class="shell ${selectedId || panel !== "none" ? "has-detail" : ""}">
      ${renderSearchPane()}
      ${renderDetailPane()}
    </div>
    ${layoutPopup ? renderLayoutModal() : ""}`;
  bindOnce();
  restoreCaret(keep);
  if (!skipDriveSchedule) scheduleDriveRefresh();
}

/** 검색창은 유지한 채 결과 목록만 갱신 (한글 입력 깨짐 방지) */
function refreshSearchList(): void {
  const wrap = root.querySelector(".list-wrap");
  if (!wrap) {
    // 검색창이 없는 화면이면 전체 렌더로 복귀
    const keep = preserveCaret("search-input") ?? preserveCaret("origin-input");
    if (isCloudConfigured() && !cloudAuthReady) {
      root.innerHTML = `<div class="boot">로그인 상태를 확인하는 중…</div>`;
      bindOnce();
      return;
    }
    if (showLoginGate && !cloudUser) {
      root.innerHTML = renderLoginGate();
      bindOnce();
      return;
    }
    root.innerHTML = `
      <div class="shell ${selectedId || panel !== "none" ? "has-detail" : ""}">
        ${renderSearchPane()}
        ${renderDetailPane()}
      </div>
      ${layoutPopup ? renderLayoutModal() : ""}`;
    bindOnce();
    restoreCaret(keep);
    return;
  }
  wrap.innerHTML = renderList();
}

function renderLoginGate(): string {
  return `
    <div class="login-gate">
      <div class="login-gate-bg" aria-hidden="true"></div>
      <div class="login-gate-card">
        <p class="login-kicker">캠핑장 조회</p>
        <h1>어디캠</h1>
        <p class="login-lead">즐겨찾기·다이어리·리뷰를 구글 계정에 두고<br />폰과 PC에서 같이 쓰세요.</p>
        ${accountError ? `<p class="loc-msg">${esc(accountError)}</p>` : ""}
        ${cloudNote ? `<p class="loc-msg">${esc(cloudNote)}</p>` : ""}
        <button type="button" class="btn login-google" data-action="gate-google" ${cloudBusy ? "disabled" : ""}>
          ${cloudBusy ? "로그인 중…" : "Google로 시작하기"}
        </button>
        <button type="button" class="btn ghost login-skip" data-action="gate-skip" ${cloudBusy ? "disabled" : ""}>로그인 없이 둘러보기</button>
        <p class="login-foot muted">캠핑장 목록은 언제든 볼 수 있고, 로그인은 내 목록 동기화에만 필요합니다.</p>
      </div>
    </div>`;
}

let driveTimer = 0;
function scheduleDriveRefresh(): void {
  window.clearTimeout(driveTimer);
  if (!myPos) {
    if (Object.keys(driveById).length) {
      driveById = {};
      skipDriveSchedule = true;
      render();
      skipDriveSchedule = false;
    }
    return;
  }
  driveTimer = window.setTimeout(() => void refreshDriveTimes(), 220);
}

function campsWithCoords(): Camp[] {
  return filterCamps(browsable(), query, regions, kind, tags, reviews, "recommend", {}, favoriteIdSet(), diaryVisitedSet()).filter(
    (camp) => camp.lat != null && camp.lng != null
  );
}

function campsForDrive(): Camp[] {
  if (!myPos) return [];
  const ranked = [...campsWithCoords()].sort(
    (a, b) =>
      haversineKm(myPos!, { lat: a.lat!, lng: a.lng! }) - haversineKm(myPos!, { lat: b.lat!, lng: b.lng! })
  );
  const batch = ranked.slice(0, 40);
  const camp = selected();
  if (camp?.lat != null && camp.lng != null && !batch.some((row) => row.id === camp.id)) {
    batch.unshift(camp);
  }
  return batch;
}

async function refreshDriveTimes(): Promise<void> {
  if (!myPos) return;
  const seq = ++driveSeq;
  const estimated = estimateDrives(myPos, campsWithCoords());
  if (Object.keys(estimated).length) {
    driveById = estimated;
    skipDriveSchedule = true;
    render();
    skipDriveSchedule = false;
  }
  const next = { ...estimated, ...(await drivingTable(myPos, campsForDrive())) };
  if (seq !== driveSeq) return;
  const same =
    Object.keys(next).length === Object.keys(driveById).length &&
    Object.entries(next).every(([id, eta]) => {
      const prev = driveById[id];
      return prev && prev.durationSec === eta.durationSec && prev.distanceM === eta.distanceM;
    });
  if (same) return;
  driveById = next;
  skipDriveSchedule = true;
  render();
  skipDriveSchedule = false;
}

let bound = false;
function bindOnce(): void {
  if (bound) return;
  bound = true;
  root.addEventListener("click", openHttpInNewTab, true);
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("keydown", onKeydown);
  root.addEventListener("compositionstart", onCompositionStart, true);
  root.addEventListener("compositionend", onCompositionEnd, true);
}

function openHttpInNewTab(e: MouseEvent): void {
  const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
  if (!anchor) return;
  const href = anchor.getAttribute("href") ?? "";
  if (!/^https?:\/\//i.test(href)) return;
  e.preventDefault();
  e.stopPropagation();
  const tab = window.open(href, "_blank");
  if (tab) tab.opener = null;
}

function preserveCaret(id: string): { id: string; value: string; start: number | null } | null {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (!input || document.activeElement !== input) return null;
  return { id, value: input.value, start: input.selectionStart };
}

function restoreCaret(keep: { id: string; value: string; start: number | null } | null): void {
  if (!keep) return;
  const input = document.getElementById(keep.id) as HTMLInputElement | null;
  if (!input) return;
  input.focus();
  if (keep.start != null) input.setSelectionRange(keep.start, keep.start);
}

function renderSearchPane(): string {
  return `
    <aside class="pane-search">
      <header class="brand">
        <button type="button" class="brand-home" data-action="go-home" aria-label="첫 화면">
          <h1>어디캠</h1>
          <p>평점 · 배치도 · 예약 · 내 리뷰</p>
        </button>
        <div class="brand-actions">
          ${
            isCloudConfigured()
              ? cloudUser
                ? `<button type="button" class="btn-ghost btn-sm" data-action="open-lists" data-tab="account">${esc(cloudUser.name || "내 계정")}</button>`
                : `<button type="button" class="btn-ghost btn-sm" data-action="open-login-gate">로그인</button>`
              : ""
          }
          <button type="button" class="btn-ghost btn-sm" data-action="open-lists">${account && !cloudUser ? esc(account.name) : "내 목록"}${favorites.length || hidden.length || diary.length ? ` · ${favorites.length + hidden.length + diary.length}` : ""}</button>
          <button type="button" class="btn-ghost btn-sm" data-action="open-add">추가</button>
          <button type="button" class="btn-ghost btn-sm" data-action="open-data">데이터</button>
        </div>
      </header>
      <div class="search-box">
        <input id="search-input" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" placeholder="캠핑장 · 지역 · 위생 · 전기" value="${esc(query)}" />
      </div>
      <div class="loc-bar">
        <button type="button" class="btn-ghost btn-sm loc-btn ${myPos && originQuery === "현재 위치" ? "active" : ""}" data-action="pin-location">${locLoading ? "위치…" : "내 위치"}</button>
        <button type="button" class="btn-ghost btn-sm loc-btn ${originOpen || (myPos && originQuery !== "현재 위치") ? "active" : ""}" data-action="toggle-origin" aria-expanded="${originOpen ? "true" : "false"}">수동 출발지</button>
        ${
          myPos
            ? `<span class="loc-status">${esc(originQuery || "출발지 설정됨")} · <button type="button" class="text-btn" data-action="clear-location">끄기</button></span>`
            : ""
        }
      </div>
      ${
        originOpen
          ? `<div class="origin-panel">
              <div class="search-box origin-box">
                <input id="origin-input" type="search" enterkeyhint="search" autocomplete="off" placeholder="김포시청 · 우리 동네" value="${esc(originQuery === "현재 위치" ? "" : originQuery)}" />
                <button type="button" class="btn-ghost btn-sm" data-action="search-origin">${originLoading ? "찾는 중" : "찾기"}</button>
              </div>
              ${originHits.length ? `<div class="origin-hits">${originHits.map((hit) => `<button type="button" class="chip" data-action="pick-origin" data-lat="${hit.lat}" data-lng="${hit.lng}" data-name="${esc(hit.name)}">${esc(hit.name)}</button>`).join("")}</div>` : ""}
              ${locError ? `<p class="loc-msg">${esc(locError)}</p>` : `<p class="loc-msg">차 거리·가까운순에 쓸 출발지를 검색합니다. 지역 필터와는 다릅니다.</p>`}
            </div>`
          : locError
            ? `<p class="loc-msg">${esc(locError)}</p>`
            : ""
      }
      ${renderFilterControls()}
      <div class="list-wrap">
        ${renderList()}
      </div>
    </aside>`;
}

function tagLabel(value: string): string {
  if (value === "favorite") return "즐겨찾기";
  if (value === "visited") return "다녀온 곳";
  if (value === "reviewed") return "내 리뷰";
  return value;
}

function activeFilterCount(): number {
  return regions.length + (kind === "all" ? 0 : 1) + tags.length;
}

function highRatedVisible(minScore = 4): Camp[] {
  return visible().filter((camp) => {
    const score = displayScore(camp, reviews);
    return score != null && score >= minScore;
  });
}

function pickRandomCamp(): void {
  const pool = highRatedVisible(4);
  if (!pool.length) {
    alert("지금 필터에서 4점 이상 캠핑장이 없습니다. 필터를 넓혀 보세요.");
    return;
  }
  const others = selectedId ? pool.filter((camp) => camp.id !== selectedId) : pool;
  const pick = (others.length ? others : pool)[Math.floor(Math.random() * (others.length ? others.length : pool.length))];
  go(`camp/${encodeURIComponent(pick.id)}`);
}

function renderFilterControls(): string {
  const count = activeFilterCount();
  const summary = [
    ...regions.map((value) => ({ group: "region", value, label: value })),
    ...(kind === "all" ? [] : [{ group: "kind", value: "all", label: KIND_LABEL[kind as CampKind] ?? kind }]),
    ...tags.map((value) => ({ group: "tag", value, label: tagLabel(value) })),
  ];
  return `
    <div class="filter-bar">
      <button type="button" class="filter-toggle ${filtersOpen || count ? "active" : ""}" data-action="toggle-filters" aria-expanded="${filtersOpen ? "true" : "false"}">
        필터${count ? ` ${count}` : ""}
      </button>
      <button type="button" class="filter-toggle random-btn" data-action="random-camp" title="지금 필터에서 4점 이상 랜덤">랜덤</button>
      <div class="sort-seg">
        ${segment("sort", sort, [
          { value: "recommend", label: "추천" },
          { value: "rating", label: "평점" },
          ...(myPos ? [{ value: "distance", label: "가까운순" }] : []),
        ])}
      </div>
      ${count ? `<button type="button" class="text-btn filter-clear" data-action="clear-filters">초기화</button>` : ""}
    </div>
    ${
      summary.length
        ? `<div class="filter-summary">${summary
            .map(
              (item) =>
                `<button type="button" class="chip filter-chip" data-action="set-filter" data-group="${item.group}" data-value="${esc(item.value)}" ${item.group !== "kind" ? `data-multi="1"` : ""}>${esc(item.label)} ×</button>`
            )
            .join("")}</div>`
        : ""
    }
    ${
      filtersOpen
        ? `<div class="filter-panel">
            <section class="filter-group">
              <h3>지역 <span>여러 개 가능</span></h3>
              ${segment("region", regions, [{ value: "all", label: "전국" }, ...REGION_OPTIONS.map((r) => ({ value: r, label: r }))], true)}
            </section>
            <section class="filter-group">
              <h3>종류</h3>
              ${segment("kind", kind, [{ value: "all", label: "전체" }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))])}
            </section>
            <section class="filter-group">
              <h3>내 목록</h3>
              ${segment("tag", tags, [
                { value: "favorite", label: "즐겨찾기" },
                { value: "visited", label: "다녀온 곳" },
                { value: "reviewed", label: "내 리뷰" },
              ], true)}
            </section>
            <section class="filter-group">
              <h3>장소</h3>
              ${segment("tag", tags, LOCATION_TAGS.map((t) => ({ value: t, label: t })), true)}
            </section>
            <section class="filter-group">
              <h3>편의</h3>
              ${segment("tag", tags, FACILITY_TAGS.map((t) => ({ value: t, label: t })), true)}
            </section>
          </div>`
        : ""
    }`;
}

function segment(group: string, current: string | string[], options: { value: string; label: string }[], multi = false): string {
  return `
    <div class="seg" role="tablist">
      ${options
        .map((o) => {
          const active = Array.isArray(current)
            ? o.value === "all"
              ? current.length === 0
              : current.includes(o.value)
            : current === o.value;
          return `<button type="button" class="seg-btn ${active ? "active" : ""}" data-action="set-filter" data-group="${group}" data-value="${esc(o.value)}" ${multi ? `data-multi="1"` : ""}>${esc(o.label)}</button>`;
        })
        .join("")}
    </div>`;
}

function renderList(): string {
  if (loadError) {
    return empty("파일 DB를 읽지 못했습니다", loadError);
  }
  const trimmed = query.trim();
  if (!trimmed && !regions.length && kind === "all" && !tags.length && sort === "recommend") {
    return renderHomeLists();
  }
  const rows = visible();
  if (!rows.length) {
    return empty("결과가 없습니다", "이름이나 지역, 바다·계곡 같은 태그로 다시 찾아 보세요.");
  }
  return `<ul class="camp-list">${rows.map(resultRow).join("")}</ul>`;
}

function renderHomeLists(): string {
  const pool = browsable();
  const favs = favoriteCamps(pool, favorites.map((item) => item.id));
  const featured = featuredCamps(pool, reviews);
  const mine = reviewedCamps(pool, reviews);
  return `
    ${
      favs.length
        ? `<section class="home-block">
            <h2>즐겨찾기 <button type="button" class="text-btn" data-action="open-lists" data-tab="favorites">관리</button></h2>
            <ul class="camp-list">${favs.map(resultRow).join("")}</ul>
          </section>`
        : ""
    }
    <section class="home-block">
      <h2>이번 주말 어디 갈까</h2>
      <ul class="camp-list">${featured.map(resultRow).join("")}</ul>
    </section>
    ${
      mine.length
        ? `<section class="home-block">
            <h2>내가 남긴 리뷰</h2>
            <ul class="camp-list">${mine.map(resultRow).join("")}</ul>
          </section>`
        : ""
    }
    ${
      recent.length
        ? `<section class="home-block">
            <h2>최근 검색</h2>
            <div class="recent-row">
              ${recent.map((q) => `<button type="button" class="chip" data-action="apply-recent" data-query="${esc(q)}">${esc(q)}</button>`).join("")}
            </div>
          </section>`
        : ""
    }`;
}

function resultRow(camp: Camp): string {
  const score = displayScore(camp, reviews);
  const mine = reviews[camp.id];
  const price = priceRange(camp);
  const eta = driveById[camp.id];
  const fav = isFavorite(camp.id);
  const visited = diaryVisitedSet().has(camp.id);
  const thumb = coverPhoto(camp);
  return `
    <li>
      <button type="button" class="result-row ${selectedId === camp.id ? "active" : ""}" data-action="select" data-id="${esc(camp.id)}">
        <div class="thumb ${thumb ? "has-photo" : ""}" data-region="${esc(camp.region)}">${
          thumb ? `<img src="${esc(thumb)}" alt="" />` : esc(camp.name.slice(0, 1))
        }</div>
        <div class="result-meta">
          <div class="result-title">
            <strong>${esc(camp.name)}</strong>
            ${fav ? `<span class="pill fav">★</span>` : ""}
            ${visited ? `<span class="pill visit">다녀옴</span>` : ""}
            ${mine ? `<span class="pill mine">내 ★${mine.rating}</span>` : ""}
          </div>
          <p>${esc(camp.region)} ${esc(camp.city)} · ${esc(kindLabels(camp.kinds))}</p>
          <p class="muted">${score != null ? `★ ${scoreText(score)}` : "평점 없음"} · ${esc(wonRange(price.min, price.max))}${eta ? ` · ${esc(driveLabel(eta))}` : ""}</p>
        </div>
      </button>
    </li>`;
}

function empty(title: string, message: string): string {
  return `<div class="empty"><strong>${esc(title)}</strong><p>${esc(message)}</p></div>`;
}

function renderDetailPane(): string {
  if (panel === "add") return renderAddPanel();
  if (panel === "data") return renderDataPanel();
  if (panel === "lists") return renderListsPanel();
  const camp = selected();
  if (!camp) {
    return `
      <main class="pane-detail">
        <div class="empty hero-empty">
          <strong>캠핑장 선택</strong>
          <p>왼쪽에서 캠핑장을 고르면 평점, 예약 사이트와 일시, 가격을 보여 줍니다. 다녀온 곳은 방문 다이어리와 리뷰로 남겨 둘 수 있습니다.</p>
        </div>
      </main>`;
  }
  return `<main class="pane-detail">${renderDetail(camp)}</main>`;
}

function renderDetail(camp: Camp): string {
  const mine = reviews[camp.id];
  const map = mapLink(camp);
  const cover = coverPhoto(camp);
  const fav = isFavorite(camp.id);
  const hid = isHidden(camp.id);
  return `
    <header class="mobile-bar">
      <button type="button" class="back-btn" data-action="clear-select">목록</button>
      <strong>${esc(camp.name)}</strong>
    </header>
    <div class="detail-scroll">
      ${hid ? `<p class="list-banner">이 캠핑장은 목록에서 숨겨 두었습니다. <button type="button" class="text-btn" data-action="unhide-camp" data-id="${esc(camp.id)}">다시 보이기</button></p>` : ""}
      <header class="detail-head">
        <div class="poster ${cover ? "has-photo" : ""}" data-region="${esc(camp.region)}">
          ${cover ? `<img src="${esc(cover)}" alt="" />` : `<span>${esc(camp.name.slice(0, 1))}</span>`}
        </div>
        <div>
          <h2>${esc(camp.name)}</h2>
          <p class="sub">${esc(camp.address)}</p>
          <div class="chips">
            <span class="chip static">${esc(camp.region)}</span>
            ${camp.kinds.map((k) => `<span class="chip static">${esc(KIND_LABEL[k])}</span>`).join("")}
            ${camp.tags.map((t) => `<span class="chip static">${esc(t)}</span>`).join("")}
            ${fav ? `<span class="chip static fav">즐겨찾기</span>` : ""}
            ${camp.source === "overlay" ? `<span class="chip static mine">내 추가</span>` : ""}
          </div>
          <p class="lead">${esc(camp.description)}</p>
          <dl class="kv">
            ${camp.phone ? `<div><dt>전화</dt><dd><a href="tel:${esc(camp.phone.replace(/\s+/g, ""))}">${esc(camp.phone)}</a></dd></div>` : ""}
            ${camp.mannersTime ? `<div><dt>매너타임</dt><dd>${esc(camp.mannersTime)}</dd></div>` : ""}
            <div><dt>편의</dt><dd>${esc(camp.amenities.join(" · ") || "정보 없음")}</dd></div>
          </dl>
          <div class="personal-actions">
            <button type="button" class="btn ${fav ? "" : "ghost"}" data-action="toggle-favorite" data-id="${esc(camp.id)}">${fav ? "즐겨찾기 해제" : "즐겨찾기"}</button>
            ${
              hid
                ? `<button type="button" class="btn ghost" data-action="unhide-camp" data-id="${esc(camp.id)}">숨김 해제</button>`
                : `<button type="button" class="btn ghost" data-action="hide-camp" data-id="${esc(camp.id)}">목록에서 숨기기</button>`
            }
          </div>
        </div>
      </header>

      ${driveBlock(camp)}
      ${photosBlock(camp)}
      ${ratingsRow(camp, mine)}
      ${quotesBlock(camp, mine)}
      ${appsBlock(camp)}
      ${reservationBlock(camp)}
      ${priceBlock(camp)}
      ${layoutBlock(camp)}
      ${diaryEditor(camp)}
      ${reviewEditor(camp, mine)}

      <div class="link-row">
        ${camp.reservationUrl ? `<a class="btn" href="${esc(camp.reservationUrl)}">예약하기</a>` : ""}
        ${
          camp.homepage
            ? `<a class="btn ghost" href="${esc(camp.homepage)}">홈페이지</a>`
            : `<a class="btn ghost" href="https://search.naver.com/search.naver?query=${encodeURIComponent(`${camp.name} 홈페이지`)}">홈페이지 검색</a>`
        }
        ${myPos ? `<a class="btn ghost" href="${esc(naverCarDirections(myPos, camp))}">네이버 자동차</a>` : ""}
        ${map ? `<a class="btn ghost" href="${esc(map)}">카카오맵</a>` : ""}
      </div>
      <p class="attrib">평점·빈자리는 네이버지도·캠핏·캠핑톡에서 확인하고, 목록은 파일 DB에 둡니다. 즐겨찾기·숨김·리뷰·다이어리는 Google 로그인하면 기기 간에 맞춥니다.</p>
    </div>`;
}

function driveBlock(camp: Camp): string {
  const eta = driveById[camp.id];
  const naver = myPos ? naverCarDirections(myPos, camp) : `https://map.naver.com/p/search/${encodeURIComponent(camp.name)}`;
  return `
    <section class="block">
      <h3>가는 길</h3>
      ${eta ? `<p class="drive-eta">${esc(driveLabel(eta))}</p>` : ""}
      ${
        eta
          ? `<p class="muted">도로 기준 예상 시간입니다. 실제 소요 시간은 네이버지도에서 확인하세요.</p>`
          : myPos
            ? camp.lat != null
              ? `<p class="muted">가까운 캠핑장부터 거리를 계산하고 있습니다.</p>`
              : `<p class="muted">이 캠핑장은 좌표가 없어 차 거리를 계산하지 못했습니다.</p>`
            : `<p class="muted">왼쪽에서 내 위치를 켜면 차로 가는 시간을 보여 줍니다.</p>`
      }
      <p><a href="${esc(naver)}">${myPos ? "네이버지도 자동차 길찾기" : "네이버지도에서 찾기"}</a></p>
    </section>`;
}

function photosBlock(camp: Camp): string {
  const photos = displayPhotos(camp);
  const naver = `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(`${camp.name} 캠핑장`)}`;
  if (!photos.length) {
    return `
    <section class="block">
      <h3>사진</h3>
      <p class="muted">고캠핑에 등록된 제공 사진이 없습니다. <a href="${esc(naver)}">네이버에서 후기 사진 보기</a></p>
    </section>`;
  }
  const tiles = photos
    .slice(0, 12)
    .map(
      (url) => `
      <button type="button" class="photo-tile" data-action="open-layout" data-url="${esc(url)}" data-image="${esc(url)}" data-title="${esc(`${camp.name} 사진`)}">
        <img src="${esc(url)}" alt="" />
      </button>`
    )
    .join("");
  return `
    <section class="block">
      <h3>사진</h3>
      <p class="muted">배치도·약도는 뒤로 두고, 일반 사진부터 보여 줍니다.</p>
      <div class="photo-grid">${tiles}</div>
      <p class="muted"><a href="${esc(naver)}">네이버에서 후기 사진 더 보기</a></p>
    </section>`;
}

function ratingsRow(camp: Camp, mine?: PersonalReview): string {
  const items = [
    camp.ratings.official != null
      ? badge("고캠핑", scoreText(camp.ratings.official), camp.ratings.officialCount ? `${camp.ratings.officialCount.toLocaleString("ko-KR")}명` : null, "moss")
      : "",
    camp.ratings.naver != null ? badge("네이버", scoreText(camp.ratings.naver), null, "green") : "",
    camp.ratings.kakao != null ? badge("카카오", scoreText(camp.ratings.kakao), null, "yellow") : "",
    mine ? badge("내 평점", `★ ${mine.rating}`, mine.visitedAt ?? "저장됨", "fire") : "",
  ].filter(Boolean);
  const naver = `https://map.naver.com/p/search/${encodeURIComponent(camp.name)}`;
  return `
    <section class="block">
      <h3>평점</h3>
      <div class="badge-row">
        ${items.join("") || `<p class="muted">저장된 점수가 없으면 네이버지도에서 최신 평점·후기를 보세요.</p>`}
      </div>
      <p class="muted"><a href="${esc(naver)}">네이버지도에서 실시간 평점 보기</a></p>
    </section>`;
}

function quotesBlock(camp: Camp, mine?: PersonalReview): string {
  const quotes = camp.quotes?.filter((q) => q.body) ?? [];
  const naver = `https://search.naver.com/search.naver?query=${encodeURIComponent(`${camp.name} 캠핑장 후기`)}`;
  const cards: string[] = [];
  if (mine?.body) {
    cards.push(`
      <article class="quote-card mine">
        <p>${esc(mine.body)}</p>
        <span>내 리뷰 · ★${mine.rating}${mine.siteName ? ` · ${esc(mine.siteName)}` : ""}</span>
      </article>`);
  }
  for (const quote of quotes.slice(0, 3)) {
    const inner = `<p>${esc(quote.body)}</p><span>${esc(quote.source)}${quote.rating ? ` · ★${quote.rating}` : ""}</span>`;
    cards.push(
      quote.url
        ? `<a class="quote-card" href="${esc(quote.url)}">${inner}</a>`
        : `<article class="quote-card">${inner}</article>`
    );
  }
  if (!cards.length) {
    return `
    <section class="block">
      <h3>리뷰</h3>
      <p class="muted">저장된 후기가 아직 없습니다. <a href="${esc(naver)}">네이버 후기</a>에서 최근 글을 볼 수 있습니다.</p>
    </section>`;
  }
  return `
    <section class="block">
      <h3>리뷰</h3>
      <div class="quote-list">${cards.join("")}</div>
      <p class="muted"><a href="${esc(naver)}">네이버에서 후기 더 보기</a></p>
    </section>`;
}

function appsBlock(camp: Camp): string {
  const links = placeLinks(camp);
  if (!links.length) return "";
  const cards = links
    .map(
      (link) => `
      <a class="app-card" href="${esc(link.url)}">
        <strong>${esc(link.name)}</strong>
        <span>${esc(link.hint)}</span>
      </a>`
    )
    .join("");
  return `
    <section class="block">
      <h3>다른 앱에서 보기</h3>
      <p class="muted">등록된 주소가 있는 앱만 보여 줍니다.</p>
      <div class="app-grid">${cards}</div>
    </section>`;
}

function badge(label: string, value: string, subtitle: string | null, tone: string): string {
  return `
    <div class="rating-badge ${tone}">
      <span class="rb-label">${esc(label)}</span>
      <strong>${esc(value)}</strong>
      ${subtitle ? `<span class="rb-sub">${esc(subtitle)}</span>` : ""}
    </div>`;
}

function reservationBlock(camp: Camp): string {
  const windows = camp.reservationWindows
    .map(
      (w) => `
      <li>
        <strong>${esc(w.label)}</strong>
        <p>${esc(w.rule)}</p>
        ${w.startDate || w.endDate ? `<p class="muted">${esc([w.startDate, w.endDate].filter(Boolean).join(" ~ "))}</p>` : ""}
      </li>`
    )
    .join("");
  return `
    <section class="block">
      <h3>예약</h3>
      <p><span class="muted">사이트</span> ${
        camp.reservationUrl
          ? `<a href="${esc(camp.reservationUrl)}">${esc(camp.reservationPlatform || camp.reservationUrl)}</a>`
          : esc(camp.reservationPlatform || "정보 없음")
      }</p>
      ${windows ? `<ul class="window-list">${windows}</ul>` : `<p class="muted">예약 일시 규칙이 아직 파일 DB에 없습니다.</p>`}
    </section>`;
}

function priceBlock(camp: Camp): string {
  if (!camp.siteTypes.length) {
    return `<section class="block"><h3>가격</h3><p class="muted">사이트 요금이 아직 없습니다.</p></section>`;
  }
  const cards = camp.siteTypes
    .map((s) => {
      const off = wonRange(s.priceMin, s.priceMax);
      const peak =
        s.peakPriceMin != null || s.peakPriceMax != null
          ? `<p class="muted">성수기 ${esc(wonRange(s.peakPriceMin, s.peakPriceMax))}</p>`
          : "";
      return `
        <article class="price-card">
          <h4>${esc(s.name)}${s.count ? ` · ${s.count}면` : ""}</h4>
          <p class="price">${esc(off)}</p>
          ${peak}
          ${s.notes ? `<p class="muted">${esc(s.notes)}</p>` : ""}
        </article>`;
    })
    .join("");
  return `
    <section class="block">
      <h3>가격</h3>
      <div class="price-grid">${cards}</div>
      <p class="muted">요금은 시즌·주말에 달라질 수 있습니다. 예약 전 해당 사이트에서 한 번 더 확인하세요.</p>
    </section>`;
}

function layoutBlock(camp: Camp): string {
  const image = officialLayoutImage(camp);
  const site = camp.homepage || camp.reservationUrl;
  if (image) {
    return `
    <section class="block">
      <h3>배치도</h3>
      <button type="button" class="layout-photo-btn" data-action="open-layout" data-url="${esc(image)}" data-image="${esc(image)}" data-title="${esc(`${camp.name} 배치도`)}">
        <img class="layout-photo" src="${esc(image)}" alt="${esc(`${camp.name} 배치도`)}" />
      </button>
      <p class="muted">
        <a href="${esc(image)}">원본 이미지</a>
        ${site ? ` · <a href="${esc(site)}">캠핑장 사이트</a>` : ""}
      </p>
    </section>`;
  }
  if (site) {
    return `
    <section class="block">
      <h3>배치도</h3>
      <p class="muted">등록된 공식 도면이 없어 캠핑장 사이트에서 확인하세요.</p>
      <div class="layout-actions">
        <a class="btn" href="${esc(site)}">캠핑장 사이트에서 보기</a>
      </div>
    </section>`;
  }
  return `
    <section class="block">
      <h3>배치도</h3>
      <p class="muted">등록된 공식 도면이 없습니다.</p>
    </section>`;
}

function renderLayoutModal(): string {
  if (!layoutPopup) return "";
  const src = layoutPopup.image || layoutPopup.url;
  return `
    <div class="layout-modal" data-action="close-layout">
      <div class="layout-modal-card" data-action="keep-layout">
        <header class="layout-modal-head">
          <strong>${esc(layoutPopup.title)}</strong>
          <button type="button" class="btn ghost btn-sm" data-action="close-layout">닫기</button>
        </header>
        <img class="layout-modal-photo" src="${esc(src)}" alt="${esc(layoutPopup.title)}" />
        <p class="muted"><a href="${esc(src)}">이미지 새 창에서 열기</a></p>
      </div>
    </div>`;
}

function reviewEditor(camp: Camp, mine?: PersonalReview): string {
  return `
    <section class="block review-block">
      <h3>나만의 리뷰</h3>
      <p class="muted">이 캠핑장에 대한 종합 평점입니다. 방문 날짜별 기록은 위 다이어리를 쓰세요.</p>
      <form data-action="save-review" data-id="${esc(camp.id)}">
        <div class="star-row" role="radiogroup" aria-label="별점">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) =>
                `<label><input type="radio" name="rating" value="${n}" ${mine?.rating === n ? "checked" : ""} /> ${"★".repeat(n)}</label>`
            )
            .join("")}
        </div>
        <div class="form-row">
          <label>방문일 <input type="date" name="visitedAt" value="${esc(mine?.visitedAt ?? "")}" /></label>
          <label>사이트 <input type="text" name="siteName" placeholder="오토 A-12" value="${esc(mine?.siteName ?? "")}" /></label>
        </div>
        <textarea name="body" rows="4" placeholder="바닥, 간격, 물소리, 예약 꿀팁…">${esc(mine?.body ?? "")}</textarea>
        <div class="form-actions">
          <button type="submit" class="btn">리뷰 저장</button>
          ${mine ? `<button type="button" class="btn ghost" data-action="delete-review" data-id="${esc(camp.id)}">삭제</button>` : ""}
        </div>
      </form>
    </section>`;
}

function diaryEditor(camp: Camp): string {
  const entries = diary.filter((entry) => entry.campId === camp.id);
  const editing = editingDiaryId ? diary.find((entry) => entry.id === editingDiaryId && entry.campId === camp.id) : undefined;
  const defaultDate = editing?.visitedAt || todayISO();
  return `
    <section class="block diary-block">
      <h3>방문 다이어리</h3>
      <p class="muted">언제 갔는지, 몇 박인지 남기면 다이어리 달력에 날짜 색으로 이어져 표시됩니다. Google 로그인하면 다른 기기에도 맞춰집니다.</p>
      <form data-action="save-diary" data-id="${esc(camp.id)}" data-entry="${esc(editing?.id ?? "")}">
        <div class="form-row">
          <label>방문 시작일 <input type="date" name="visitedAt" required value="${esc(defaultDate)}" /></label>
          <label>박수 <input type="number" name="nights" min="0" max="30" step="1" placeholder="1" value="${editing?.nights != null ? editing.nights : "1"}" /></label>
        </div>
        <div class="form-row">
          <label>사이트 <input type="text" name="siteName" placeholder="오토 A-12" value="${esc(editing?.siteName ?? "")}" /></label>
          <label>함께한 사람 <input type="text" name="companions" placeholder="가족, 친구…" value="${esc(editing?.companions ?? "")}" /></label>
        </div>
        <div class="star-row" role="radiogroup" aria-label="그날 별점">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) =>
                `<label><input type="radio" name="rating" value="${n}" ${editing?.rating === n ? "checked" : ""} /> ${"★".repeat(n)}</label>`
            )
            .join("")}
        </div>
        <textarea name="body" rows="4" placeholder="날씨, 자리 느낌, 다음에 다시 오고 싶은지…">${esc(editing?.body ?? "")}</textarea>
        <div class="form-actions">
          <button type="submit" class="btn">${editing ? "기록 수정" : "방문 기록 추가"}</button>
          ${editing ? `<button type="button" class="btn ghost" data-action="cancel-diary-edit">새 기록으로</button>` : ""}
        </div>
      </form>
      ${
        entries.length
          ? `<ul class="diary-entry-list">${entries.map((entry) => diaryEntryCard(entry, true)).join("")}</ul>`
          : `<p class="muted">아직 이 캠핑장 방문 기록이 없습니다.</p>`
      }
    </section>`;
}

function diaryEntryCard(entry: VisitDiaryEntry, showCampActions: boolean): string {
  const days = stayDayCount(entry);
  const meta = [
    entry.nights != null ? `${entry.nights}박 ${days}일` : `${days}일`,
    entry.siteName || "",
    entry.companions || "",
    entry.rating != null ? `★${entry.rating}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `
    <li class="diary-entry">
      <div class="diary-entry-main">
        <strong>${esc(entry.visitedAt)}</strong>
        ${showCampActions ? "" : `<span class="diary-camp">${esc(entry.campName)}</span>`}
        ${meta ? `<span class="muted">${esc(meta)}</span>` : ""}
        ${entry.body ? `<p>${esc(entry.body)}</p>` : `<p class="muted">메모 없음</p>`}
      </div>
      <div class="diary-entry-actions">
        ${
          showCampActions
            ? ""
            : `<button type="button" class="btn-ghost btn-sm" data-action="select" data-id="${esc(entry.campId)}">캠핑장</button>`
        }
        <button type="button" class="btn-ghost btn-sm" data-action="edit-diary" data-entry="${esc(entry.id)}" data-id="${esc(entry.campId)}">수정</button>
        <button type="button" class="btn-ghost btn-sm" data-action="delete-diary" data-entry="${esc(entry.id)}">삭제</button>
      </div>
    </li>`;
}

function renderAddPanel(): string {
  return `
    <main class="pane-detail">
      <header class="mobile-bar">
        <button type="button" class="back-btn" data-action="close-panel">닫기</button>
        <strong>캠핑장 추가</strong>
      </header>
      <div class="detail-scroll">
        <h2>캠핑장 추가</h2>
        <p class="muted">지금 추가한 항목은 이 기기의 임시 DB에 붙습니다. 아래 JSON을 복사해 <code>public/data/camps.json</code> 의 camps 배열에 넣으면 배포 DB에도 남습니다.</p>
        <form class="stack-form" data-action="add-camp">
          <label>이름 <input name="name" required placeholder="예: 가평 숲속캠핑장" /></label>
          <div class="form-row">
            <label>권역
              <select name="region">${REGION_OPTIONS.map((r) => `<option>${r}</option>`).join("")}</select>
            </label>
            <label>시군구 <input name="city" placeholder="가평군" /></label>
          </div>
          <label>주소 <input name="address" placeholder="도로명 주소" /></label>
          <fieldset>
            <legend>종류</legend>
            ${Object.entries(KIND_LABEL)
              .map(([value, label]) => `<label class="check"><input type="checkbox" name="kinds" value="${value}" /> ${label}</label>`)
              .join("")}
          </fieldset>
          <label>예약 사이트 URL <input name="reservationUrl" type="url" placeholder="https://" /></label>
          <label>예약 플랫폼 <input name="reservationPlatform" placeholder="캠핑톡, 숲나들e, 자체…" /></label>
          <label>예약 규칙 <input name="reservationRule" placeholder="매월 1일 09:00 선착순" /></label>
          <div class="form-row">
            <label>최저 요금 <input name="priceMin" type="number" min="0" step="1000" /></label>
            <label>최고 요금 <input name="priceMax" type="number" min="0" step="1000" /></label>
          </div>
          <label>한줄 소개 <textarea name="description" rows="3"></textarea></label>
          <button type="submit" class="btn">이 기기에 추가</button>
        </form>
      </div>
    </main>`;
}

function renderDataPanel(): string {
  const json = overlayToJson(overlay);
  return `
    <main class="pane-detail">
      <header class="mobile-bar">
        <button type="button" class="back-btn" data-action="close-panel">닫기</button>
        <strong>파일 DB</strong>
      </header>
      <div class="detail-scroll">
        <h2>파일 DB를 늘리는 방법</h2>
        <p>목록은 <code>public/data/index.json</code> 의 packs 파일들을 합쳐 만듭니다. 지금 ${camps.length}곳입니다.</p>
        <ol class="steps">
          <li><strong>팩 파일 추가</strong> — <code>public/data/packs/</code> 에 JSON을 만들고 index.json 의 packs 에 경로만 넣으면 배포 목록이 늘어납니다. 국립공원·휴양림·지역 유명지는 이미 이 방식입니다.</li>
          <li><strong>고캠핑 주간 동기화</strong> — GitHub Actions가 매주 월요일 고캠핑 공식 API에서 인기 후보(경기 우선)를 골라 PR을 엽니다. 로컬은 <code>GOCAMPING_KEY=키 npm run sync</code>. 캠핏·네이버는 긁지 않습니다.</li>
          <li><strong>앱에서 추가</strong> — 추가 폼이나 아래 JSON 가져오기로 이 기기에 붙인 뒤, 복사해서 팩 파일에 넣으면 웹에도 남습니다.</li>
        </ol>
        <p class="muted">파일 갱신일 ${esc(catalogUpdated || "–")} · 이 기기 임시 추가 ${overlay.length}곳</p>
        ${catalogNote ? `<p class="muted">${esc(catalogNote)}</p>` : ""}
        <h3>JSON 가져오기</h3>
        <textarea id="import-json" class="json-box" placeholder='{"camps":[{"id":"example","name":"이름","region":"경기","city":"가평군"}]}'></textarea>
        <div class="form-actions">
          <button type="button" class="btn" data-action="import-overlay">이 기기에 가져오기</button>
        </div>
        <h3>이 기기에서 추가한 JSON</h3>
        <textarea id="overlay-json" class="json-box" readonly>${esc(json)}</textarea>
        <div class="form-actions">
          <button type="button" class="btn" data-action="copy-overlay" ${overlay.length ? "" : "disabled"}>JSON 복사</button>
          ${overlay.length ? `<button type="button" class="btn ghost" data-action="clear-overlay">임시 추가 비우기</button>` : ""}
        </div>
      </div>
    </main>`;
}

function applyPersonalData(): void {
  const data = reloadPersonalData();
  favorites = data.favorites;
  hidden = data.hidden;
  reviews = data.reviews;
  diary = data.diary;
  account = currentAccount();
}

function renderListsPanel(): string {
  const visitedCount = diaryVisitedSet().size;
  return `
    <main class="pane-detail">
      <header class="mobile-bar">
        <button type="button" class="back-btn" data-action="close-panel">닫기</button>
        <strong>내 목록</strong>
      </header>
      <div class="detail-scroll">
        <h2>즐겨찾기 · 다녀온 곳 · 다이어리</h2>
        <p class="muted">${
          cloudUser
            ? `<strong>${esc(cloudUser.name || cloudUser.email || "Google")}</strong> 계정으로 동기화 중입니다.`
            : account
              ? `<strong>${esc(account.name)}</strong> 계정으로 저장 중입니다. 이 기기의 브라우저에만 남습니다.`
              : "지금은 게스트입니다. Google 로그인하면 즐겨찾기·다이어리·리뷰를 다른 기기와 맞출 수 있습니다."
        }</p>
        <div class="seg lists-tabs" role="tablist">
          <button type="button" class="seg-btn ${listsTab === "favorites" ? "active" : ""}" data-action="lists-tab" data-tab="favorites">즐겨찾기 ${favorites.length}</button>
          <button type="button" class="seg-btn ${listsTab === "visited" ? "active" : ""}" data-action="lists-tab" data-tab="visited">다녀온 곳 ${visitedCount}</button>
          <button type="button" class="seg-btn ${listsTab === "hidden" ? "active" : ""}" data-action="lists-tab" data-tab="hidden">숨김 ${hidden.length}</button>
          <button type="button" class="seg-btn ${listsTab === "account" ? "active" : ""}" data-action="lists-tab" data-tab="account">계정</button>
          <button type="button" class="seg-btn diary-tab ${listsTab === "diary" ? "active" : ""}" data-action="lists-tab" data-tab="diary">다이어리 ${diary.length}</button>
        </div>
        ${
          listsTab === "account"
            ? renderAccountPanel()
            : listsTab === "diary"
              ? renderDiaryCalendarPanel()
              : listsTab === "visited"
                ? renderVisitedListPanel()
                : renderSavedListPanel()
        }
      </div>
    </main>`;
}

function renderVisitedListPanel(): string {
  const rows = visitedCampSummaries();
  if (!rows.length) {
    return empty("다녀온 곳이 없습니다", "캠핑장 상세의 방문 다이어리에 기록을 남기면 여기에 모입니다.");
  }
  const items = rows
    .map((item) => {
      const camp = camps.find((c) => c.id === item.campId);
      return `
        <li class="saved-row">
          <button type="button" class="saved-main" data-action="select" data-id="${esc(item.campId)}" ${camp ? "" : "disabled"}>
            <strong>${esc(item.campName)}</strong>
            <span>${esc([item.region, item.city].filter(Boolean).join(" · ") || "위치 정보 없음")}</span>
            <span class="muted">${esc(item.lastVisitedAt)} 최근 · ${item.visitCount}회${item.lastRating != null ? ` · ★${item.lastRating}` : ""}${camp ? "" : " · 목록에서 찾을 수 없음"}</span>
          </button>
          <div class="saved-actions">
            <button type="button" class="btn-ghost btn-sm" data-action="open-diary-day" data-day="${esc(item.lastVisitedAt)}">달력</button>
          </div>
        </li>`;
    })
    .join("");
  return `
    <p class="muted">방문 다이어리 기준으로 ${rows.length}곳입니다. 날짜별 기록은 다이어리 달력에서 보세요.</p>
    <ul class="saved-list">${items}</ul>`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 박수 → 달력에 칠할 일수 (0박=당일 1일, 1박=2일, 2박=3일) */
function stayDayCount(entry: VisitDiaryEntry): number {
  const nights = entry.nights != null && Number.isFinite(entry.nights) ? Math.max(0, Math.round(entry.nights)) : 0;
  return Math.max(1, nights + 1);
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function entryCoversDay(entry: VisitDiaryEntry, day: string): boolean {
  if (!entry.visitedAt || !/^\d{4}-\d{2}-\d{2}$/.test(entry.visitedAt) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const end = addDaysISO(entry.visitedAt, stayDayCount(entry) - 1);
  return day >= entry.visitedAt && day <= end;
}

function entriesCoveringDay(day: string): VisitDiaryEntry[] {
  return diary.filter((entry) => entryCoversDay(entry, day));
}

/** 달력 색 단계: 1일 / 2일 / 3일+ */
function dayStayTone(day: string): 0 | 1 | 2 | 3 {
  const covering = entriesCoveringDay(day);
  if (!covering.length) return 0;
  const maxDays = Math.max(...covering.map(stayDayCount));
  if (maxDays >= 3) return 3;
  if (maxDays === 2) return 2;
  return 1;
}

function shortCampLabel(name: string, max = 7): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function searchDiaryCamps(q: string): Camp[] {
  const trimmed = q.trim();
  if (trimmed.length < 1) return [];
  return browsable()
    .map((camp) => ({ camp, score: relevance(camp, trimmed) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.camp.name.localeCompare(b.camp.name, "ko"))
    .slice(0, 8)
    .map((row) => row.camp);
}

function refreshDiaryCampHits(): void {
  const wrap = root.querySelector(".diary-camp-hits");
  if (!wrap) {
    render();
    return;
  }
  wrap.innerHTML = renderDiaryCampHits();
}

function renderDiaryCampHits(): string {
  if (!diaryCampQuery.trim()) return "";
  if (!diaryCampHits.length) return `<p class="muted">검색 결과가 없습니다.</p>`;
  return `<div class="diary-camp-hit-list">${diaryCampHits
    .map(
      (camp) =>
        `<button type="button" class="chip" data-action="pick-diary-camp" data-id="${esc(camp.id)}">${esc(camp.name)} <span class="muted">${esc(camp.region)} ${esc(camp.city)}</span></button>`
    )
    .join("")}</div>`;
}

function renderDiaryComposer(): string {
  const draft = diaryDraftCampId ? camps.find((c) => c.id === diaryDraftCampId) : undefined;
  const editing = editingDiaryId ? diary.find((entry) => entry.id === editingDiaryId) : undefined;
  const camp = editing ? camps.find((c) => c.id === editing.campId) ?? draft : draft;
  const defaultDate = editing?.visitedAt || diaryDay || todayISO();
  if (!camp && !editing) {
    return `
      <section class="diary-composer">
        <h3>방문 기록 추가</h3>
        <p class="muted">캠핑장 상세에서도 남길 수 있고, 여기서 검색해서 바로 넣을 수도 있습니다. 박수만큼 달력에 색이 이어집니다. (1박→2일, 2박→3일)</p>
        <label>캠핑장 검색
          <input id="diary-camp-input" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" placeholder="캠핑장 이름 · 지역" value="${esc(diaryCampQuery)}" />
        </label>
        <div class="diary-camp-hits">${renderDiaryCampHits()}</div>
      </section>`;
  }
  const target = camp ?? {
    id: editing!.campId,
    name: editing!.campName,
    region: editing!.region,
    city: editing!.city,
  };
  return `
    <section class="diary-composer">
      <h3>${editing ? "기록 수정" : "방문 기록 추가"}</h3>
      <p class="composer-camp"><strong>${esc(target.name)}</strong> <span class="muted">${esc([target.region, target.city].filter(Boolean).join(" · "))}</span>
        ${editing ? "" : `<button type="button" class="text-btn" data-action="clear-diary-camp">캠핑장 다시 고르기</button>`}
      </p>
      <form data-action="save-diary" data-id="${esc(target.id)}" data-entry="${esc(editing?.id ?? "")}">
        <div class="form-row">
          <label>방문 시작일 <input type="date" name="visitedAt" required value="${esc(defaultDate)}" /></label>
          <label>박수 <input type="number" name="nights" min="0" max="30" step="1" placeholder="1" value="${editing?.nights != null ? editing.nights : "1"}" /></label>
        </div>
        <div class="form-row">
          <label>사이트 <input type="text" name="siteName" placeholder="오토 A-12" value="${esc(editing?.siteName ?? "")}" /></label>
          <label>함께한 사람 <input type="text" name="companions" placeholder="가족, 친구…" value="${esc(editing?.companions ?? "")}" /></label>
        </div>
        <div class="star-row" role="radiogroup" aria-label="그날 별점">
          ${[1, 2, 3, 4, 5]
            .map((n) => `<label><input type="radio" name="rating" value="${n}" ${editing?.rating === n ? "checked" : ""} /> ${"★".repeat(n)}</label>`)
            .join("")}
        </div>
        <textarea name="body" rows="3" placeholder="날씨, 자리 느낌, 다음에 다시 오고 싶은지…">${esc(editing?.body ?? "")}</textarea>
        <div class="form-actions">
          <button type="submit" class="btn">${editing ? "기록 수정" : "달력에 넣기"}</button>
          ${editing ? `<button type="button" class="btn ghost" data-action="cancel-diary-edit">취소</button>` : ""}
        </div>
      </form>
    </section>`;
}

function renderDiaryCalendarPanel(): string {
  const [year, month] = diaryMonth.split("-").map(Number);
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = todayISO();
  const monthStart = `${diaryMonth}-01`;
  const monthEnd = `${diaryMonth}-${String(daysInMonth).padStart(2, "0")}`;
  const monthEntries = diary
    .filter((entry) => {
      if (!entry.visitedAt) return false;
      const end = addDaysISO(entry.visitedAt, stayDayCount(entry) - 1);
      return entry.visitedAt <= monthEnd && end >= monthStart;
    })
    .sort((a, b) => (b.visitedAt || "").localeCompare(a.visitedAt || ""));

  const cells: string[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(`<div class="cal-cell empty"></div>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${diaryMonth}-${String(day).padStart(2, "0")}`;
    const tone = dayStayTone(iso);
    const hits = entriesCoveringDay(iso);
    const selected = diaryDay === iso;
    const names = [...new Set(hits.map((entry) => entry.campName).filter(Boolean))];
    const label = names.length
      ? names.length === 1
        ? shortCampLabel(names[0])
        : `${shortCampLabel(names[0])} 외${names.length - 1}`
      : "";
    const title = names.length ? names.join(", ") : iso;
    cells.push(`
      <button type="button" class="cal-cell ${tone ? `stay-${tone}` : ""} ${names.length ? "named" : ""} ${selected ? "selected" : ""} ${iso === today ? "today" : ""}" data-action="diary-select-day" data-day="${iso}" title="${esc(title)}">
        <span class="cal-day">${day}</span>
        ${label ? `<span class="cal-camp">${esc(label)}</span>` : ""}
      </button>`);
  }

  const selectedEntries = diaryDay ? entriesCoveringDay(diaryDay) : [];
  return `
    <section class="diary-calendar">
      ${renderDiaryComposer()}
      <div class="cal-head">
        <button type="button" class="btn-ghost btn-sm" data-action="diary-prev-month" aria-label="이전 달">‹</button>
        <strong>${year}년 ${month}월</strong>
        <button type="button" class="btn-ghost btn-sm" data-action="diary-next-month" aria-label="다음 달">›</button>
      </div>
      <div class="cal-legend" aria-hidden="true">
        <span><i class="stay-1"></i> 1일</span>
        <span><i class="stay-2"></i> 2일</span>
        <span><i class="stay-3"></i> 3일+</span>
      </div>
      <p class="muted">이달 ${monthEntries.length}번 · 전체 ${diary.length}번 · ${diaryVisitedSet().size}곳 · 박수만큼 날짜가 이어져 칠해집니다</p>
      <div class="cal-weekdays" aria-hidden="true">
        <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
      </div>
      <div class="cal-grid">${cells.join("")}</div>
      ${
        diaryDay
          ? `<div class="cal-day-panel">
              <h3>${esc(diaryDay)}</h3>
              ${
                selectedEntries.length
                  ? `<ul class="diary-entry-list">${selectedEntries.map((entry) => diaryEntryCard(entry, false)).join("")}</ul>`
                  : `<p class="muted">이 날 기록이 없습니다. 위에서 캠핑장을 찾아 추가해 보세요.</p>`
              }
            </div>`
          : monthEntries.length
            ? `<div class="cal-day-panel">
                <h3>이달 기록</h3>
                <ul class="diary-entry-list">${monthEntries.map((entry) => diaryEntryCard(entry, false)).join("")}</ul>
              </div>`
            : `<p class="muted">이달 방문 기록이 없습니다. 위에서 캠핑장을 검색해 넣거나, 날짜를 고른 뒤 추가해 보세요.</p>`
      }
    </section>`;
}

function renderSavedListPanel(): string {
  const rows = listsTab === "favorites" ? favorites : hidden;
  const items = rows
    .map((item) => {
      const camp = camps.find((c) => c.id === item.id);
      return `
        <li class="saved-row">
          <button type="button" class="saved-main" data-action="select" data-id="${esc(item.id)}" ${camp ? "" : "disabled"}>
            <strong>${esc(item.name)}</strong>
            <span>${esc([item.region, item.city].filter(Boolean).join(" · ") || "위치 정보 없음")}</span>
            <span class="muted">${esc(item.savedAt)} 저장${camp ? "" : " · 목록에서 찾을 수 없음"}</span>
          </button>
          <div class="saved-actions">
            ${
              listsTab === "favorites"
                ? `<button type="button" class="btn-ghost btn-sm" data-action="toggle-favorite" data-id="${esc(item.id)}">해제</button>`
                : `<button type="button" class="btn-ghost btn-sm" data-action="unhide-camp" data-id="${esc(item.id)}">다시 보이기</button>`
            }
          </div>
        </li>`;
    })
    .join("");

  if (!rows.length) {
    return empty(
      listsTab === "favorites" ? "즐겨찾기가 없습니다" : "숨긴 캠핑장이 없습니다",
      listsTab === "favorites"
        ? "캠핑장 상세에서 즐겨찾기를 누르면 여기에 모입니다."
        : "보고 싶지 않은 캠핑장은 상세에서 숨기면 됩니다."
    );
  }

  return `
    <ul class="saved-list">${items}</ul>
    <div class="form-actions">
      ${
        listsTab === "favorites"
          ? `<button type="button" class="btn ghost" data-action="clear-favorites">즐겨찾기 비우기</button>`
          : `<button type="button" class="btn ghost" data-action="clear-hidden">숨김 목록 비우기</button>`
      }
    </div>`;
}

function renderAccountPanel(): string {
  const accounts = listAccounts();
  if (accountMode === "create") {
    return `
      <section class="account-card">
        <h3>계정 만들기</h3>
        <p class="muted">이름만으로도 됩니다. PIN(숫자 4자리)을 넣으면 바꿀 때 확인합니다.</p>
        ${accountError ? `<p class="loc-msg">${esc(accountError)}</p>` : ""}
        <form class="stack-form" data-action="create-account">
          <label>이름 <input name="name" required minlength="2" maxlength="20" placeholder="예: 이현" autocomplete="username" /></label>
          <label>PIN (선택) <input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="숫자 4자리" autocomplete="new-password" /></label>
          <label class="check"><input type="checkbox" name="migrate" checked /> 지금 게스트에 있는 즐겨찾기·숨김·리뷰·다이어리 가져오기</label>
          <div class="form-actions">
            <button type="submit" class="btn">만들기</button>
            <button type="button" class="btn ghost" data-action="account-mode" data-mode="home">취소</button>
          </div>
        </form>
      </section>`;
  }

  if (accountMode === "login" && loginTargetId) {
    const target = accounts.find((row) => row.id === loginTargetId);
    return `
      <section class="account-card">
        <h3>${esc(target?.name ?? "계정")} 열기</h3>
        <p class="muted">PIN을 입력해 주세요.</p>
        ${accountError ? `<p class="loc-msg">${esc(accountError)}</p>` : ""}
        <form class="stack-form" data-action="login-account">
          <input type="hidden" name="id" value="${esc(loginTargetId)}" />
          <label>PIN <input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required placeholder="숫자 4자리" autocomplete="current-password" /></label>
          <div class="form-actions">
            <button type="submit" class="btn">열기</button>
            <button type="button" class="btn ghost" data-action="account-mode" data-mode="home">취소</button>
          </div>
        </form>
      </section>`;
  }

  return `
    <section class="account-card">
      <h3>다른 기기 동기화</h3>
      ${
        isCloudConfigured()
          ? cloudUser
            ? `<p><strong>${esc(cloudUser.name || cloudUser.email || "구글 계정")}</strong>으로 동기화 중입니다.</p>
               <p class="muted">즐겨찾기·숨김·리뷰·다이어리만 클라우드에 맞춥니다. 캠핑장 목록은 파일 DB(JSON)입니다.</p>
               ${cloudNote ? `<p class="loc-msg">${esc(cloudNote)}</p>` : ""}
               <div class="form-actions">
                 <button type="button" class="btn" data-action="cloud-sync-now" ${cloudBusy ? "disabled" : ""}>${cloudBusy ? "맞추는 중…" : "지금 맞추기"}</button>
                 <button type="button" class="btn ghost" data-action="cloud-logout" ${cloudBusy ? "disabled" : ""}">동기화 끄기</button>
               </div>`
            : `<p class="muted">구글 로그인으로 즐겨찾기·숨김·리뷰·다이어리를 다른 기기와 맞춥니다. 캠핑장 목록은 JSON 파일 그대로입니다.</p>
               ${cloudNote ? `<p class="loc-msg">${esc(cloudNote)}</p>` : ""}
               <div class="form-actions">
                 <button type="button" class="btn" data-action="cloud-google" ${cloudBusy ? "disabled" : ""}>${cloudBusy ? "연결 중…" : "Google로 동기화"}</button>
               </div>`
          : `<p class="muted">캠핑장 목록은 JSON으로 두고, 개인 목록만 Firestore로 맞추는 구조입니다.</p>
             <ol class="steps">
               <li>Firebase에서 Google 로그인 + Firestore를 켭니다.</li>
               <li>웹 앱 설정값을 GitHub Actions Secrets에 넣습니다.</li>
               <li>Pages를 다시 배포한 뒤 여기서 Google로 동기화합니다.</li>
             </ol>
             <p class="muted">자세한 순서: 저장소 <code>docs/cloud-sync.md</code></p>`
      }
    </section>
    <section class="account-card">
      <h3>이 기기 프로필</h3>
      <p>${account ? `<strong>${esc(account.name)}</strong>` : "<strong>게스트</strong> (이 기기 임시)"}</p>
      <p class="muted">같은 브라우저에서 이름별로 목록을 나눌 때 씁니다. 다른 기기 공유는 위 Google 동기화를 쓰세요.</p>
      ${accountError ? `<p class="loc-msg">${esc(accountError)}</p>` : ""}
      <div class="form-actions">
        <button type="button" class="btn ghost" data-action="account-mode" data-mode="create">프로필 만들기</button>
        ${account ? `<button type="button" class="btn ghost" data-action="logout-account">게스트로 돌아가기</button>` : ""}
      </div>
    </section>
    ${
      accounts.length
        ? `<section class="account-card">
            <h3>이 기기 프로필 목록</h3>
            <ul class="account-list">
              ${accounts
                .map(
                  (row) => `
                <li class="account-row ${account?.id === row.id ? "active" : ""}">
                  <div>
                    <strong>${esc(row.name)}</strong>
                    <span class="muted">${esc(row.createdAt)} · ${row.pinHash ? "PIN 있음" : "PIN 없음"}</span>
                  </div>
                  <div class="saved-actions">
                    ${
                      account?.id === row.id
                        ? `<span class="pill fav">사용 중</span>`
                        : `<button type="button" class="btn-ghost btn-sm" data-action="switch-account" data-id="${esc(row.id)}" data-pin="${row.pinHash ? "1" : "0"}">열기</button>`
                    }
                    <button type="button" class="btn-ghost btn-sm" data-action="delete-account" data-id="${esc(row.id)}" data-name="${esc(row.name)}">삭제</button>
                  </div>
                </li>`
                )
                .join("")}
            </ul>
          </section>`
        : `<p class="muted">아직 만든 로컬 프로필이 없습니다.</p>`
    }`;
}

function toggleFilter(list: string[], value: string): string[] {
  if (value === "all") return [];
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function locationFailMessage(err?: GeolocationPositionError): string {
  if (err && (err.code === err.TIMEOUT || err.code === err.POSITION_UNAVAILABLE)) {
    return "GPS 신호를 못 받았습니다. 출발지에 동네나 시청을 적고 찾기를 눌러 주세요.";
  }
  return "이 탭에서는 GPS를 쓰지 못했습니다. 위치는 켜져 있어도 사이트 권한이 없거나, 이 창이 GPS를 막기도 합니다. 출발지를 검색해 주세요.";
}

function pinMyLocation(): void {
  if (!window.isSecureContext || !navigator.geolocation) {
    locError = "이 화면에서는 GPS를 못 씁니다. 출발지를 검색해 주세요.";
    render();
    return;
  }
  locLoading = true;
  locError = null;
  const btn = document.querySelector<HTMLButtonElement>('[data-action="pin-location"]');
  if (btn) btn.textContent = "위치…";

  const onOk = (pos: GeolocationPosition): void => {
    applyOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }, "현재 위치");
  };
  const onFail = (err: GeolocationPositionError): void => {
    locLoading = false;
    locError = locationFailMessage(err);
    originOpen = true;
    render();
    document.getElementById("origin-input")?.focus();
  };

  // 고정밀은 권한은 있는데도 실패하는 경우가 많아, 먼저 낮은 정확도로 받습니다.
  navigator.geolocation.getCurrentPosition(onOk, onFail, {
    enableHighAccuracy: false,
    timeout: 10000,
    maximumAge: 300000,
  });
}

function applyOrigin(pos: GeoPos, label: string): void {
  myPos = pos;
  originQuery = label;
  originHits = [];
  locError = null;
  locLoading = false;
  originLoading = false;
  originOpen = false;
  sort = "distance";
  render();
}

async function searchOrigin(): Promise<void> {
  const q = originQuery.trim();
  if (q.length < 2) {
    locError = "출발지를 두 글자 이상 적어 주세요.";
    render();
    return;
  }
  originLoading = true;
  locError = null;
  render();
  const hits = await geocodePlace(q);
  originLoading = false;
  if (!hits.length) {
    locError = "출발지를 찾지 못했습니다. 김포시청, 김포 장기동처럼 적어 보세요.";
    originHits = [];
    render();
    return;
  }
  if (hits.length === 1) {
    applyOrigin({ lat: hits[0].lat, lng: hits[0].lng }, hits[0].name);
    return;
  }
  originHits = hits;
  locError = "출발지를 골라 주세요.";
  render();
}

function onClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  switch (action) {
    case "select":
      if (el.dataset.id) go(`camp/${encodeURIComponent(el.dataset.id)}`);
      break;
    case "clear-select":
      go("");
      break;
    case "go-home":
      query = "";
      regions = [];
      kind = "all";
      tags = [];
      sort = "recommend";
      filtersOpen = false;
      originOpen = false;
      layoutPopup = null;
      go("");
      break;
    case "toggle-filters":
      filtersOpen = !filtersOpen;
      render();
      break;
    case "toggle-origin":
      originOpen = !originOpen;
      if (originOpen) locError = null;
      render();
      if (originOpen) document.getElementById("origin-input")?.focus();
      break;
    case "clear-filters":
      regions = [];
      kind = "all";
      tags = [];
      render();
      break;
    case "random-camp":
      pickRandomCamp();
      break;
    case "set-filter": {
      const group = el.dataset.group;
      const value = el.dataset.value ?? "all";
      if (group === "region") regions = toggleFilter(regions, value);
      if (group === "kind") kind = value;
      if (group === "tag") tags = toggleFilter(tags, value);
      if (group === "sort") sort = value === "rating" ? "rating" : value === "distance" ? "distance" : "recommend";
      render();
      break;
    }
    case "pin-location":
      pinMyLocation();
      break;
    case "search-origin":
      void searchOrigin();
      break;
    case "pick-origin": {
      const lat = Number(el.dataset.lat);
      const lng = Number(el.dataset.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) break;
      applyOrigin({ lat, lng }, el.dataset.name || originQuery);
      break;
    }
    case "clear-location":
      myPos = null;
      originHits = [];
      locError = null;
      locLoading = false;
      driveById = {};
      if (sort === "distance") sort = "recommend";
      render();
      break;
    case "apply-recent":
      query = el.dataset.query ?? "";
      render();
      break;
    case "open-add":
      go("add");
      break;
    case "open-data":
      go("data");
      break;
    case "open-lists":
      listsTab = listsTabFromDataset(el.dataset.tab);
      accountMode = "home";
      accountError = null;
      go(listsHash(listsTab));
      break;
    case "lists-tab":
      listsTab = listsTabFromDataset(el.dataset.tab);
      accountMode = "home";
      accountError = null;
      go(listsHash(listsTab));
      break;
    case "diary-prev-month":
      diaryMonth = shiftMonth(diaryMonth, -1);
      diaryDay = null;
      render();
      break;
    case "diary-next-month":
      diaryMonth = shiftMonth(diaryMonth, 1);
      diaryDay = null;
      render();
      break;
    case "diary-select-day": {
      const day = el.dataset.day;
      if (!day) break;
      diaryDay = diaryDay === day ? null : day;
      render();
      break;
    }
    case "pick-diary-camp": {
      const id = el.dataset.id;
      if (!id) break;
      diaryDraftCampId = id;
      diaryCampQuery = "";
      diaryCampHits = [];
      editingDiaryId = null;
      render();
      break;
    }
    case "clear-diary-camp":
      diaryDraftCampId = null;
      diaryCampQuery = "";
      diaryCampHits = [];
      editingDiaryId = null;
      render();
      break;
    case "open-diary-day": {
      const day = el.dataset.day;
      if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
        diaryMonth = day.slice(0, 7);
        diaryDay = day;
      }
      listsTab = "diary";
      accountMode = "home";
      accountError = null;
      go("diary");
      break;
    }
    case "account-mode":
      accountMode = el.dataset.mode === "create" ? "create" : el.dataset.mode === "login" ? "login" : "home";
      accountError = null;
      if (accountMode !== "login") loginTargetId = null;
      listsTab = "account";
      render();
      break;
    case "cloud-google":
      void connectGoogleSync(false);
      break;
    case "gate-google":
      void connectGoogleSync(true);
      break;
    case "gate-skip":
      setGateDismissed(true);
      showLoginGate = false;
      accountError = null;
      cloudNote = null;
      render();
      break;
    case "open-login-gate":
      showLoginGate = true;
      accountError = null;
      cloudNote = null;
      go("");
      render();
      break;
    case "cloud-sync-now":
      void syncFromCloud(true);
      break;
    case "cloud-logout":
      void disconnectGoogleSync();
      break;
    case "switch-account": {
      const id = el.dataset.id;
      if (!id) break;
      if (el.dataset.pin === "1") {
        loginTargetId = id;
        accountMode = "login";
        accountError = null;
        listsTab = "account";
        render();
        break;
      }
      void switchAccount(id);
      break;
    }
    case "logout-account":
      logoutAccount();
      applyPersonalData();
      accountMode = "home";
      accountError = null;
      render();
      break;
    case "delete-account": {
      const id = el.dataset.id;
      const name = el.dataset.name || "이 계정";
      if (!id) break;
      if (!confirm(`${name} 계정을 삭제할까요? 즐겨찾기·숨김·리뷰·다이어리도 함께 지워집니다.`)) return;
      deleteAccount(id);
      applyPersonalData();
      accountMode = "home";
      accountError = null;
      render();
      break;
    }
    case "toggle-favorite": {
      const id = el.dataset.id;
      if (!id) break;
      toggleFavorite(id);
      render();
      break;
    }
    case "hide-camp": {
      const id = el.dataset.id;
      if (!id) break;
      hideCamp(id);
      go("");
      break;
    }
    case "unhide-camp": {
      const id = el.dataset.id;
      if (!id) break;
      hidden = hidden.filter((item) => item.id !== id);
      saveHidden(hidden);
      render();
      break;
    }
    case "clear-favorites":
      if (!confirm("즐겨찾기를 모두 지울까요?")) return;
      favorites = [];
      saveFavorites(favorites);
      render();
      break;
    case "clear-hidden":
      if (!confirm("숨긴 캠핑장을 모두 다시 보이게 할까요?")) return;
      hidden = [];
      saveHidden(hidden);
      render();
      break;
    case "close-panel":
      go("");
      break;
    case "delete-review": {
      const id = el.dataset.id;
      if (!id) return;
      delete reviews[id];
      saveReviews(reviews);
      render();
      break;
    }
    case "edit-diary": {
      const entryId = el.dataset.entry;
      const campId = el.dataset.id;
      if (!entryId || !campId) break;
      editingDiaryId = entryId;
      diaryDraftCampId = campId;
      const entry = diary.find((row) => row.id === entryId);
      if (entry?.visitedAt && /^\d{4}-\d{2}-\d{2}$/.test(entry.visitedAt)) {
        diaryMonth = entry.visitedAt.slice(0, 7);
        diaryDay = entry.visitedAt;
      }
      if (panel === "lists" && listsTab === "diary") {
        render();
        break;
      }
      go(`camp/${encodeURIComponent(campId)}`);
      break;
    }
    case "cancel-diary-edit":
      editingDiaryId = null;
      if (panel === "lists" && listsTab === "diary") {
        diaryDraftCampId = null;
        diaryCampQuery = "";
        diaryCampHits = [];
      }
      render();
      break;
    case "delete-diary": {
      const entryId = el.dataset.entry;
      if (!entryId) break;
      if (!confirm("이 방문 기록을 삭제할까요?")) return;
      diary = diary.filter((entry) => entry.id !== entryId);
      saveDiary(diary);
      if (editingDiaryId === entryId) editingDiaryId = null;
      render();
      break;
    }
    case "copy-overlay":
      void navigator.clipboard.writeText(overlayToJson(overlay));
      el.textContent = "복사됨";
      break;
    case "import-overlay": {
      const box = document.getElementById("import-json") as HTMLTextAreaElement | null;
      try {
        const rows = parseCampList(box?.value ?? "");
        if (!rows.length) {
          alert("camps 배열이 있는 JSON을 넣어 주세요.");
          break;
        }
        overlay = [
          ...overlay.filter((item) => !rows.some((row) => row.id === item.id)),
          ...rows.map((row) => ({ ...normalizeCamp(row), source: "overlay" as const })),
        ];
        saveOverlay(overlay);
        void reloadMerged();
      } catch {
        alert("JSON 형식을 확인하세요.");
      }
      break;
    }
    case "clear-overlay":
      if (!confirm("이 기기에만 있는 추가 캠핑장을 모두 지울까요? 파일 DB는 그대로입니다.")) return;
      overlay = [];
      saveOverlay(overlay);
      void reloadMerged();
      break;
    case "open-layout": {
      const url = el.dataset.url;
      if (!url) return;
      layoutPopup = { title: el.dataset.title || "배치도", url, image: el.dataset.image };
      render();
      break;
    }
    case "keep-layout":
      break;
    case "close-layout":
      layoutPopup = null;
      render();
      break;
  }
}

function onCompositionStart(e: Event): void {
  const id = (e.target as HTMLElement).id;
  if (id === "search-input" || id === "origin-input" || id === "diary-camp-input") imeComposing = true;
}

function onCompositionEnd(e: Event): void {
  const target = e.target as HTMLInputElement;
  if (target.id !== "search-input" && target.id !== "origin-input" && target.id !== "diary-camp-input") return;
  imeComposing = false;
  if (target.id === "origin-input") {
    originQuery = target.value;
    return;
  }
  if (target.id === "diary-camp-input") {
    diaryCampQuery = target.value;
    window.clearTimeout(diaryCampTimer);
    diaryCampHits = searchDiaryCamps(diaryCampQuery);
    refreshDiaryCampHits();
    return;
  }
  query = target.value;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    if (imeComposing) return;
    if (query.trim().length >= 2) recent = rememberQuery(query);
    refreshSearchList();
  }, 200);
}

function onInput(e: Event): void {
  const target = e.target as HTMLInputElement;
  const composing = imeComposing || Boolean((e as InputEvent).isComposing);
  if (target.id === "origin-input") {
    originQuery = target.value;
    if (locError) locError = null;
    return;
  }
  if (target.id === "diary-camp-input") {
    diaryCampQuery = target.value;
    if (composing) return;
    window.clearTimeout(diaryCampTimer);
    diaryCampTimer = window.setTimeout(() => {
      if (imeComposing) return;
      diaryCampHits = searchDiaryCamps(diaryCampQuery);
      refreshDiaryCampHits();
    }, 180);
    return;
  }
  if (target.id !== "search-input") return;
  query = target.value;
  if (composing) return;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    if (imeComposing) return;
    if (query.trim().length >= 2) recent = rememberQuery(query);
    refreshSearchList();
  }, 200);
}

function onKeydown(e: KeyboardEvent): void {
  // 한글 IME 조합 중 Enter/키는 조합 확정용. 여기서 가로채면 마지막 글자가 중복된다.
  if (e.isComposing || e.keyCode === 229 || imeComposing) return;

  if (e.key === "Escape") {
    if (layoutPopup) {
      layoutPopup = null;
      render();
      return;
    }
    go("");
  }
  if (e.key === "Enter" && (e.target as HTMLElement).id === "origin-input") {
    e.preventDefault();
    originQuery = (e.target as HTMLInputElement).value;
    void searchOrigin();
    return;
  }
  if (e.key === "Enter" && (e.target as HTMLElement).id === "search-input") {
    e.preventDefault();
    query = (e.target as HTMLInputElement).value;
    window.clearTimeout(searchTimer);
    if (query.trim().length >= 2) recent = rememberQuery(query);
    const first = visible()[0];
    if (first) go(`camp/${encodeURIComponent(first.id)}`);
    else render();
    (e.target as HTMLInputElement).blur();
  }
}

function onSubmit(e: Event): void {
  const form = e.target as HTMLFormElement;
  if (!(form instanceof HTMLFormElement)) return;
  const action = form.dataset.action;
  if (action === "create-account") {
    e.preventDefault();
    void submitCreateAccount(form);
    return;
  }
  if (action === "login-account") {
    e.preventDefault();
    void submitLoginAccount(form);
    return;
  }
  if (action === "save-review") {
    e.preventDefault();
    const id = form.dataset.id;
    if (!id) return;
    const data = new FormData(form);
    const rating = Number(data.get("rating"));
    if (!rating) {
      alert("별점을 골라 주세요.");
      return;
    }
    reviews[id] = {
      campId: id,
      rating,
      visitedAt: String(data.get("visitedAt") ?? "") || undefined,
      siteName: String(data.get("siteName") ?? "").trim() || undefined,
      body: String(data.get("body") ?? "").trim(),
      updatedAt: new Date().toISOString(),
    };
    saveReviews(reviews);
    render();
    return;
  }
  if (action === "save-diary") {
    e.preventDefault();
    const campId = form.dataset.id;
    if (!campId) return;
    const camp = camps.find((c) => c.id === campId);
    if (!camp) return;
    const data = new FormData(form);
    const visitedAt = String(data.get("visitedAt") ?? "").trim();
    if (!visitedAt) {
      alert("방문일을 골라 주세요.");
      return;
    }
    const nightsRaw = String(data.get("nights") ?? "").trim();
    const nights = nightsRaw === "" ? undefined : Math.max(0, Math.round(Number(nightsRaw)));
    const ratingRaw = String(data.get("rating") ?? "").trim();
    const rating = ratingRaw ? Math.min(5, Math.max(1, Math.round(Number(ratingRaw)))) : undefined;
    const now = new Date().toISOString();
    const entryId = form.dataset.entry || `diary-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const prev = diary.find((entry) => entry.id === entryId);
    const next: VisitDiaryEntry = {
      id: entryId,
      campId: camp.id,
      campName: camp.name,
      region: camp.region,
      city: camp.city,
      visitedAt,
      nights: nights != null && Number.isFinite(nights) ? nights : undefined,
      siteName: String(data.get("siteName") ?? "").trim() || undefined,
      companions: String(data.get("companions") ?? "").trim() || undefined,
      body: String(data.get("body") ?? "").trim(),
      rating: rating != null && Number.isFinite(rating) ? rating : undefined,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    diary = [next, ...diary.filter((entry) => entry.id !== entryId)];
    saveDiary(diary);
    editingDiaryId = null;
    diaryDraftCampId = null;
    diaryCampQuery = "";
    diaryCampHits = [];
    diaryMonth = visitedAt.slice(0, 7);
    diaryDay = visitedAt;
    if (panel === "lists") listsTab = "diary";
    render();
    return;
  }
  if (action === "add-camp") {
    e.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    if (!name) return;
    const kinds = data.getAll("kinds") as CampKind[];
    const priceMin = Number(data.get("priceMin")) || undefined;
    const priceMax = Number(data.get("priceMax")) || undefined;
    const draft: OverlayDraft = {
      id: slugify(name),
      curated: false,
      name,
      aliases: [],
      region: String(data.get("region") ?? "경기"),
      city: String(data.get("city") ?? ""),
      kinds: kinds.length ? kinds : ["tent"],
      tags: [],
      address: String(data.get("address") ?? ""),
      reservationUrl: String(data.get("reservationUrl") ?? "") || undefined,
      reservationPlatform: String(data.get("reservationPlatform") ?? "") || undefined,
      reservationWindows: String(data.get("reservationRule") ?? "").trim()
        ? [{ label: "예약", rule: String(data.get("reservationRule")) }]
        : [],
      siteTypes:
        priceMin || priceMax
          ? [{ name: "사이트", priceMin, priceMax }]
          : [],
      amenities: [],
      description: String(data.get("description") ?? ""),
      photos: [],
      ratings: {},
      featured: false,
      source: "overlay",
      updatedAt: todayISO(),
    };
    overlay = [...overlay.filter((c) => c.id !== draft.id), draft];
    saveOverlay(overlay);
    camps = mergeCatalog(camps.filter((c) => c.source !== "overlay"), overlay);
    go(`camp/${encodeURIComponent(draft.id)}`);
  }
}

async function submitCreateAccount(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const name = String(data.get("name") ?? "");
  const pin = String(data.get("pin") ?? "").trim();
  const migrate = data.get("migrate") === "on";
  try {
    await createAccount(name, pin || undefined, migrate);
    applyPersonalData();
    accountMode = "home";
    accountError = null;
    listsTab = "favorites";
    go("lists");
  } catch (error) {
    accountError = error instanceof Error ? error.message : "계정을 만들지 못했습니다.";
    render();
  }
}

async function submitLoginAccount(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const id = String(data.get("id") ?? "");
  const pin = String(data.get("pin") ?? "").trim();
  await switchAccount(id, pin);
}

async function switchAccount(id: string, pin?: string): Promise<void> {
  try {
    await loginAccount(id, pin);
    applyPersonalData();
    accountMode = "home";
    accountError = null;
    loginTargetId = null;
    listsTab = "favorites";
    go("lists");
  } catch (error) {
    accountError = error instanceof Error ? error.message : "계정을 열지 못했습니다.";
    accountMode = pin ? "login" : "home";
    loginTargetId = pin ? id : loginTargetId;
    listsTab = "account";
    render();
  }
}

async function reloadMerged(): Promise<void> {
  const file = await loadFileCatalog();
  camps = mergeCatalog(file.camps, overlay);
  render();
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void (async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
      await navigator.serviceWorker.register("./sw.js?v=3");
    })().catch(() => {});
  });
}
