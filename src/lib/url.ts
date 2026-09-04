// Some scraped fields (홈페이지/예약 링크) contain plain text, phone numbers,
// or bare domains instead of a clean absolute URL, e.g. "네이버 (https://naver.me/xxx)",
// "가평 아지트캠핑장", "kimpocamping.com", "010-5312-9190". Rendering these
// directly as <a href> causes broken links (404 / dns errors) or literally
// unusable hrefs. This normalizes them into a real absolute URL, or drops
// them (returns undefined) when there is nothing usable.

const URL_PATTERN = /https?:\/\/[^\s)"'<>]+/i;
const BARE_DOMAIN_PATTERN = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?$/i;

export function normalizeExternalUrl(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Text like "네이버 (https://naver.me/xxx)" or "네이버,http://foo.com" —
  // pull out the embedded URL and drop the surrounding description.
  const embedded = trimmed.match(URL_PATTERN);
  if (embedded) return embedded[0].replace(/[),.\s]+$/, "");

  // Bare ASCII domains such as "kimpocamping.com" or "www.foo.co.kr/path"
  // with no spaces/commas/Korean text — safe to treat as a real link.
  if (!/[\s,]/.test(trimmed) && BARE_DOMAIN_PATTERN.test(trimmed)) {
    return `https://${trimmed.replace(/^https?:\/\//i, "")}`;
  }

  // Anything else (Korean descriptions, phone numbers, comma-separated
  // platform names, etc.) is not a usable link.
  return undefined;
}
