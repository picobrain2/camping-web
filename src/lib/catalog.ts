import type { Camp, CatalogFile, OverlayDraft } from "../types";

export function mergeCatalog(fileCamps: Camp[], overlay: OverlayDraft[]): Camp[] {
  const byId = new Map<string, Camp>();
  for (const camp of fileCamps) byId.set(camp.id, camp);
  for (const draft of overlay) {
    const existing = byId.get(draft.id);
    if (!existing) {
      byId.set(draft.id, draft);
      continue;
    }
    if (existing.curated) continue;
    byId.set(draft.id, { ...existing, ...draft, curated: existing.curated });
  }
  return [...byId.values()];
}

export async function loadFileCatalog(): Promise<CatalogFile> {
  const res = await fetch("./data/camps.json");
  if (!res.ok) throw new Error("캠핑장 파일 DB를 불러오지 못했습니다.");
  return (await res.json()) as CatalogFile;
}

export function overlayToJson(overlay: OverlayDraft[]): string {
  return JSON.stringify({ camps: overlay }, null, 2);
}
