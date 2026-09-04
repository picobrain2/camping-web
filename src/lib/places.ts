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

function firstCampPage(urls: Array<string | undefined>, host: RegExp, path: RegExp): string | undefined {
  for (const url of urls) {
    if (!url || !host.test(url)) continue;
    const match = url.match(path);
    if (match) return match[0];
  }
  return undefined;
}

export function camfitHref(camp: Camp): string {
  const page = firstCampPage(
    [camp.camfitUrl, camp.reservationUrl, camp.homepage],
    /camfit\.co\.kr/i,
    /https?:\/\/(?:www\.)?camfit\.co\.kr\/camp\/[a-f0-9]+/i
  );
  if (page) return page.replace("http://", "https://").replace("://www.", "://");
  return `https://camfit.co.kr/search?keyword=${q(camp.name)}`;
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
    {
      name: "캠핏",
      url: camfitHref(camp),
      hint: "실시간 예약",
    },
    {
      name: "캠핑톡",
      url: camp.campingtalkUrl || `https://www.campingtalk.me/search?keyword=${q(name)}`,
      hint: "예약 · 후기",
    },
    {
      name: "땡큐캠핑",
      url: `https://www.thankqcamping.com/search/?keyword=${q(name)}`,
      hint: "예약 · 빈자리",
    },
    {
      name: "캠프픽",
      url: `https://www.camppick.com/search?query=${q(name)}`,
      hint: "후기 · 자리 추천",
    },
    {
      name: "네이버예약",
      url: `https://booking.naver.com/search?query=${q(name)}`,
      hint: "네이버 실시간 예약",
    },
  ];
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
