import type { Camp } from "../types";

const NEEDLES: Record<string, string[]> = {
  위생시설: ["화장실", "샤워", "샤워장", "온수", "위생"],
  샤워: ["샤워", "샤워장"],
  온수: ["온수"],
  개별화장실: ["개별화장실", "개별 화장실", "전용화장실", "개별욕실", "개별샤워"],
  전기: ["전기"],
  와이파이: ["와이파이", "무선인터넷", "wifi", "WiFi"],
  매점: ["매점", "마트", "편의점"],
  개수대: ["개수대", "취사장"],
  놀이터: ["놀이터", "트램펄린", "트렘폴린", "트램폴린"],
  수영장: ["수영장", "물놀이장"],
  장작: ["장작"],
  물놀이: ["물놀이", "수영장", "물놀이장", "계곡"],
  키즈: ["키즈", "놀이터", "어린이"],
  반려견: ["반려견", "반려동물", "애견"],
};

function blobOf(camp: Camp): string {
  return [camp.tags.join(" "), camp.amenities.join(" "), camp.description].join(" ");
}

export function campHasTag(camp: Camp, tag: string): boolean {
  if (camp.tags.includes(tag)) return true;
  const blob = blobOf(camp);
  if (tag === "위생시설") {
    const hasToilet = /화장실/.test(blob);
    const hasWash = /샤워|온수/.test(blob);
    return hasToilet && hasWash;
  }
  const needles = NEEDLES[tag];
  if (!needles) return false;
  return needles.some((n) => blob.includes(n));
}

export function deriveFacilityTags(tags: string[], amenities: string[], description: string): string[] {
  const fake = { tags, amenities, description } as Camp;
  const extra = [
    "위생시설",
    "샤워",
    "온수",
    "개별화장실",
    "전기",
    "와이파이",
    "매점",
    "개수대",
    "놀이터",
    "수영장",
    "장작",
    "반려견",
    "키즈",
    "물놀이",
  ].filter((tag) => campHasTag(fake, tag));
  return [...new Set([...tags, ...extra])];
}
