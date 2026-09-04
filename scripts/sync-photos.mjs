/**
 * 고캠핑 공식 이미지(imageList)를 기존 캠핑장 JSON에 붙입니다.
 * 캠핏·네이버 후기 사진은 가져오지 않습니다.
 *
 *   GOCAMPING_KEY=키 npm run sync:photos
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "public/data");
const INDEX_FILE = join(DATA, "index.json");
const BASE = "https://apis.data.go.kr/B551011/GoCamping";
const KEY = process.env.GOCAMPING_KEY;
const MAX_PHOTOS = 12;
const SEARCH_CAP = Number(process.env.SYNC_PHOTO_SEARCH || 400);

if (!KEY) {
  console.error("GOCAMPING_KEY 환경변수가 필요합니다.");
  process.exit(1);
}

function compactName(text = "") {
  return text
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/캠핑장|오토캠핑장|야영장|글램핑|카라반/g, "");
}

function namesMatch(a, b) {
  const ca = compactName(a);
  const cb = compactName(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  // 짧은 이름(예: 휘게)으로 다른 캠핑장에 붙는 일을 막는다
  const shorter = ca.length <= cb.length ? ca : cb;
  const longer = ca.length <= cb.length ? cb : ca;
  if (shorter.length < 5) return false;
  if (!longer.includes(shorter)) return false;
  return shorter.length / longer.length >= 0.7;
}

function keyParam() {
  return KEY.includes("%") ? KEY : encodeURIComponent(KEY);
}

async function getJson(path, extra = {}, attempt = 1) {
  const params = new URLSearchParams({
    MobileOS: "ETC",
    MobileApp: "EodiCamp",
    _type: "json",
    numOfRows: extra.numOfRows ?? "20",
    pageNo: String(extra.pageNo ?? 1),
  });
  if (extra.keyword) params.set("keyword", extra.keyword);
  if (extra.contentId) params.set("contentId", String(extra.contentId));
  const url = `${BASE}/${path}?serviceKey=${keyParam()}&${params.toString()}`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    if (text.trimStart().startsWith("<")) {
      throw new Error(`고캠핑 XML 응답 (${path})`);
    }
    const json = JSON.parse(text);
    const header = json?.response?.header;
    if (header && header.resultCode && header.resultCode !== "0000" && header.resultCode !== "00") {
      throw new Error(`고캠핑 ${header.resultCode}: ${header.resultMsg ?? "오류"}`);
    }
    const body = json?.response?.body;
    if (!body) return { items: [] };
    const raw = body.items?.item ?? [];
    return { items: Array.isArray(raw) ? raw : raw ? [raw] : [] };
  } catch (error) {
    if (attempt < 3) {
      await sleep(400 * attempt);
      return getJson(path, extra, attempt + 1);
    }
    throw error;
  }
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

function mergePhotos(existing, extra) {
  const out = [];
  const seen = new Set();
  for (const url of [...(existing ?? []), ...extra]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_PHOTOS) break;
  }
  return out;
}

async function photosFor(contentId) {
  const { items } = await getJson("imageList", { contentId, numOfRows: "30" });
  return items.map((item) => item.imageUrl).filter(Boolean);
}

const index = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
let updatedCamps = 0;
let searched = 0;

for (const pack of index.packs) {
  const file = join(DATA, pack);
  if (!existsSync(file)) continue;
  const payload = JSON.parse(readFileSync(file, "utf8"));
  let dirty = false;

  for (const camp of payload.camps ?? []) {
    // 공식 홈페이지 사진 등을 수동으로 넣어 둔 curated 항목은 덮어쓰지 않는다
    if (camp.curated === true && Array.isArray(camp.photos) && camp.photos.length && !String(camp.photos[0] || "").includes("gocamping.or.kr")) {
      continue;
    }

    let contentId = camp.gocampingId ? String(camp.gocampingId) : "";
    const hasPhotos = Array.isArray(camp.photos) && camp.photos.length > 0;

    if (!contentId && !hasPhotos && searched < SEARCH_CAP) {
      searched += 1;
      try {
        const { items } = await getJson("searchList", { keyword: camp.name, numOfRows: "10" });
        const hit = items.find((item) => namesMatch(item.facltNm, camp.name));
        if (hit?.contentId) {
          contentId = String(hit.contentId);
          camp.gocampingId = contentId;
          if (hit.firstImageUrl) camp.photos = mergePhotos(camp.photos, [hit.firstImageUrl]);
          dirty = true;
        }
      } catch (error) {
        console.warn(`search ${camp.name}:`, error instanceof Error ? error.message : error);
      }
      await sleep(120);
    }

    if (!contentId) continue;
    if (hasPhotos && (camp.photos?.length ?? 0) >= 4) continue;

    try {
      const urls = await photosFor(contentId);
      const next = mergePhotos(camp.photos, urls);
      if (next.length !== (camp.photos?.length ?? 0) || next.some((url, i) => url !== camp.photos[i])) {
        camp.photos = next;
        dirty = true;
        updatedCamps += 1;
      }
    } catch (error) {
      console.warn(`images ${camp.name}:`, error instanceof Error ? error.message : error);
    }
    await sleep(120);
  }

  if (dirty) {
    payload.updatedAt = new Date().toISOString().slice(0, 10);
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`wrote ${pack}`);
  }
}

console.log(`끝. 사진 갱신 ${updatedCamps}곳, 이름 검색 ${searched}회`);
