import type { Camp, CampKind } from "../types";
import { KIND_LABEL } from "../types";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function won(value?: number): string {
  if (value == null) return "가격 미정";
  return `${value.toLocaleString("ko-KR")}원`;
}

export function wonRange(min?: number, max?: number): string {
  if (min == null && max == null) return "가격 문의";
  if (min != null && max != null && min !== max) return `${won(min)} ~ ${won(max)}`;
  return won(min ?? max);
}

export function scoreText(value: number | null | undefined): string {
  if (value == null) return "–";
  return value.toFixed(1);
}

export function kindLabels(kinds: CampKind[]): string {
  return kinds.map((k) => KIND_LABEL[k]).join(" · ");
}

export function mapLink(camp: Camp): string | null {
  if (camp.lat != null && camp.lng != null) {
    return `https://map.kakao.com/link/map/${encodeURIComponent(camp.name)},${camp.lat},${camp.lng}`;
  }
  if (camp.address) {
    return `https://map.kakao.com/?q=${encodeURIComponent(camp.address)}`;
  }
  return null;
}

export function slugify(name: string): string {
  const compact = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "");
  return compact || `camp-${Date.now()}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
