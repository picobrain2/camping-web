import type { CampKind, CampLayout, SiteType, ZoneKind } from "../types";

const FILL: Record<ZoneKind, string> = {
  auto: "#6f8f62",
  glamping: "#c48a3a",
  caravan: "#5b7c99",
  tent: "#3d6b4f",
  amenity: "#b9a48a",
  water: "#6ea4c8",
  road: "#d8cbb6",
};

export function renderLayoutSvg(layout: CampLayout, title: string): string {
  const cell = 36;
  const pad = 16;
  const width = layout.cols * cell + pad * 2;
  const height = layout.rows * cell + pad * 2;

  const zones = layout.zones
    .map((zone) => {
      const x = pad + zone.x * cell;
      const y = pad + zone.y * cell;
      const w = zone.w * cell - 4;
      const h = zone.h * cell - 4;
      const fill = FILL[zone.kind] ?? FILL.amenity;
      const font = Math.max(10, Math.min(13, w / Math.max(zone.label.length, 1) + 4));
      return `
        <g>
          <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" opacity="0.92"/>
          <text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" fill="#fffdf6" font-size="${font}" font-weight="700">${escapeXml(zone.label)}</text>
        </g>`;
    })
    .join("");

  return `
    <svg class="layout-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)} 전체 배치도">
      <rect width="${width}" height="${height}" rx="16" fill="#efe6d6"/>
      ${zones}
    </svg>`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function inferLayout(kinds: CampKind[], siteTypes: SiteType[], tags: string[]): CampLayout {
  const zoneKind = (name: string, fallback?: CampKind): ZoneKind => {
    if (name.includes("글램") || fallback === "glamping") return "glamping";
    if (name.includes("카라") || fallback === "caravan") return "caravan";
    if (name.includes("오토") || name.includes("자동차") || fallback === "auto") return "auto";
    return "tent";
  };
  const items = siteTypes.length
    ? siteTypes
    : kinds.map((kind) => ({ name: kind }));
  const zones = items.slice(0, 4).map((site, index) => ({
    id: site.name || `z${index}`,
    label: site.name || "사이트",
    x: index * 3,
    y: 0,
    w: 3,
    h: 4,
    kind: zoneKind(site.name, kinds[index] ?? kinds[0]),
  }));
  const width = Math.max(zones.length * 3, 8);
  const water = tags.find((tag) => ["바다", "계곡", "호수", "한강"].includes(tag));
  zones.push(
    water
      ? { id: "water", label: water, x: 0, y: 4, w: width, h: 2, kind: "water" }
      : { id: "wc", label: "편의시설", x: 0, y: 4, w: width, h: 2, kind: "amenity" }
  );
  return { cols: width, rows: 6, zones };
}

export const LAYOUT_LEGEND: { kind: ZoneKind; label: string }[] = [
  { kind: "auto", label: "오토" },
  { kind: "glamping", label: "글램핑" },
  { kind: "caravan", label: "카라반" },
  { kind: "tent", label: "텐트" },
  { kind: "amenity", label: "편의" },
  { kind: "water", label: "물" },
  { kind: "road", label: "동선" },
];
