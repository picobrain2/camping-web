import { loadFileCatalog, mergeCatalog, normalizeCamp, overlayToJson, parseCampList } from "./lib/catalog";
import { wonRange, esc, kindLabels, mapLink, scoreText, slugify, todayISO } from "./lib/format";
import { driveLabel, drivingTable, estimateDrives, haversineKm, naverCarDirections, type DriveETA, type GeoPos } from "./lib/geo";
import { officialLayoutImage, placeLinks } from "./lib/places";
import { displayScore, featuredCamps, filterCamps, priceRange, reviewedCamps } from "./lib/search";
import {
  loadOverlay,
  loadRecent,
  loadReviews,
  rememberQuery,
  saveOverlay,
  saveReviews,
} from "./lib/storage";
import {
  Camp,
  CampKind,
  KIND_LABEL,
  OverlayDraft,
  PersonalReview,
  REGION_OPTIONS,
  LOCATION_TAGS,
  FACILITY_TAGS,
} from "./types";

let camps: Camp[] = [];
let reviews: Record<string, PersonalReview> = loadReviews();
let overlay: OverlayDraft[] = loadOverlay();
let recent: string[] = loadRecent();
let catalogNote = "";
let catalogUpdated = "";
let loadError: string | null = null;

let query = "";
let regions: string[] = [];
let kind = "all";
let tags: string[] = [];
let sort: "recommend" | "rating" | "distance" = "recommend";
let selectedId: string | null = null;
let panel: "none" | "add" | "data" = "none";
let searchTimer = 0;
let layoutPopup: { title: string; url: string; image?: string } | null = null;
let myPos: GeoPos | null = null;
let locError: string | null = null;
let locLoading = false;
let driveById: Record<string, DriveETA> = {};
let driveSeq = 0;

let root: HTMLElement;

