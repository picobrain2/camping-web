export interface PlaceHit {
  name: string;
  lat: number;
  lng: number;
}

function labelOf(parts: Array<string | undefined>): string {
  return [...new Set(parts.filter((part): part is string => Boolean(part)))].join(" · ");
}

async function openMeteo(query: string): Promise<PlaceHit[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=ko&countryCode=KR&format=json`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as {
    results?: { name: string; latitude: number; longitude: number; admin1?: string; admin2?: string }[];
  };
  return (json.results ?? []).map((row) => ({
    name: labelOf([row.name, row.admin2, row.admin1]),
    lat: row.latitude,
    lng: row.longitude,
  }));
}

async function nominatim(query: string): Promise<PlaceHit[]> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=6&countrycodes=kr&accept-language=ko`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as { display_name?: string; lat: string; lon: string }[];
  return json.map((row) => ({
    name: (row.display_name ?? query).split(",").slice(0, 3).join(" · "),
    lat: Number(row.lat),
    lng: Number(row.lon),
  })).filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
}

export async function geocodePlace(query: string): Promise<PlaceHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const primary = await openMeteo(q);
    if (primary.length) return primary;
  } catch {
    // fall through
  }
  try {
    return await nominatim(q);
  } catch {
    return [];
  }
}
