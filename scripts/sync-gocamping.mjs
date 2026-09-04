/**
 * 고캠핑(한국관광공사) 목록을 받아 public/data/camps.json 에 신규만 붙입니다.
 *
 *   GOCAMPING_KEY=발급키 npm run sync
 *
 * curated=true 이거나 이미 있는 id/gocampingId 는 가격·배치도·예약규칙을 덮어쓰지 않습니다.
 * 공공데이터포털에서 "한국관광공사_고캠핑 정보 조회서비스" 일반 인증키를 발급받으세요.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "public/data/camps.json");
const BASE = "https://apis.data.go.kr/B551011/GoCamping/basedList";
const KEY = process.env.GOCAMPING_KEY;

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
  if (blob.includes("강") || blob.includes("도심")) tags.push("도심");
  if (item.animalCmgCl && item.animalCmgCl !== "불가능") tags.push("반려견");
  if (item.facltDivNm?.includes("국립공원")) tags.push("국립공원");
  if (item.facltDivNm?.includes("휴양림")) tags.push("휴양림");
  return [...new Set(tags)];
}

function siteTypesFrom(item) {
  const rows = [];
  const n = (v) => Number(v) || 0;
  if (n(item.autoSiteCo)) rows.push({ name: "자동차야영", count: n(item.autoSiteCo) });
  if (n(item.glampSiteCo)) rows.push({ name: "글램핑", count: n(item.glampSiteCo) });
  if (n(item.caravSiteCo) || n(item.indvdlCaravSiteCo)) {
    rows.push({ name: "카라반", count: n(item.caravSiteCo) + n(item.indvdlCaravSiteCo) });
  }
  if (n(item.gnrlSiteCo)) rows.push({ name: "일반야영", count: n(item.gnrlSiteCo) });
  return rows;
}

function layoutFrom(sites) {
  const zones = [];
  let x = 0;
  for (const site of sites.slice(0, 4)) {
    const kind = site.name.includes("글램")
      ? "glamping"
      : site.name.includes("카라")
        ? "caravan"
        : site.name.includes("자동차")
          ? "auto"
          : "tent";
    zones.push({ id: site.name, label: site.name, x, y: 0, w: 3, h: 4, kind });
    x += 3;
  }
  zones.push({ id: "wc", label: "편의시설", x: 0, y: 4, w: Math.max(x, 6), h: 2, kind: "amenity" });
  return { cols: Math.max(x, 8), rows: 6, zones };
}

function toCamp(item) {
  const id = `gc-${item.contentId}`;
  const sites = siteTypesFrom(item);
  const amenities = String(item.sbrsCl ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id,
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
    phone: item.tel ?? "",
    homepage: item.homepage ?? "",
    reservationUrl: item.resveUrl || item.homepage || "",
    reservationPlatform: item.resveCl || "문의",
    reservationWindows: item.operDeCl
      ? [{ label: "운영", rule: String(item.operDeCl) }]
      : [],
    siteTypes: sites,
    amenities,
    description: String(item.lineIntro || item.intro || "").replace(/<[^>]+>/g, "").slice(0, 400),
    photos: item.firstImageUrl ? [item.firstImageUrl] : [],
    ratings: {},
    featured: false,
    source: "gocamping",
    updatedAt: new Date().toISOString().slice(0, 10),
    layout: sites.length ? layoutFrom(sites) : undefined,
  };
}

async function fetchPage(pageNo) {
  const url = new URL(BASE);
  url.searchParams.set("serviceKey", KEY);
  url.searchParams.set("MobileOS", "ETC");
  url.searchParams.set("MobileApp", "EodiCamp");
  url.searchParams.set("_type", "json");
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "100");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`고캠핑 HTTP ${res.status}`);
  const json = await res.json();
  const body = json?.response?.body;
  if (!body) throw new Error(JSON.stringify(json?.response?.header ?? json).slice(0, 300));
  const items = body.items?.item ?? [];
  return { items: Array.isArray(items) ? items : [items], total: Number(body.totalCount ?? 0) };
}

const catalog = JSON.parse(readFileSync(FILE, "utf8"));
const existingIds = new Set(catalog.camps.map((c) => c.id));
const existingGc = new Set(catalog.camps.map((c) => c.gocampingId).filter(Boolean));

let page = 1;
let added = 0;
let seen = 0;

while (true) {
  const { items, total } = await fetchPage(page);
  if (!items.length) break;
  for (const item of items) {
    seen += 1;
    const camp = toCamp(item);
    if (!camp.name) continue;
    if (existingIds.has(camp.id) || existingGc.has(camp.gocampingId)) continue;
    catalog.camps.push(camp);
    existingIds.add(camp.id);
    existingGc.add(camp.gocampingId);
    added += 1;
  }
  console.log(`page ${page}: +${added} so far (${seen}/${total})`);
  if (seen >= total) break;
  page += 1;
}

catalog.updatedAt = new Date().toISOString().slice(0, 10);
writeFileSync(FILE, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`끝. 신규 ${added}곳 추가. 파일: public/data/camps.json`);
