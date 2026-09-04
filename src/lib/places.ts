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
      url: camp.camfitUrl || `https://camfit.co.kr/search?keyword=${q(name)}`,
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