export async function boot(): Promise<void> {
  root = document.getElementById("app")!;
  root.innerHTML = `<div class="boot">캠핑장 파일 DB를 불러오는 중…</div>`;
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

function selected(): Camp | undefined {
  return camps.find((c) => c.id === selectedId);
}

function visible(): Camp[] {
  return filterCamps(camps, query, regions, kind, tags, reviews, sort, driveById);
}

let skipDriveSchedule = false;
function render(): void {
  const keep = preserveSearchCaret();
  root.innerHTML = `
    <div class="shell ${selectedId || panel !== "none" ? "has-detail" : ""}">
      ${renderSearchPane()}
      ${renderDetailPane()}
    </div>
    ${layoutPopup ? renderLayoutModal() : ""}`;
  bindOnce();
  restoreSearchCaret(keep);
  if (!skipDriveSchedule) scheduleDriveRefresh();
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
  return filterCamps(camps, query, regions, kind, tags, reviews, "recommend", {}).filter(
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
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("keydown", onKeydown);
}

function preserveSearchCaret(): { value: string; start: number | null } | null {
  const input = document.getElementById("search-input") as HTMLInputElement | null;
  if (!input || document.activeElement !== input) return null;
  return { value: input.value, start: input.selectionStart };
}

function restoreSearchCaret(keep: { value: string; start: number | null } | null): void {
  if (!keep) return;
  const input = document.getElementById("search-input") as HTMLInputElement | null;
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
          <button type="button" class="btn-ghost btn-sm" data-action="open-add">추가</button>
          <button type="button" class="btn-ghost btn-sm" data-action="open-data">데이터</button>
        </div>
      </header>
      <div class="search-box">
        <input id="search-input" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" placeholder="캠핑장 · 지역 · 위생 · 전기" value="${esc(query)}" />
        <button type="button" class="btn-ghost btn-sm loc-btn ${myPos ? "active" : ""}" data-action="pin-location">${locLoading ? "위치…" : myPos ? "위치 켜짐" : "내 위치"}</button>
      </div>
      ${locError ? `<p class="loc-msg">${esc(locError)}</p>` : ""}
      ${myPos ? `<p class="loc-msg">내 위치에서 차로 가는 시간입니다. 네이버지도 길찾기로 확인할 수 있습니다. <button type="button" class="text-btn" data-action="clear-location">위치 끄기</button></p>` : ""}
      ${segment("region", regions, [{ value: "all", label: "전국" }, ...REGION_OPTIONS.map((r) => ({ value: r, label: r }))], true)}
      ${segment("kind", kind, [{ value: "all", label: "전체" }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))])}
      ${segment("tag", tags, [{ value: "all", label: "조건" }, { value: "reviewed", label: "내 리뷰" }, ...LOCATION_TAGS.map((t) => ({ value: t, label: t }))], true)}
      ${segment("tag", tags, FACILITY_TAGS.map((t) => ({ value: t, label: t })), true)}
      ${segment("sort", sort, [{ value: "recommend", label: "추천" }, { value: "rating", label: "평점순" }, ...(myPos ? [{ value: "distance", label: "가까운순" }] : [])])}
      <div class="list-wrap">
        ${renderList()}
      </div>
    </aside>`;
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
  const featured = featuredCamps(camps, reviews);
  const mine = reviewedCamps(camps, reviews);
  return `
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
  return `
    <li>
      <button type="button" class="result-row ${selectedId === camp.id ? "active" : ""}" data-action="select" data-id="${esc(camp.id)}">
        <div class="thumb ${camp.photos[0] ? "has-photo" : ""}" data-region="${esc(camp.region)}">${
          camp.photos[0] ? `<img src="${esc(camp.photos[0])}" alt="" />` : esc(camp.name.slice(0, 1))
        }</div>
        <div class="result-meta">
          <div class="result-title">
            <strong>${esc(camp.name)}</strong>
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
  const camp = selected();
  if (!camp) {
    return `
      <main class="pane-detail">
        <div class="empty hero-empty">
          <strong>캠핑장 선택</strong>
          <p>왼쪽에서 캠핑장을 고르면 평점, 예약 사이트와 일시, 가격을 보여 줍니다. 다녀온 곳은 나만의 리뷰를 이 기기에 저장할 수 있습니다.</p>
        </div>
      </main>`;
  }
  return `<main class="pane-detail">${renderDetail(camp)}</main>`;
}

function renderDetail(camp: Camp): string {
  const mine = reviews[camp.id];
  const map = mapLink(camp);
  const cover = camp.photos[0];
  return `
    <header class="mobile-bar">
      <button type="button" class="back-btn" data-action="clear-select">목록</button>
      <strong>${esc(camp.name)}</strong>
    </header>
    <div class="detail-scroll">
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
            ${camp.source === "overlay" ? `<span class="chip static mine">내 추가</span>` : ""}
          </div>
          <p class="lead">${esc(camp.description)}</p>
          <dl class="kv">
            ${camp.phone ? `<div><dt>전화</dt><dd><a href="tel:${esc(camp.phone.replace(/\s+/g, ""))}">${esc(camp.phone)}</a></dd></div>` : ""}
            ${camp.mannersTime ? `<div><dt>매너타임</dt><dd>${esc(camp.mannersTime)}</dd></div>` : ""}
            <div><dt>편의</dt><dd>${esc(camp.amenities.join(" · ") || "정보 없음")}</dd></div>
          </dl>
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
      ${reviewEditor(camp, mine)}

      <div class="link-row">
        ${camp.reservationUrl ? `<a class="btn" href="${esc(camp.reservationUrl)}" target="_blank" rel="noreferrer">예약하기</a>` : ""}
        ${camp.homepage ? `<a class="btn ghost" href="${esc(camp.homepage)}" target="_blank" rel="noreferrer">홈페이지</a>` : ""}
        ${myPos ? `<a class="btn ghost" href="${esc(naverCarDirections(myPos, camp))}" target="_blank" rel="noreferrer">네이버 자동차</a>` : ""}
        ${map ? `<a class="btn ghost" href="${esc(map)}" target="_blank" rel="noreferrer">카카오맵</a>` : ""}
      </div>
      <p class="attrib">평점·빈자리는 네이버지도·캠핏·캠핑톡에서 확인하고, 목록은 파일 DB에 둡니다. 내 리뷰는 이 브라우저에만 저장됩니다.</p>
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
      <p><a href="${esc(naver)}" target="_blank" rel="noreferrer">${myPos ? "네이버지도 자동차 길찾기" : "네이버지도에서 찾기"}</a></p>
    </section>`;
}

function photosBlock(camp: Camp): string {
  const photos = [...new Set((camp.photos ?? []).filter(Boolean))];
  const naver = `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(`${camp.name} 캠핑장`)}`;
  if (!photos.length) {
    return `
    <section class="block">
      <h3>사진</h3>
      <p class="muted">고캠핑에 등록된 제공 사진이 없습니다. <a href="${esc(naver)}" target="_blank" rel="noreferrer">네이버에서 후기 사진 보기</a></p>
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
      <p class="muted">고캠핑에 올라온 제공 사진입니다.</p>
      <div class="photo-grid">${tiles}</div>
      <p class="muted"><a href="${esc(naver)}" target="_blank" rel="noreferrer">네이버에서 후기 사진 더 보기</a></p>
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
      <p class="muted"><a href="${esc(naver)}" target="_blank" rel="noreferrer">네이버지도에서 실시간 평점 보기</a></p>
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
        ? `<a class="quote-card" href="${esc(quote.url)}" target="_blank" rel="noreferrer">${inner}</a>`
        : `<article class="quote-card">${inner}</article>`
    );
  }
  if (!cards.length) {
    return `
    <section class="block">
      <h3>리뷰</h3>
      <p class="muted">저장된 후기가 아직 없습니다. <a href="${esc(naver)}" target="_blank" rel="noreferrer">네이버 후기</a>에서 최근 글을 볼 수 있습니다.</p>
    </section>`;
  }
  return `
    <section class="block">
      <h3>리뷰</h3>
      <div class="quote-list">${cards.join("")}</div>
      <p class="muted"><a href="${esc(naver)}" target="_blank" rel="noreferrer">네이버에서 후기 더 보기</a></p>
    </section>`;
}

