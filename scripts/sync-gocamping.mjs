/**
 * 고캠핑(한국관광공사) 공식 API로 신규 캠핑장을 고릅니다.
 * 캠핏·네이버·캠프픽은 호출하지 않습니다.
 *
 *   GOCAMPING_KEY=키 npm run sync          # 주간: 점수 높은 신규만 (기본 40곳, 경기 우선)
 *   GOCAMPING_KEY=키 npm run sync:all      # 신규를 한도에 달할 때까지
 *
 * 공공데이터포털 "한국관광공사_고캠핑 정보 조회서비스" 일반 인증키를 쓰세요.
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
const MODE = process.argv.includes("--all") ? "all" : "weekly";
const LIMIT = Number(process.env.SYNC_LIMIT || (MODE === "all" ? 200 : 40));
const PREFER_REGION = process.env.SYNC_REGION || "경기";

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

const SEARCH_KEYWORDS = ["가평", "포천", "양평", "연천", "파주", "여주", "용인", "화성", "안성"];

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

function isNew(camp, catalog) {
  if (!camp.name) return false;
  if (catalog.ids.has(camp.id) || catalog.gcIds.has(camp.gocampingId)) return false;
  if (catalog.names.has(compactName(camp.name))) return false;
  return true;
}

function writePack(existingCamps, added) {
  const camps = [...existingCamps, ...added];
  writeFileSync(
    OUT_FILE,
    `${JSON.stringify(
      {
        updatedAt: new Date().toISOString().slice(0, 10),
        note: "고캠핑 공식 API에서 신규만 붙인 팩입니다. GitHub Actions가 매주 인기 후보를 추가합니다.",
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

function summarize(added) {
  const lines = [
    `## 고캠핑 ${MODE === "all" ? "전체" : "주간"} 동기화`,
    "",
    `- 추가 ${added.length}곳 (한도 ${LIMIT})`,
    `- 우선 권역: ${PREFER_REGION}`,
    "",
    ...added.slice(0, 40).map((c) => `- ${c.name} (${c.region} ${c.city})`),
  ];
  const md = `${lines.join("\n")}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
}

const catalog = loadCatalog();
const existingOut = existsSync(OUT_FILE) ? JSON.parse(readFileSync(OUT_FILE, "utf8")).camps ?? [] : [];

const boostedIds = new Set();
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
    if (!seen.has(camp.gocampingId)) seen.set(camp.gocampingId, { item, camp });
  }
  console.log(`basedList page ${page} (${seen.size}/${total})`);
  if (page * 100 >= total) break;
  page += 1;
  await sleep(120);
}

const ranked = [...seen.values()]
  .map(({ camp }) => camp)
  .filter((camp) => isNew(camp, catalog))
  .sort((a, b) => {
    if (PREFER_REGION !== "all") {
      const ar = Number(a.region === PREFER_REGION);
      const br = Number(b.region === PREFER_REGION);
      if (ar !== br) return br - ar;
    }
    return (b._score ?? 0) - (a._score ?? 0);
  });

const added = ranked.slice(0, LIMIT).map(({ _score, ...camp }) => camp);
for (const camp of added) {
  try {
    const { items } = await getJson("imageList", { contentId: camp.gocampingId, numOfRows: "20" });
    const urls = items.map((item) => item.imageUrl).filter(Boolean);
    camp.photos = [...new Set([...(camp.photos ?? []), ...urls])].slice(0, 12);
  } catch (error) {
    console.warn(`imageList ${camp.name}:`, error instanceof Error ? error.message : error);
  }
  await sleep(120);
}
writePack(existingOut, added);
summarize(added);
console.log(`끝. packs/gocamping.json 에 ${added.length}곳 추가.`);
