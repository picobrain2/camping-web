/**
 * 기존 캠핑장에 고캠핑(한국관광공사) 공식 API의 homepage / 예약 URL / 전화를 채웁니다.
 * 새 캠핑장을 추가하지 않고, 이름(·별칭)이 맞는 항목만 보강합니다.
 *
 *   GOCAMPING_KEY=키 npm run enrich:homepages
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "public/data");
const INDEX_FILE = join(DATA, "index.json");
const BASE = "https://apis.data.go.kr/B551011/GoCamping";
const KEY = process.env.GOCAMPING_KEY;

if (!KEY) {
  console.error("GOCAMPING_KEY 환경변수가 필요합니다.");
  process.exit(1);
}

function compactName(text = "") {
  return text
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/캠핑장|오토캠핑장|야영장|글램핑|카라반|캠핑/g, "");
}

function cleanUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const embedded = raw.match(/https?:\/\/[^\s)"'<>]+/i);
  if (embedded) return embedded[0].replace(/[),.\s]+$/, "");
  if (/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+/i.test(raw) && !/[\s,]/.test(raw)) {
    return `https://${raw.replace(/^https?:\/\//i, "")}`;
  }
  return undefined;
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

function portalHomepage(camp) {
  const platform = String(camp.reservationPlatform ?? "");
  const tags = camp.tags ?? [];
  if (platform.includes("국립공원") || tags.includes("국립공원")) {
    return "https://reservation.knps.or.kr";
  }
  if (platform.includes("숲나들") || tags.includes("휴양림")) {
    return "https://www.foresttrip.go.kr";
  }
  if (platform.includes("서울시")) {
    return "https://yeyak.seoul.go.kr";
  }
  return undefined;
}

const byName = new Map();
let page = 1;
let total = Infinity;
while (true) {
  const { items, total: nextTotal } = await getJson("basedList", { pageNo: page, numOfRows: "100" });
  total = nextTotal || total;
  if (!items.length) break;
  for (const item of items) {
    const name = compactName(item.facltNm);
    if (!name) continue;
    const homepage = cleanUrl(item.homepage);
    const reservationUrl = cleanUrl(item.resveUrl) || homepage;
    const phone = String(item.tel ?? "").trim() || undefined;
    const row = {
      gocampingId: String(item.contentId),
      homepage,
      reservationUrl,
      phone,
      facltNm: String(item.facltNm ?? "").trim(),
    };
    const prev = byName.get(name);
    // homepage 있는 쪽을 우선
    if (!prev || (!prev.homepage && row.homepage)) byName.set(name, row);
  }
  console.log(`basedList page ${page} (${byName.size} names / ${total})`);
  if (page * 100 >= total) break;
  page += 1;
  await sleep(120);
}

const index = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
let filledHomepage = 0;
let filledPortal = 0;
let filledPhone = 0;
let filledResve = 0;
let matched = 0;
const changedFiles = [];

for (const pack of index.packs) {
  const file = join(DATA, pack);
  if (!existsSync(file)) continue;
  const payload = JSON.parse(readFileSync(file, "utf8"));
  let changed = false;
  for (const camp of payload.camps ?? []) {
    const keys = [camp.name, ...(camp.aliases ?? [])].map(compactName).filter(Boolean);
    let hit = null;
    for (const key of keys) {
      if (byName.has(key)) {
        hit = byName.get(key);
        break;
      }
    }
    if (hit) {
      matched += 1;
      if (!camp.gocampingId && hit.gocampingId) {
        camp.gocampingId = hit.gocampingId;
        changed = true;
      }
      if (!camp.homepage && hit.homepage) {
        camp.homepage = hit.homepage;
        filledHomepage += 1;
        changed = true;
      }
      if (!camp.reservationUrl && hit.reservationUrl) {
        camp.reservationUrl = hit.reservationUrl;
        filledResve += 1;
        changed = true;
      }
      if (!camp.phone && hit.phone) {
        camp.phone = hit.phone;
        filledPhone += 1;
        changed = true;
      }
    }
    if (!camp.homepage) {
      const portal = portalHomepage(camp);
      if (portal) {
        camp.homepage = portal;
        filledPortal += 1;
        changed = true;
      } else if (camp.reservationUrl && cleanUrl(camp.reservationUrl)) {
        // 예약 URL이 실제 http 주소면 홈페이지 대용으로도 노출
        const url = cleanUrl(camp.reservationUrl);
        if (url && !/camfit\.co\.kr\/search|booking\.naver\.com\/search|campingtalk\.me\/search/i.test(url)) {
          camp.homepage = url;
          filledHomepage += 1;
          changed = true;
        }
      }
    }
  }
  if (changed) {
    payload.updatedAt = new Date().toISOString().slice(0, 10);
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
    changedFiles.push(pack);
  }
}

index.updatedAt = new Date().toISOString().slice(0, 10);
writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`);

const summary = [
  "## 홈페이지 보강",
  "",
  `- 고캠핑 이름 매칭 ${matched}곳`,
  `- homepage 채움 ${filledHomepage}곳`,
  `- 공식 포털 homepage ${filledPortal}곳`,
  `- 예약 URL 채움 ${filledResve}곳`,
  `- 전화 채움 ${filledPhone}곳`,
  `- 수정 팩: ${changedFiles.join(", ") || "없음"}`,
  "",
].join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
