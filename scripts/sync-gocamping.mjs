/**
 * 고캠핑(한국관광공사) 공식 API로 캠핑장을 맞춥니다.
 * 캠핏·네이버·캠프픽은 호출하지 않습니다.
 *
 *   GOCAMPING_KEY=키 npm run sync          # 주간: 전체 정합(수정·폐업) + 인기 신규 한도
 *   GOCAMPING_KEY=키 npm run sync:all      # 신규 한도 확대
 *   GOCAMPING_KEY=키 npm run sync:full     # 고캠핑 전체 업서트 1회 (상세 사진 생략)
 *
 * - 신규: 팩에 없는 contentId 추가
 * - 수정: 주소·전화·사진·소개 등 API 변경 반영 (curated 요금·예약규칙은 유지)
 * - 폐업: basedList에 없으면 closed 표시 → 업로드 시 Firestore에서 삭제
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "public/data");
const INDEX_FILE = join(DATA, "index.json");
const OUT_FILE = join(DATA, "packs/gocamping.json");
const BASE = "https://apis.data.go.kr/B551011/GoCamping";
const KEY = process.env.GOCAMPING_KEY;
const MODE = process.argv.includes("--full") ? "full" : process.argv.includes("--all") ? "all" : "weekly";
const LIMIT = Number(
  process.env.SYNC_LIMIT || (MODE === "full" ? 99999 : MODE === "all" ? 200 : 40)
);
const PREFER_REGION = process.env.SYNC_REGION || (MODE === "full" ? "all" : "경기");
const FETCH_IMAGES = process.env.SYNC_IMAGES === "1" || (MODE !== "full" && process.env.SYNC_IMAGES !== "0");

if (!KEY) {
  console.error("GOCAMPING_KEY 환경변수가 필요합니다. 공공데이터포털 고캠핑 인증키를 넣어 주세요.");
  process.exit(1);
}

const REGION_FROM_DO = {
  서울: "서울",
  서울특별시: "서울",
  경기: "경기",
  경기도: "경기",
  인천: "경기",
  인천광역시: "경기",
  강원: "강원",
  강원특별자치도: "강원",
  강원도: "강원",
  충북: "충청",
  충청북도: "충청",
  충남: "충청",
  충청남도: "충청",
  대전: "충청",
  대전광역시: "충청",
  세종: "충청",
  세종특별자치시: "충청",
  전북: "전라",
  전북특별자치도: "전라",
  전라북도: "전라",
  전남: "전라",
  전라남도: "전라",
  광주: "전라",
  광주광역시: "전라",
  경북: "경상",
  경상북도: "경상",
  경남: "경상",
  경상남도: "경상",
  대구: "경상",
  대구광역시: "경상",
  부산: "경상",
  부산광역시: "경상",
  울산: "경상",
  울산광역시: "경상",
  제주: "제주",
  제주특별자치도: "제주",
};

const SEARCH_KEYWORDS = ["가평", "포천", "양평", "연천", "파주", "김포", "여주", "용인", "화성", "안성", "평창", "홍천", "춘천"];

function compactName(text = "") {
  return text
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/캠핑장|오토캠핑장|야영장|글램핑|카라반/g, "");
}

function kindsFrom(induty = "") {
  const kinds = [];
  if (induty.includes("자동차")) kinds.push("auto");
  if (induty.includes("글램핑")) kinds.push("glamping");
  if (induty.includes("카라반")) kinds.push("caravan");
  if (induty.includes("일반") || kinds.length === 0) kinds.push("tent");
  return [...new Set(kinds)];
}

function regionOf(item) {
  return REGION_FROM_DO[item.doNm] ?? REGION_FROM_DO[item.addr1?.split(" ")[0]] ?? "경기";
}

function tagsFrom(item) {
  const tags = [];
  const blob = [item.lctCl, item.themaEnvrnCl, item.facltDivNm].join(",");
  if (blob.includes("해변") || blob.includes("바다")) tags.push("바다");
  if (blob.includes("계곡")) tags.push("계곡");
  if (blob.includes("산") || blob.includes("숲")) tags.push("산");
  if (blob.includes("호수")) tags.push("호수");
  if (blob.includes("강") && !tags.includes("호수")) tags.push("호수");
  if (item.animalCmgCl && item.animalCmgCl !== "불가능") tags.push("반려견");
  if (item.facltDivNm?.includes("국립공원")) tags.push("국립공원");
  if (item.facltDivNm?.includes("휴양림")) tags.push("휴양림");
  if (String(item.sbrsCl ?? "").includes("수영")) tags.push("물놀이");
  return [...new Set(tags)];
}

function n(v) {
  return Number(v) || 0;
}

function siteTypesFrom(item) {
  const rows = [];
  if (n(item.autoSiteCo)) rows.push({ name: "자동차야영", count: n(item.autoSiteCo) });
  if (n(item.glampSiteCo)) rows.push({ name: "글램핑", count: n(item.glampSiteCo) });
  if (n(item.caravSiteCo) || n(item.indvdlCaravSiteCo)) {
    rows.push({ name: "카라반", count: n(item.caravSiteCo) + n(item.indvdlCaravSiteCo) });
  }
  if (n(item.gnrlSiteCo)) rows.push({ name: "일반야영", count: n(item.gnrlSiteCo) });
  return rows;
}

function siteCount(item) {
  return n(item.autoSiteCo) + n(item.glampSiteCo) + n(item.caravSiteCo) + n(item.indvdlCaravSiteCo) + n(item.gnrlSiteCo);
}

function toCamp(item) {
  const sites = siteTypesFrom(item);
  const homepage = String(item.homepage ?? "").trim();
  const amenities = String(item.sbrsCl ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id: `gc-${item.contentId}`,
    curated: false,
    gocampingId: String(item.contentId),
    name: String(item.facltNm ?? "").trim(),
    aliases: [],
    region: regionOf(item),
    city: item.sigunguNm ?? "",
    kinds: kindsFrom(item.induty),
    tags: tagsFrom(item),
    address: item.addr1 ?? "",
    lat: item.mapY ? Number(item.mapY) : undefined,
    lng: item.mapX ? Number(item.mapX) : undefined,
    phone: item.tel || undefined,
    homepage: homepage || undefined,
    reservationUrl: item.resveUrl || homepage || undefined,
    reservationPlatform: item.resveCl || "고캠핑",
    reservationWindows: item.operDeCl ? [{ label: "운영", rule: String(item.operDeCl) }] : [],
    siteTypes: sites,
    amenities,
    description: String(item.lineIntro || item.intro || "")
      .replace(/<[^>]+>/g, "")
      .slice(0, 400),
    photos: item.firstImageUrl ? [item.firstImageUrl] : [],
    ratings: {},
    featured: false,
    source: "gocamping",
    updatedAt: new Date().toISOString().slice(0, 10),
  };
}

function popularity(item, camp, boostedIds) {
  let score = 0;
  if (camp.region === PREFER_REGION) score += 100;
  if (boostedIds.has(camp.gocampingId)) score += 40;
  if (camp.photos.length) score += 25;
  if (camp.homepage) score += 20;
  if (camp.phone) score += 5;
  score += Math.min(siteCount(item), 80);
  if (camp.tags.includes("계곡") || camp.tags.includes("바다") || camp.tags.includes("물놀이")) score += 8;
  if (camp.kinds.includes("glamping")) score += 4;
  return score;
}

function keyParam() {
  return KEY.includes("%") ? KEY : encodeURIComponent(KEY);
}

async function getJson(path, extra = {}) {
  const params = new URLSearchParams({
    MobileOS: "ETC",
    MobileApp: "EodiCamp",
    _type: "json",
    numOfRows: extra.numOfRows ?? "100",
    pageNo: String(extra.pageNo ?? 1),
  });
  if (extra.keyword) params.set("keyword", extra.keyword);
  if (extra.contentId) params.set("contentId", String(extra.contentId));
  const url = `${BASE}/${path}?serviceKey=${keyParam()}&${params.toString()}`;
  const res = await fetch(url);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error(`고캠핑이 XML을 반환했습니다. 인증키·일일 한도를 확인하세요. (${path})`);
  }
  const json = JSON.parse(text);
  const header = json?.response?.header;
  if (header && header.resultCode && header.resultCode !== "0000" && header.resultCode !== "00") {
    throw new Error(`고캠핑 ${header.resultCode}: ${header.resultMsg ?? "오류"}`);
  }
  const body = json?.response?.body;
  if (!body) throw new Error(`고캠핑 응답 형식 오류: ${text.slice(0, 200)}`);
  const raw = body.items?.item ?? [];
  return { items: Array.isArray(raw) ? raw : raw ? [raw] : [], total: Number(body.totalCount ?? 0) };
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

function loadCatalog() {
  const index = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
  const ids = new Set();
  const gcIds = new Set();
  const names = new Set();
  for (const pack of index.packs) {
    const file = join(DATA, pack);
    if (!existsSync(file)) continue;
    const payload = JSON.parse(readFileSync(file, "utf8"));
    for (const camp of payload.camps ?? []) {
      if (camp.id) ids.add(camp.id);
      if (camp.gocampingId) gcIds.add(String(camp.gocampingId));
      if (camp.name) names.add(compactName(camp.name));
      for (const alias of camp.aliases ?? []) names.add(compactName(alias));
    }
  }
  return { index, ids, gcIds, names };
}

function isNewAgainstCatalog(camp, catalog, packGcIds) {
  if (!camp.name) return false;
  // 같은 고캠핑 id는 팩 안에서 업서트하므로 신규로 보지 않음
  if (packGcIds.has(camp.gocampingId)) return false;
  if (catalog.ids.has(camp.id) || catalog.gcIds.has(camp.gocampingId)) return false;
  if (catalog.names.has(compactName(camp.name))) return false;
  return true;
}

function mergeCamp(existing, incoming) {
  if (!existing) {
    return { ...incoming, closed: false, closedAt: undefined };
  }
  if (existing.curated) {
    return {
      ...incoming,
      id: existing.id,
      curated: true,
      aliases: [...new Set([...(existing.aliases ?? []), ...(incoming.aliases ?? [])])],
      reservationWindows:
        existing.reservationWindows?.length > 0 ? existing.reservationWindows : incoming.reservationWindows,
      siteTypes:
        existing.siteTypes?.some((s) => s.priceMin != null || s.priceMax != null) ? existing.siteTypes : incoming.siteTypes,
      description:
        (existing.description?.length ?? 0) > (incoming.description?.length ?? 0)
          ? existing.description
          : incoming.description,
      photos: incoming.photos?.length ? incoming.photos : existing.photos ?? [],
      homepage: existing.homepage || incoming.homepage,
      reservationUrl: existing.reservationUrl || incoming.reservationUrl,
      reservationPlatform: existing.reservationPlatform || incoming.reservationPlatform,
      phone: incoming.phone || existing.phone,
      featured: Boolean(existing.featured || incoming.featured),
      ratings: Object.keys(existing.ratings ?? {}).length ? existing.ratings : incoming.ratings,
      camfitUrl: existing.camfitUrl,
      campingtalkUrl: existing.campingtalkUrl,
      mannersTime: existing.mannersTime,
      quotes: existing.quotes,
      layoutImage: existing.layoutImage,
      layoutUrl: existing.layoutUrl,
      closed: false,
      closedAt: undefined,
      source: existing.source || incoming.source,
      updatedAt: incoming.updatedAt,
    };
  }
  return {
    ...existing,
    ...incoming,
    aliases: [...new Set([...(existing.aliases ?? []), ...(incoming.aliases ?? [])])],
    photos: incoming.photos?.length ? incoming.photos : existing.photos ?? [],
    closed: false,
    closedAt: undefined,
    updatedAt: incoming.updatedAt,
  };
}

function writePack(camps) {
  writeFileSync(
    OUT_FILE,
    `${JSON.stringify(
      {
        updatedAt: new Date().toISOString().slice(0, 10),
        note: "고캠핑 basedList 업서트 팩. 신규·수정 반영, API에서 사라진 곳은 closed 표시. curated 요금·예약규칙은 유지.",
        camps,
      },
      null,
      2
    )}\n`
  );
  const index = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
  if (!index.packs.includes("packs/gocamping.json")) {
    index.packs.push("packs/gocamping.json");
  }
  index.updatedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`);
}

function summarize({ added, updated, closed, reopened }) {
  const label = MODE === "full" ? "전체 정합" : MODE === "all" ? "확장" : "주간 정합";
  const lines = [
    `## 고캠핑 ${label}`,
    "",
    `- 신규 ${added.length}곳`,
    `- 수정 ${updated.length}곳`,
    `- 폐업/목록제외 ${closed.length}곳`,
    `- 재오픈 ${reopened.length}곳`,
    `- 상세 사진: ${FETCH_IMAGES ? "imageList(신규)" : "basedList firstImage만"}`,
    "",
    ...added.slice(0, 20).map((c) => `- + ${c.name} (${c.region} ${c.city})`),
    ...closed.slice(0, 20).map((c) => `- × ${c.name} (${c.region} ${c.city})`),
  ];
  const md = `${lines.join("\n")}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
}

function campFingerprint(camp) {
  return JSON.stringify({
    name: camp.name,
    city: camp.city,
    address: camp.address,
    phone: camp.phone ?? "",
    homepage: camp.homepage ?? "",
    reservationUrl: camp.reservationUrl ?? "",
    lat: camp.lat ?? null,
    lng: camp.lng ?? null,
    kinds: camp.kinds,
    tags: camp.tags,
    amenities: camp.amenities,
    description: camp.description,
    photos: camp.photos?.[0] ?? "",
    closed: Boolean(camp.closed),
  });
}

const catalog = loadCatalog();
const existingOut = existsSync(OUT_FILE) ? JSON.parse(readFileSync(OUT_FILE, "utf8")).camps ?? [] : [];
const byGcId = new Map(existingOut.filter((c) => c.gocampingId).map((c) => [String(c.gocampingId), c]));
const packGcIds = new Set(byGcId.keys());

const boostedIds = new Set();
if (MODE !== "full") {
  for (const keyword of SEARCH_KEYWORDS) {
    try {
      const { items } = await getJson("searchList", { pageNo: 1, numOfRows: "50", keyword });
      for (const item of items) if (item.contentId) boostedIds.add(String(item.contentId));
      console.log(`search ${keyword}: ${items.length}`);
      await sleep(150);
    } catch (error) {
      console.warn(`searchList ${keyword} 건너뜀:`, error instanceof Error ? error.message : error);
    }
  }
} else {
  console.log("full 모드: 키워드 부스트 생략, basedList 전체 스캔 + 업서트/폐업");
}

const seen = new Map();
let page = 1;
let total = Infinity;
while (true) {
  const { items, total: nextTotal } = await getJson("basedList", { pageNo: page, numOfRows: "100" });
  total = nextTotal || total;
  if (!items.length) break;
  for (const item of items) {
    const camp = toCamp(item);
    camp._score = popularity(item, camp, boostedIds);
    if (!seen.has(camp.gocampingId)) seen.set(camp.gocampingId, camp);
  }
  console.log(`basedList page ${page} (${seen.size}/${total})`);
  if (page * 100 >= total) break;
  page += 1;
  await sleep(MODE === "full" ? 80 : 100);
}

const added = [];
const updated = [];
const reopened = [];
const mergedById = new Map(existingOut.map((c) => [c.id, { ...c }]));

// 고캠핑에 있는 것 → 업서트 (이름만 다른 팩에 있으면 스킵해 중복 방지)
let skippedNamed = 0;
for (const incoming of seen.values()) {
  const existing = byGcId.get(incoming.gocampingId);
  if (!existing && !isNewAgainstCatalog(incoming, catalog, packGcIds)) {
    // 다른 팩에 같은 이름/id가 있으면 gocamping 팩에 중복 생성하지 않음
    skippedNamed += 1;
    continue;
  }
  if (!existing && MODE !== "full" && MODE !== "all") {
    // weekly: 신규는 점수순 한도 — 일단 후보로 모은 뒤 아래에서 자름
  }
  const before = existing ? campFingerprint(existing) : null;
  const next = mergeCamp(existing, incoming);
  delete next._score;
  if (!existing) {
    added.push(next);
  } else {
    if (existing.closed) reopened.push(next);
    if (before !== campFingerprint(next)) updated.push(next);
  }
  mergedById.set(next.id, next);
}

// weekly 신규 한도 (full/all은 전부)
let newCamps = added;
if (MODE === "weekly") {
  newCamps = [...added]
    .sort((a, b) => {
      if (PREFER_REGION !== "all") {
        const ar = Number(a.region === PREFER_REGION);
        const br = Number(b.region === PREFER_REGION);
        if (ar !== br) return br - ar;
      }
      const sa = seen.get(a.gocampingId)?._score ?? 0;
      const sb = seen.get(b.gocampingId)?._score ?? 0;
      return sb - sa;
    })
    .slice(0, LIMIT);
  const keepNew = new Set(newCamps.map((c) => c.id));
  for (const camp of added) {
    if (!keepNew.has(camp.id)) mergedById.delete(camp.id);
  }
}

if (FETCH_IMAGES) {
  for (const camp of newCamps) {
    try {
      const { items } = await getJson("imageList", { contentId: camp.gocampingId, numOfRows: "20" });
      const urls = items.map((item) => item.imageUrl).filter(Boolean);
      camp.photos = [...new Set([...(camp.photos ?? []), ...urls])].slice(0, 12);
      mergedById.set(camp.id, camp);
    } catch (error) {
      console.warn(`imageList ${camp.name}:`, error instanceof Error ? error.message : error);
    }
    await sleep(120);
  }
}

// API에 없는 기존 고캠핑 문서 → 폐업/제외
const closed = [];
const today = new Date().toISOString().slice(0, 10);
for (const [gcId, camp] of byGcId) {
  if (seen.has(gcId)) continue;
  if (camp.closed) {
    mergedById.set(camp.id, camp);
    continue;
  }
  const marked = { ...camp, closed: true, closedAt: today, updatedAt: today };
  closed.push(marked);
  mergedById.set(camp.id, marked);
}

const camps = [...mergedById.values()].sort((a, b) =>
  String(a.gocampingId || a.id).localeCompare(String(b.gocampingId || b.id), "en", { numeric: true })
);
writePack(camps);
summarize({ added: newCamps, updated, closed, reopened });
console.log(
  `끝. gocamping.json ${camps.length}곳 (신규 ${newCamps.length}, 수정 ${updated.length}, 폐업 ${closed.length}, 이름중복스킵 ${skippedNamed})`
);
