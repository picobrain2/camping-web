import type { CampLayout, ZoneKind } from "../types";

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

export const LAYOUT_LEGEND: { kind: ZoneKind; label: string }[] = [
  { kind: "auto", label: "오토" },
  { kind: "glamping", label: "글램핑" },
  { kind: "caravan", label: "카라반" },
  { kind: "tent", label: "텐트" },
  { kind: "amenity", label: "편의" },
  { kind: "water", label: "물" },
  { kind: "road", label: "동선" },
];
