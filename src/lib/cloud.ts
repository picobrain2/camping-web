import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import { collection, doc, getDoc, getDocs, getFirestore, setDoc, type Firestore } from "firebase/firestore";
import { normalizeCamp } from "./catalog";
import type { AccountBundle, Camp, CampDraft, CatalogFile, PersonalReview, SavedCampRef, VisitDiaryEntry } from "../types";

export interface CloudUser {
  uid: string;
  email: string | null;
  name: string | null;
}

type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
};

const env = import.meta.env;

/**
 * 모바일 Safari/Chrome은 3P 저장소를 막아, authDomain이 앱 호스트와 다르면
 * signInWithRedirect 후 로그인 상태가 유실됩니다.
 * Firebase Hosting(.web.app / .firebaseapp.com)에서는 같은 도메인을 authDomain으로 씁니다.
 * @see https://firebase.google.com/docs/auth/web/redirect-best-practices
 */
function resolveAuthDomain(configured: string): string {
  if (typeof location === "undefined") return configured;
  const host = location.hostname;
  if (host.endsWith(".web.app") || host.endsWith(".firebaseapp.com")) return host;
  return configured;
}

function readConfig(): FirebaseWebConfig | null {
  const apiKey = String(env.VITE_FIREBASE_API_KEY ?? "").trim();
  const configuredDomain = String(env.VITE_FIREBASE_AUTH_DOMAIN ?? "").trim();
  const projectId = String(env.VITE_FIREBASE_PROJECT_ID ?? "").trim();
  const appId = String(env.VITE_FIREBASE_APP_ID ?? "").trim();
  if (!apiKey || !configuredDomain || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain: resolveAuthDomain(configuredDomain),
    projectId,
    storageBucket: String(env.VITE_FIREBASE_STORAGE_BUCKET ?? "").trim() || undefined,
    messagingSenderId: String(env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "").trim() || undefined,
    appId,
  };
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let bootPromise: Promise<CloudUser | null> | null = null;

export function isCloudConfigured(): boolean {
  return readConfig() != null;
}

function ensureFirebase(): { auth: Auth; db: Firestore } {
  const config = readConfig();
  if (!config) throw new Error("클라우드 동기화 설정이 아직 없습니다.");
  if (!app) {
    app = initializeApp(config);
    auth = getAuth(app);
    db = getFirestore(app);
  }
  return { auth: auth!, db: db! };
}

function asSavedList(raw: unknown): SavedCampRef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is SavedCampRef => Boolean(row && typeof (row as SavedCampRef).id === "string" && typeof (row as SavedCampRef).name === "string"))
    .map((row) => ({
      id: row.id,
      name: row.name,
      region: row.region ?? "",
      city: row.city ?? "",
      savedAt: row.savedAt ?? new Date().toISOString().slice(0, 10),
    }));
}

function asReviews(raw: unknown): Record<string, PersonalReview> {
  if (!raw || typeof raw !== "object") return {};
  return raw as Record<string, PersonalReview>;
}

function asDiary(raw: unknown): VisitDiaryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is VisitDiaryEntry =>
      Boolean(
        row &&
          typeof (row as VisitDiaryEntry).id === "string" &&
          typeof (row as VisitDiaryEntry).campId === "string" &&
          typeof (row as VisitDiaryEntry).campName === "string" &&
          typeof (row as VisitDiaryEntry).visitedAt === "string"
      )
    )
    .map((row) => ({
      id: row.id,
      campId: row.campId,
      campName: row.campName,
      region: row.region ?? "",
      city: row.city ?? "",
      visitedAt: row.visitedAt,
      nights: row.nights,
      siteName: row.siteName,
      companions: row.companions,
      body: row.body ?? "",
      rating: row.rating,
      createdAt: row.createdAt ?? row.updatedAt ?? new Date().toISOString(),
      updatedAt: row.updatedAt ?? new Date().toISOString(),
    }));
}

export function mergeBundles(local: AccountBundle, remote: AccountBundle): AccountBundle {
  const favMap = new Map<string, SavedCampRef>();
  for (const item of [...remote.favorites, ...local.favorites]) {
    const prev = favMap.get(item.id);
    if (!prev || (item.savedAt || "") >= (prev.savedAt || "")) favMap.set(item.id, item);
  }
  const hideMap = new Map<string, SavedCampRef>();
  for (const item of [...remote.hidden, ...local.hidden]) {
    const prev = hideMap.get(item.id);
    if (!prev || (item.savedAt || "") >= (prev.savedAt || "")) hideMap.set(item.id, item);
  }
  const reviews: Record<string, PersonalReview> = { ...remote.reviews };
  for (const [id, review] of Object.entries(local.reviews)) {
    const prev = reviews[id];
    if (!prev || (review.updatedAt || "") >= (prev.updatedAt || "")) reviews[id] = review;
  }
  const diaryMap = new Map<string, VisitDiaryEntry>();
  for (const item of [...(remote.diary ?? []), ...(local.diary ?? [])]) {
    const prev = diaryMap.get(item.id);
    if (!prev || (item.updatedAt || "") >= (prev.updatedAt || "")) diaryMap.set(item.id, item);
  }
  return {
    favorites: [...favMap.values()],
    hidden: [...hideMap.values()],
    reviews,
    diary: [...diaryMap.values()].sort((a, b) => {
      const byVisit = (b.visitedAt || "").localeCompare(a.visitedAt || "");
      if (byVisit) return byVisit;
      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    }),
  };
}

