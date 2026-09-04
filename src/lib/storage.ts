import type { OverlayDraft, PersonalReview } from "../types";

const KEYS = {
  reviews: "eodicamp.reviews.v1",
  overlay: "eodicamp.overlay.v1",
  recent: "eodicamp.recent.v1",
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
