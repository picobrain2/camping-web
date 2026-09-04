import type { Camp, CampKind, PersonalReview } from "../types";

function compact(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function haystack(camp: Camp): string {
  return [camp.name, ...camp.aliases, camp.region, camp.city, camp.address, camp.description, ...camp.tags]
    .join(" ");
}

export function relevance(camp: Camp, query: string): number {
  const q = compact(query);
  if (!q) return 0;
  const name = compact(camp.name);
  if (name === q) return 100;
  if (name.startsWith(q) || q.startsWith(name)) return 90;
  if (name.includes(q)) return 80;
  if (camp.aliases.some((alias) => compact(alias).includes(q))) return 70;
  if (compact(haystack(camp)).includes(q)) return 50;
  return 0;
}

export function filterCamps(
  camps: Camp[],
  query: string,
  region: string,
  kind: string,
  tag: string,
  reviews: Record<string, PersonalReview>
): Camp[] {
  const trimmed = query.trim();
  return camps
    .filter((camp) => {
      if (region !== "all" && camp.region !== region) return false;
      if (kind !== "all" && !camp.kinds.includes(kind as CampKind)) return false;
      if (tag === "reviewed") return Boolean(reviews[camp.id]);
      if (tag !== "all" && !camp.tags.includes(tag)) return false;
      if (!trimmed) return true;
      return relevance(camp, trimmed) > 0;
    })
    .sort((a, b) => {
      if (trimmed) return relevance(b, trimmed) - relevance(a, trimmed);
      const featured = Number(Boolean(b.featured)) - Number(Boolean(a.featured));
      if (featured !== 0) return featured;
      return (displayScore(b, reviews) ?? 0) - (displayScore(a, reviews) ?? 0);
    });
}

export function displayScore(camp: Camp, reviews: Record<string, PersonalReview>): number | null {
  const mine = reviews[camp.id]?.rating;
  const official = camp.ratings.official ?? camp.ratings.naver ?? camp.ratings.kakao;
  if (mine && official) return Math.round(((mine + official) / 2) * 10) / 10;
  return mine ?? official ?? null;
}

export function featuredCamps(camps: Camp[], reviews: Record<string, PersonalReview>): Camp[] {
  return [...camps]
    .filter((camp) => camp.featured || (camp.ratings.official ?? 0) >= 4.3)
    .sort((a, b) => (displayScore(b, reviews) ?? 0) - (displayScore(a, reviews) ?? 0))
    .slice(0, 8);
}

export function reviewedCamps(camps: Camp[], reviews: Record<string, PersonalReview>): Camp[] {
  return camps
    .filter((camp) => reviews[camp.id])
    .sort((a, b) => (reviews[b.id]?.updatedAt ?? "").localeCompare(reviews[a.id]?.updatedAt ?? ""));
}

export function priceRange(camp: Camp): { min?: number; max?: number } {
  const mins = camp.siteTypes.map((s) => s.priceMin).filter((n): n is number => n != null);
  const maxes = camp.siteTypes.map((s) => s.peakPriceMax ?? s.priceMax).filter((n): n is number => n != null);
  return {
    min: mins.length ? Math.min(...mins) : undefined,
    max: maxes.length ? Math.max(...maxes) : undefined,
  };
}
