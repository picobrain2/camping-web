import { deriveFacilityTags } from "./tags";
import { normalizeExternalUrl } from "./url";
import type { Camp, CampDraft, CatalogFile, CatalogIndex, OverlayDraft } from "../types";

export function normalizeCamp(raw: CampDraft): Camp {
  const kinds = raw.kinds?.length ? raw.kinds : (["tent"] as Camp["kinds"]);
  const amenities = raw.amenities ?? [];
  const description = raw.description ?? "";
  const tags = deriveFacilityTags(raw.tags ?? [], amenities, description);
  const siteTypes = raw.siteTypes?.length
    ? raw.siteTypes
    : kinds.map((kind) => ({ name: kind === "auto" ? "자동차야영" : kind === "glamping" ? "글램핑" : kind === "caravan" ? "카라반" : "일반야영" }));
  const base = {
    aliases: [],
    address: "",
    reservationWindows: [] as Camp["reservationWindows"],
    amenities: [] as string[],
    description: "",
    photos: [] as string[],
    quotes: [] as Camp["quotes"],
    ratings: {},
    featured: false,
    source: "manual" as const,
    updatedAt: "2026-09-04",
    curated: true,
  };
  return {
    ...base,
    ...raw,
    kinds,
    tags,
    amenities: raw.amenities ?? amenities,
    description: raw.description ?? description,
    siteTypes,
    layout: raw.layout,
    homepage: normalizeExternalUrl(raw.homepage),
    reservationUrl: normalizeExternalUrl(raw.reservationUrl),
    camfitUrl: normalizeExternalUrl(raw.camfitUrl),
    campingtalkUrl: normalizeExternalUrl(raw.campingtalkUrl),
    quotes: raw.quotes?.map((quote) =>
      quote.url ? { ...quote, url: normalizeExternalUrl(quote.url) } : quote
    ),
  };
}

export function mergeCatalog(fileCamps: Camp[], overlay: OverlayDraft[]): Camp[] {
  const byId = new Map<string, Camp>();
  for (const camp of fileCamps) byId.set(camp.id, camp);
  for (const draft of overlay) {
    const existing = byId.get(draft.id);
    if (!existing) {
      byId.set(draft.id, normalizeCamp(draft));
      continue;
    }
    if (existing.curated) continue;
    byId.set(draft.id, normalizeCamp({ ...existing, ...draft, curated: existing.curated }));
  }
  return [...byId.values()];
}

async function fetchJson<T>(url: string): Promise<T> {
  // 목록 JSON은 Pages/브라우저 캐시에 오래 남으면 신규 캠핑장이 안 보인다.
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} 를 불러오지 못했습니다.`);
  return (await res.json()) as T;
}

export async function loadFileCatalog(): Promise<CatalogFile> {
  const index = await fetchJson<CatalogIndex>("./data/index.json");
  const bust = encodeURIComponent(index.updatedAt || "1");
  const files = await Promise.all(
    index.packs.map((pack) => fetchJson<{ camps?: CampDraft[] }>(`./data/${pack}?v=${bust}`))
  );
  const byId = new Map<string, Camp>();
  for (const file of files) {
    for (const raw of file.camps ?? []) {
      if (!raw.id || byId.has(raw.id)) continue;
      byId.set(raw.id, normalizeCamp(raw));
    }
  }
  return {
    version: 1,
    updatedAt: index.updatedAt,
    note: index.note,
    camps: [...byId.values()],
  };
}

/** Firestore 우선, 실패 시에만 로컬 JSON 팩 (시드/오프라인 보조) */
export async function loadCatalog(): Promise<CatalogFile> {
  try {
    const { isCloudConfigured, loadCloudCatalog } = await import("./cloud");
    if (isCloudConfigured()) {
      return await loadCloudCatalog();
    }
  } catch (error) {
    console.warn("Firestore 목록 로드 실패, JSON으로 대체:", error);
  }
  return loadFileCatalog();
}

export function overlayToJson(overlay: OverlayDraft[]): string {
  return JSON.stringify({ camps: overlay }, null, 2);
}

export function parseCampList(raw: string): CampDraft[] {
  const parsed = JSON.parse(raw) as { camps?: CampDraft[] } | CampDraft[];
  const rows = Array.isArray(parsed) ? parsed : parsed.camps ?? [];
  return rows.filter((row) => row && typeof row.id === "string" && typeof row.name === "string");
}