function toCloudUser(user: User | null): CloudUser | null {
  if (!user) return null;
  return { uid: user.uid, email: user.email, name: user.displayName };
}

export async function bootCloudAuth(): Promise<CloudUser | null> {
  if (!isCloudConfigured()) return null;
  if (!bootPromise) {
    bootPromise = (async () => {
      const { auth } = ensureFirebase();
      await setPersistence(auth, browserLocalPersistence);
      let pendingRedirect = false;
      try {
        pendingRedirect = sessionStorage.getItem("eodicamp.auth.redirect") === "1";
        sessionStorage.removeItem("eodicamp.auth.redirect");
      } catch {
        // ignore
      }
      try {
        const redirected = await getRedirectResult(auth);
        if (redirected?.user) return toCloudUser(redirected.user);
      } catch (error) {
        console.warn("Google redirect 로그인 결과 처리 실패:", error);
        if (pendingRedirect) throw error instanceof Error ? error : new Error("구글 로그인에 실패했습니다.");
      }
      return await new Promise<CloudUser | null>((resolve) => {
        const unsub = onAuthStateChanged(auth, (user) => {
          unsub();
          resolve(toCloudUser(user));
        });
      });
    })();
  }
  return bootPromise;
}

/** 다음 로그인부터 새 세션을 받도록 부트 캐시를 비운다 */
export function resetCloudAuthBoot(): void {
  bootPromise = null;
}

export function getCloudUser(): CloudUser | null {
  if (!auth) return null;
  return toCloudUser(auth.currentUser);
}

function prefersRedirectSignIn(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  // 커스텀 호스팅(camping-kr) ↔ authDomain(firebaseapp.com) 팝업은 3P 쿠키에 자주 막힌다
  const crossAuthHost =
    !location.hostname.endsWith(".firebaseapp.com") && location.hostname !== "localhost";
  return mobile || crossAuthHost;
}

export async function signInWithGoogle(): Promise<CloudUser> {
  const { auth } = ensureFirebase();
  await setPersistence(auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  const startRedirect = async () => {
    try {
      sessionStorage.setItem("eodicamp.auth.redirect", "1");
    } catch {
      // ignore
    }
    await signInWithRedirect(auth, provider);
  };

  if (prefersRedirectSignIn()) {
    await startRedirect();
    throw new Error("구글 로그인 화면으로 이동합니다…");
  }

  try {
    const result = await signInWithPopup(auth, provider);
    return toCloudUser(result.user)!;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";
    if (
      code.includes("popup") ||
      code.includes("cancelled-popup-request") ||
      code.includes("operation-not-supported") ||
      code.includes("unauthorized-domain")
    ) {
      await startRedirect();
      throw new Error("구글 로그인 화면으로 이동합니다…");
    }
    const message =
      code.includes("unauthorized-domain")
        ? "이 도메인이 Firebase 로그인 허용 목록에 없습니다."
        : error instanceof Error
          ? error.message
          : "구글 로그인에 실패했습니다.";
    throw new Error(message);
  }
}

export async function signOutCloud(): Promise<void> {
  if (!isCloudConfigured()) return;
  const { auth } = ensureFirebase();
  await signOut(auth);
}

export async function pullCloudBundle(uid: string): Promise<AccountBundle | null> {
  const { db } = ensureFirebase();
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    favorites: asSavedList(data.favorites),
    hidden: asSavedList(data.hidden),
    reviews: asReviews(data.reviews),
    diary: asDiary(data.diary),
  };
}

export async function pushCloudBundle(uid: string, bundle: AccountBundle, profile?: { email?: string | null; name?: string | null }): Promise<void> {
  const { db } = ensureFirebase();
  await setDoc(
    doc(db, "users", uid),
    {
      favorites: bundle.favorites,
      hidden: bundle.hidden,
      reviews: bundle.reviews,
      diary: bundle.diary,
      email: profile?.email ?? null,
      name: profile?.name ?? null,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

/** 공개 캠핑장 마스터 — Firestore `camps` + `catalog/meta` */
export async function loadCloudCatalog(): Promise<CatalogFile> {
  const { db } = ensureFirebase();
  const [metaSnap, campsSnap] = await Promise.all([
    getDoc(doc(db, "catalog", "meta")),
    getDocs(collection(db, "camps")),
  ]);
  const meta = metaSnap.exists() ? metaSnap.data() : {};
  const byId = new Map<string, Camp>();
  for (const row of campsSnap.docs) {
    const data = row.data() as CampDraft;
    const raw: CampDraft = { ...data, id: row.id, name: data.name ?? row.id };
    if (!raw.name) continue;
    byId.set(raw.id, normalizeCamp(raw));
  }
  if (!byId.size) {
    throw new Error("Firestore camps 컬렉션이 비어 있습니다. npm run catalog:upload 로 올려 주세요.");
  }
  return {
    version: 1,
    updatedAt: String(meta.updatedAt ?? new Date().toISOString().slice(0, 10)),
    note: String(meta.note ?? "Firestore camps"),
    camps: [...byId.values()],
  };
}
