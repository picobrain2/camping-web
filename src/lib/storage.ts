import type { AccountBundle, LocalAccount, OverlayDraft, PersonalReview, SavedCampRef } from "../types";

const KEYS = {
  reviews: "eodicamp.reviews.v1",
  overlay: "eodicamp.overlay.v1",
  recent: "eodicamp.recent.v1",
  hidden: "eodicamp.hidden.v1",
  favorites: "eodicamp.favorites.v1",
  accounts: "eodicamp.accounts.v1",
  session: "eodicamp.session.v1",
} as const;

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode / quota
  }
}

function loadSavedList(raw: unknown): SavedCampRef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Partial<SavedCampRef> & { id: string; name: string; hiddenAt?: string } =>
      Boolean(row && typeof (row as SavedCampRef).id === "string" && typeof (row as SavedCampRef).name === "string")
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      region: row.region ?? "",
      city: row.city ?? "",
      savedAt: row.savedAt ?? row.hiddenAt ?? new Date().toISOString().slice(0, 10),
    }));
}

function bundleKey(accountId: string): string {
  return `eodicamp.account.${accountId}.v1`;
}

function emptyBundle(): AccountBundle {
  return { favorites: [], hidden: [], reviews: {} };
}

function readGuestBundle(): AccountBundle {
  return {
    favorites: loadSavedList(safeGet(KEYS.favorites, [])),
    hidden: loadSavedList(safeGet(KEYS.hidden, [])),
    reviews: safeGet<Record<string, PersonalReview>>(KEYS.reviews, {}),
  };
}

function writeGuestBundle(bundle: AccountBundle): void {
  safeSet(KEYS.favorites, bundle.favorites);
  safeSet(KEYS.hidden, bundle.hidden);
  safeSet(KEYS.reviews, bundle.reviews);
}

function readAccountBundle(accountId: string): AccountBundle {
  const raw = safeGet<Partial<AccountBundle>>(bundleKey(accountId), {});
  return {
    favorites: loadSavedList(raw.favorites),
    hidden: loadSavedList(raw.hidden),
    reviews: raw.reviews && typeof raw.reviews === "object" ? raw.reviews : {},
  };
}

function writeAccountBundle(accountId: string, bundle: AccountBundle): void {
  safeSet(bundleKey(accountId), bundle);
}

function currentBundle(): AccountBundle {
  const session = getSessionId();
  return session ? readAccountBundle(session) : readGuestBundle();
}

function saveCurrentBundle(bundle: AccountBundle): void {
  const session = getSessionId();
  if (session) writeAccountBundle(session, bundle);
  else writeGuestBundle(bundle);
}

export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`eodicamp:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function listAccounts(): LocalAccount[] {
  const rows = safeGet<LocalAccount[]>(KEYS.accounts, []);
  return rows
    .filter((row) => row && typeof row.id === "string" && typeof row.name === "string")
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function saveAccounts(accounts: LocalAccount[]): void {
  safeSet(KEYS.accounts, accounts);
}

export function getSessionId(): string | null {
  const id = safeGet<string | null>(KEYS.session, null);
  if (!id) return null;
  return listAccounts().some((account) => account.id === id) ? id : null;
}

export function currentAccount(): LocalAccount | null {
  const id = getSessionId();
  if (!id) return null;
  return listAccounts().find((account) => account.id === id) ?? null;
}

export function logoutAccount(): void {
  safeSet(KEYS.session, null);
}

export async function createAccount(name: string, pin?: string, migrateGuest = true): Promise<LocalAccount> {
  const trimmed = name.trim();
  if (trimmed.length < 2) throw new Error("이름은 2글자 이상 적어 주세요.");
  if (listAccounts().some((account) => account.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("이미 같은 이름이 있습니다.");
  }
  if (pin != null && pin !== "" && !/^\d{4}$/.test(pin)) {
    throw new Error("PIN은 숫자 4자리로 적어 주세요.");
  }

  const account: LocalAccount = {
    id: `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: trimmed,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  if (pin) account.pinHash = await hashPin(pin);

  const bundle = migrateGuest ? readGuestBundle() : emptyBundle();
  writeAccountBundle(account.id, bundle);
  if (migrateGuest) writeGuestBundle(emptyBundle());

  saveAccounts([...listAccounts(), account]);
  safeSet(KEYS.session, account.id);
  return account;
}

export async function loginAccount(accountId: string, pin?: string): Promise<LocalAccount> {
  const account = listAccounts().find((row) => row.id === accountId);
  if (!account) throw new Error("계정을 찾지 못했습니다.");
  if (account.pinHash) {
    if (!pin || (await hashPin(pin)) !== account.pinHash) {
      throw new Error("PIN이 맞지 않습니다.");
    }
  }
  safeSet(KEYS.session, account.id);
  return account;
}

export function deleteAccount(accountId: string): void {
  saveAccounts(listAccounts().filter((account) => account.id !== accountId));
  try {
    localStorage.removeItem(bundleKey(accountId));
  } catch {
    // ignore
  }
  if (getSessionId() === accountId) logoutAccount();
}

export function loadReviews(): Record<string, PersonalReview> {
  return currentBundle().reviews;
}

export function saveReviews(reviews: Record<string, PersonalReview>): void {
  saveCurrentBundle({ ...currentBundle(), reviews });
}

export function loadOverlay(): OverlayDraft[] {
  return safeGet<OverlayDraft[]>(KEYS.overlay, []);
}

export function saveOverlay(camps: OverlayDraft[]): void {
  safeSet(KEYS.overlay, camps);
}

export function loadRecent(): string[] {
  return safeGet<string[]>(KEYS.recent, []);
}

export function rememberQuery(query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return loadRecent();
  const next = [trimmed, ...loadRecent().filter((item) => item !== trimmed)].slice(0, 8);
  safeSet(KEYS.recent, next);
  return next;
}

export function loadHidden(): SavedCampRef[] {
  return currentBundle().hidden;
}

export function saveHidden(hidden: SavedCampRef[]): void {
  saveCurrentBundle({ ...currentBundle(), hidden });
}

export function loadFavorites(): SavedCampRef[] {
  return currentBundle().favorites;
}

export function saveFavorites(favorites: SavedCampRef[]): void {
  saveCurrentBundle({ ...currentBundle(), favorites });
}

/** 계정 전환 후 앱 상태를 다시 읽을 때 사용 */
export function reloadPersonalData(): {
  favorites: SavedCampRef[];
  hidden: SavedCampRef[];
  reviews: Record<string, PersonalReview>;
} {
  const bundle = currentBundle();
  return {
    favorites: bundle.favorites,
    hidden: bundle.hidden,
    reviews: bundle.reviews,
  };
}
