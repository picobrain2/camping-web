import type { Camp } from "../types";
import { mapLink } from "./format";

export interface PlaceLink {
  name: string;
  url: string;
  hint: string;
}

function q(value: string): string {
  return encodeURIComponent(value);
}

function firstMatch(urls: Array<string | undefined>, pattern: RegExp): string | undefined {
  for (const url of urls) {
    if (!url) continue;
    const match = url.match(pattern);
    if (match) return match[0];
  }
  return undefined;
}

function campUrls(camp: Camp): Array<string | undefined> {
  return [camp.camfitUrl, camp.campingtalkUrl, camp.reservationUrl, camp.homepage];
}

/** 실제 캠핏 캠핑장 페이지가 있을 때만 URL을 반환. 검색 폴백은 쓰지 않음. */
export function camfitHref(camp: Camp): string | undefined {
  const page = firstMatch(
    campUrls(camp),
    /https?:\/\/(?:www\.)?camfit\.co\.kr\/camp\/[a-f0-9]+/i
  );
  if (!page) return undefined;
  return page.replace(/^http:\/\//i, "https://").replace("://www.", "://");
}

function campingTalkHref(camp: Camp): string | undefined {
  return firstMatch(campUrls(camp), /https?:\/\/(?:www\.)?campingtalk\.me\/[^\s"'<>]+/i);
}

function thankqHref(camp: Camp): string | undefined {
  return firstMatch(campUrls(camp), /https?:\/\/(?:www\.)?thankqcamping\.com\/[^\s"'<>]+/i);
}

function camppickHref(camp: Camp): string | undefined {
  return firstMatch(campUrls(camp), /https?:\/\/(?:www\.)?camppick\.com\/[^\s"'<>]+/i);
}

function naverBookingHref(camp: Camp): string | undefined {
  return firstMatch(campUrls(camp), /https?:\/\/(?:m\.)?booking\.naver\.com\/[^\s"'<>]+/i);
}

export function placeLinks(camp: Camp): PlaceLink[] {
  const name = camp.name;
  const links: PlaceLink[] = [
    {
      name: "네이버지도",
      url: `https://map.naver.com/p/search/${q(name)}`,
      hint: "평점 · 후기 · 길찾기",
    },
    {
      name: "네이버",
      url: `https://search.naver.com/search.naver?query=${q(`${name} 캠핑장`)}`,
      hint: "블로그 · 예약",
    },
  ];

  const camfit = camfitHref(camp);
  if (camfit) links.push({ name: "캠핏", url: camfit, hint: "실시간 예약" });

  const talk = campingTalkHref(camp);
  if (talk) links.push({ name: "캠핑톡", url: talk, hint: "예약 · 후기" });

  const thankq = thankqHref(camp);
  if (thankq) links.push({ name: "땡큐캠핑", url: thankq, hint: "예약 · 빈자리" });

  const camppick = camppickHref(camp);
  if (camppick) links.push({ name: "캠프픽", url: camppick, hint: "후기 · 자리 추천" });

  const booking = naverBookingHref(camp);
  if (booking) links.push({ name: "네이버예약", url: booking, hint: "네이버 실시간 예약" });

  const kakao = mapLink(camp);
  if (kakao) links.push({ name: "카카오맵", url: kakao, hint: "길찾기" });

  return links;
}

export function officialLayoutImage(camp: Camp): string | undefined {
  const candidates = [camp.layoutImage, camp.layoutUrl].filter(Boolean) as string[];
  for (const url of candidates) {
    if (/camppick\.com/i.test(url)) continue;
    if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url) || /%eb%b0%b0%ec%b9%98%eb%8f%84|배치도/i.test(url)) {
      return url;
    }
  }
  return undefined;
}
