import type { Camp } from "../types";

export interface GeoPos {
  lat: number;
  lng: number;
}

export interface DriveETA {
  durationSec: number;
  distanceM: number;
}

export function haversineKm(a: GeoPos, b: GeoPos): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function formatDuration(sec: number): string {
  const minutes = Math.max(1, Math.round(sec / 60));
  if (minutes < 60) return `${minutes}분`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

export function formatKm(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)}km`;
}

export function driveLabel(eta: DriveETA): string {
  return `차로 ${formatDuration(eta.durationSec)} · ${formatKm(eta.distanceM)}`;
}

export function naverCarDirections(from: GeoPos, camp: Camp): string {
  const start = `${from.lng},${from.lat},내위치,HOME`;
  if (camp.lat != null && camp.lng != null) {
    return `https://map.naver.com/p/directions/${start}/${camp.lng},${camp.lat},${encodeURIComponent(camp.name)},PLACE/-/car`;
  }
  return `https://map.naver.com/p/directions/${start}/${encodeURIComponent(camp.name)}/-/car`;
}

function fallbackEta(from: GeoPos, camp: Camp): DriveETA | null {
  if (camp.lat == null || camp.lng == null) return null;
  const km = haversineKm(from, { lat: camp.lat, lng: camp.lng }) * 1.35;
  return { distanceM: km * 1000, durationSec: (km / 55) * 3600 };
}

export function estimateDrives(from: GeoPos, camps: Camp[]): Record<string, DriveETA> {
  const out: Record<string, DriveETA> = {};
  for (const camp of camps) {
    const eta = fallbackEta(from, camp);
    if (eta) out[camp.id] = eta;
  }
  return out;
}

export async function drivingTable(from: GeoPos, camps: Camp[]): Promise<Record<string, DriveETA>> {
  const targets = camps.filter((c) => c.lat != null && c.lng != null).slice(0, 40);
  const fallback: Record<string, DriveETA> = {};
  for (const camp of targets) {
    const eta = fallbackEta(from, camp);
    if (eta) fallback[camp.id] = eta;
  }
  if (!targets.length) return fallback;
  const path = [`${from.lng},${from.lat}`, ...targets.map((c) => `${c.lng},${c.lat}`)].join(";");
  try {
    const url = `https://router.project-osrm.org/table/v1/driving/${path}?sources=0&annotations=duration,distance`;
    const res = await fetch(url);
    if (!res.ok) return fallback;
    const json = (await res.json()) as { durations?: number[][]; distances?: number[][] };
    const durations = json.durations?.[0] ?? [];
    const distances = json.distances?.[0] ?? [];
    const out: Record<string, DriveETA> = {};
    targets.forEach((camp, i) => {
      const durationSec = durations[i + 1];
      const distanceM = distances[i + 1];
      if (durationSec != null && durationSec >= 0 && distanceM != null && distanceM >= 0) {
        out[camp.id] = { durationSec, distanceM };
      } else if (fallback[camp.id]) {
        out[camp.id] = fallback[camp.id];
      }
    });
    return out;
  } catch {
    return fallback;
  }
}
