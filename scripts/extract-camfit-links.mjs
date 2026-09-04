import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = join(root, "public/data");
const CAMP_ID = /https?:\/\/(?:www\.)?camfit\.co\.kr\/camp\/([a-f0-9]{24})/gi;
const SKIP_HOST = /foresttrip|knps\.|seoul\.go|go\.kr|gocamping|grandpark|hangang|parks\.seoul|reservation\.knps/i;

const index = JSON.parse(readFileSync(join(dataRoot, "index.json"), "utf8"));
const seen = new Set();
const camps = [];
for (const pack of index.packs) {
  if (pack.includes("camfit-links")) continue;
  const file = JSON.parse(readFileSync(join(dataRoot, pack), "utf8"));
  for (const camp of file.camps ?? []) {
    if (!camp.id || seen.has(camp.id)) continue;
    seen.add(camp.id);
    camps.push(camp);
  }
}

const found = new Map();
function remember(id, campId, source) {
  if (!found.has(id)) found.set(id, { id, camfitUrl: `https://camfit.co.kr/camp/${campId}`, source });
}

for (const camp of camps) {
  const blob = [camp.camfitUrl, camp.reservationUrl, camp.homepage].filter(Boolean).join(" ");
  CAMP_ID.lastIndex = 0;
  const match = CAMP_ID.exec(blob);
  if (match) remember(camp.id, match[1], "catalog");
}

const toFetch = camps.filter((camp) => {
  if (found.has(camp.id)) return false;
  const urls = [camp.homepage, camp.reservationUrl].filter((url) => /^https?:\/\//i.test(url || ""));
  return urls.some((url) => !SKIP_HOST.test(url) && !/camfit\.co\.kr\/search/i.test(url));
});

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "eodicam-link-check/1.0" },
    });
    if (!res.ok) return "";
    const text = await res.text();
    return text.slice(0, 400_000);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

const queue = [...toFetch];
const workers = Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const camp = queue.shift();
    if (!camp) return;
    const urls = [...new Set([camp.homepage, camp.reservationUrl].filter((url) => /^https?:\/\//i.test(url || "")))];
    for (const url of urls) {
      if (SKIP_HOST.test(url) || /camfit\.co\.kr/i.test(url)) continue;
      const html = await fetchText(url);
      CAMP_ID.lastIndex = 0;
      const match = CAMP_ID.exec(html);
      if (match) {
        remember(camp.id, match[1], url);
        break;
      }
    }
  }
});
await Promise.all(workers);

const rows = [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
const out = {
  updatedAt: new Date().toISOString().slice(0, 10),
  note: "캠핏 캠핑장 페이지. 목록을 긁지 않고, 이미 가진 주소와 각 캠핑장 공식 홈페이지에 적힌 링크만 모았습니다.",
  camps: rows.map(({ id, camfitUrl }) => ({ id, camfitUrl })),
};
writeFileSync(join(dataRoot, "packs/camfit-links.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${rows.length} camfit camp pages (fetched ${toFetch.length} homepages)`);
