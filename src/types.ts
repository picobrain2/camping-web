export type CampKind = "auto" | "glamping" | "caravan" | "tent";

export type ZoneKind = CampKind | "amenity" | "water" | "road";

export type CampSource = "manual" | "gocamping" | "overlay";

export interface LayoutZone {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: ZoneKind;
}

export interface CampLayout {
  cols: number;
  rows: number;
  zones: LayoutZone[];
}

export interface SiteType {
  name: string;
  count?: number;
  priceMin?: number;
  priceMax?: number;
  peakPriceMin?: number;
  peakPriceMax?: number;
  notes?: string;
}

export interface ReservationWindow {
  label: string;
  rule: string;
  startDate?: string;
  endDate?: string;
}

export interface CampRatings {
  official?: number;
  officialCount?: number;
  naver?: number;
  kakao?: number;
}

export interface ReviewQuote {
  source: string;
  rating?: number;
  body: string;
  url?: string;
}

export interface Camp {
  id: string;
  curated?: boolean;
  gocampingId?: string;
  name: string;
  aliases: string[];
  region: string;
  city: string;
  kinds: CampKind[];
  tags: string[];
  address: string;
  lat?: number;
  lng?: number;
  phone?: string;
  homepage?: string;
  reservationUrl?: string;
  reservationPlatform?: string;
  camfitUrl?: string;
  campingtalkUrl?: string;
  mannersTime?: string;
  reservationWindows: ReservationWindow[];
  siteTypes: SiteType[];
  amenities: string[];
  description: string;
  layoutImage?: string;
  layoutUrl?: string;
  quotes?: ReviewQuote[];
  photos: string[];
  ratings: CampRatings;
  featured?: boolean;
  source: CampSource;
  updatedAt: string;
  layout?: CampLayout;
}

export type CampDraft = Partial<Camp> & Pick<Camp, "id" | "name" | "region" | "city">;

export interface CatalogFile {
  version: number;
  updatedAt: string;
  note?: string;
  camps: Camp[];
}

export interface CatalogIndex {
  updatedAt: string;
  note?: string;
  packs: string[];
}

export interface PersonalReview {
  campId: string;
  rating: number;
  visitedAt?: string;
  siteName?: string;
  body: string;
  updatedAt: string;
}

export interface OverlayDraft extends Camp {
  source: "overlay";
}

export const KIND_LABEL: Record<CampKind, string> = {
  auto: "오토캠핑",
  glamping: "글램핑",
  caravan: "카라반",
  tent: "일반야영",
};

export const REGION_OPTIONS = [
  "서울",
  "경기",
  "강원",
  "충청",
  "전라",
  "경상",
  "제주",
] as const;

export const TAG_OPTIONS = [
  "한강",
  "바다",
  "계곡",
  "산",
  "호수",
  "반려견",
  "물놀이",
  "국립공원",
  "휴양림",
  "키즈",
] as const;
