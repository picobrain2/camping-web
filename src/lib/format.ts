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

/** 배치도·약도·도면처럼 대표 사진으로 쓰기 어려운 이미지 */
export function isLayoutLikeImage(url: string, camp?: Pick<Camp, "layoutImage" | "layoutUrl">): boolean {
  if (!url) return false;
  if (camp?.layoutImage && url === camp.layoutImage) return true;
  if (camp?.layoutUrl && url === camp.layoutUrl) return true;
  return /배치도|약도|도면|layout|sitemap|site[_-]?map|img_map|facility.?map|캠핑장배치|zone.?map/i.test(url);
}

/** 목록·포스터용. 배치도는 뒤로 미루고 일반 사진을 우선한다. */
export function coverPhoto(camp: Camp): string | undefined {
  const photos = displayPhotos(camp);
  return photos[0];
}

/** 사진 갤러리용. 배치도성 이미지는 맨 뒤로. */
export function displayPhotos(camp: Camp): string[] {
  const raw = [...new Set((camp.photos ?? []).filter(Boolean))];
  if (raw.length <= 1) return raw;
  const scenic: string[] = [];
  const layouts: string[] = [];
  for (const url of raw) {
    if (isLayoutLikeImage(url, camp)) layouts.push(url);
    else scenic.push(url);
  }
  // 고캠핑 제공 사진은 첫 장이 배치도인 경우가 많아, 일반 사진이 충분하면 첫 장을 뒤로 미룬다.
  if (!layouts.length && scenic.length >= 3 && /gocamping\.or\.kr/i.test(scenic[0])) {
    const [first, ...rest] = scenic;
    return [...rest, first];
  }
  return [...scenic, ...layouts];
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