function appsBlock(camp: Camp): string {
  const cards = placeLinks(camp)
    .map(
      (link) => `
      <a class="app-card" href="${esc(link.url)}" target="_blank" rel="noreferrer">
        <strong>${esc(link.name)}</strong>
        <span>${esc(link.hint)}</span>
      </a>`
    )
    .join("");
  return `
    <section class="block">
      <h3>다른 앱에서 보기</h3>
      <p class="muted">캠핏·캠핑톡·네이버지도의 예약 빈자리와 후기를 그대로 엽니다.</p>
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
          ? `<a href="${esc(camp.reservationUrl)}" target="_blank" rel="noreferrer">${esc(camp.reservationPlatform || camp.reservationUrl)}</a>`
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
        <a href="${esc(image)}" target="_blank" rel="noreferrer">원본 이미지</a>
        ${site ? ` · <a href="${esc(site)}" target="_blank" rel="noreferrer">캠핑장 사이트</a>` : ""}
      </p>
    </section>`;
  }
  if (site) {
    return `
    <section class="block">
      <h3>배치도</h3>
      <p class="muted">등록된 공식 도면이 없어 캠핑장 사이트에서 확인하세요.</p>
      <div class="layout-actions">
        <a class="btn" href="${esc(site)}" target="_blank" rel="noreferrer">캠핑장 사이트에서 보기</a>
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
        <p class="muted"><a href="${esc(src)}" target="_blank" rel="noreferrer">이미지 새 창에서 열기</a></p>
      </div>
    </div>`;
}

function reviewEditor(camp: Camp, mine?: PersonalReview): string {
  return `
    <section class="block review-block">
      <h3>나만의 리뷰</h3>
      <p class="muted">이 브라우저에만 저장됩니다. 서버로 올라가지 않습니다.</p>
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

function toggleFilter(list: string[], value: string): string[] {
  if (value === "all") return [];
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function pinMyLocation(): void {
  if (!navigator.geolocation) {
    locError = "이 브라우저에서는 위치를 쓸 수 없습니다.";
    render();
    return;
  }
  locLoading = true;
  locError = null;
  render();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      locLoading = false;
      locError = null;
      sort = "distance";
      render();
    },
    (err) => {
      locLoading = false;
      locError =
        err.code === err.PERMISSION_DENIED
          ? "위치 권한이 필요합니다. 브라우저 주소창에서 허용해 주세요."
          : "위치를 가져오지 못했습니다.";
      render();
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
  );
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
      layoutPopup = null;
      go("");
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
    case "clear-location":
      myPos = null;
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

function onInput(e: Event): void {
  const target = e.target as HTMLInputElement;
  if (target.id !== "search-input") return;
  query = target.value;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    if (query.trim().length >= 2) recent = rememberQuery(query);
    render();
  }, 280);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    if (layoutPopup) {
      layoutPopup = null;
      render();
      return;
    }
    go("");
  }
  if (e.key === "Enter" && (e.target as HTMLElement).id === "search-input") {
    e.preventDefault();
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

async function reloadMerged(): Promise<void> {
  const file = await loadFileCatalog();
  camps = mergeCatalog(file.camps, overlay);
  render();
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // offline cache is optional
    });
  });
}
