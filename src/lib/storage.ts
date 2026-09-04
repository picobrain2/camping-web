import type { OverlayDraft, PersonalReview, SavedCampRef } from "../types";

const KEYS = {
  reviews: "eodicamp.reviews.v1",
  overlay: "eodicamp.overlay.v1",
  recent: "eodicamp.recent.v1",
  hidden: "eodicamp.hidden.v1",
  favorites: "eodicamp.favorites.v1",
} as const;

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode / quota
  }
}

function loadSavedList(key: string): SavedCampRef[] {
  const rows = safeGet<Array<Partial<SavedCampRef> & { hiddenAt?: string }>>(key, []);
  return rows
    .filter((row) => row && typeof row.id === "string" && typeof row.name === "string")
    .map((row) => ({
      id: row.id!,
      name: row.name!,
      region: row.region ?? "",
      city: row.city ?? "",
      savedAt: row.savedAt ?? row.hiddenAt ?? new Date().toISOString().slice(0, 10),
    }));
}

export function loadReviews(): Record<string, PersonalReview> {
  return safeGet<Record<string, PersonalReview>>(KEYS.reviews, {});
}

export function saveReviews(reviews: Record<string, PersonalReview>): void {
  safeSet(KEYS.reviews, reviews);
}

export function loadOverlay(): OverlayDraft[] {
  return safeGet<OverlayDraft[]>(KEYS.overlay, []);
}

export function saveOverlay(camps: OverlayDraft[]): void {
  safeSet(KEYS.overlay, camps);
}

export function loadRecent(): string[] {
  return safeGet<string[]>(KEYS.recent, []);
}

export function rememberQuery(query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return loadRecent();
  const next = [trimmed, ...loadRecent().filter((item) => item !== trimmed)].slice(0, 8);
  safeSet(KEYS.recent, next);
  return next;
}

export function loadHidden(): SavedCampRef[] {
  return loadSavedList(KEYS.hidden);
}

export function saveHidden(hidden: SavedCampRef[]): void {
  safeSet(KEYS.hidden, hidden);
}

export function loadFavorites(): SavedCampRef[] {
  return loadSavedList(KEYS.favorites);
}

export function saveFavorites(favorites: SavedCampRef[]): void {
  safeSet(KEYS.favorites, favorites);
}
