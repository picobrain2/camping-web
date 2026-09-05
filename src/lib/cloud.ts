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
import { doc, getDoc, getFirestore, setDoc, type Firestore } from "firebase/firestore";
import type { AccountBundle, PersonalReview, SavedCampRef, VisitDiaryEntry } from "../types";

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

function readConfig(): FirebaseWebConfig | null {
  const apiKey = String(env.VITE_FIREBASE_API_KEY ?? "").trim();
  const authDomain = String(env.VITE_FIREBASE_AUTH_DOMAIN ?? "").trim();
  const projectId = String(env.VITE_FIREBASE_PROJECT_ID ?? "").trim();
  const appId = String(env.VITE_FIREBASE_APP_ID ?? "").trim();
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain,
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
      try {
        await getRedirectResult(auth);
      } catch {
        // redirect 결과가 없거나 취소된 경우
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

export function getCloudUser(): CloudUser | null {
  if (!auth) return null;
  return toCloudUser(auth.currentUser);
}

export async function signInWithGoogle(): Promise<CloudUser> {
  const { auth } = ensureFirebase();
  await setPersistence(auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const result = await signInWithPopup(auth, provider);
    return toCloudUser(result.user)!;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";
    // 모바일/인앱 브라우저는 팝업이 막히는 경우가 많아 redirect로 재시도
    if (
      code.includes("popup") ||
      code.includes("cancelled-popup-request") ||
      code.includes("operation-not-supported")
    ) {
      await signInWithRedirect(auth, provider);
      throw new Error("구글 로그인 화면으로 이동합니다…");
    }
    throw error instanceof Error ? error : new Error("구글 로그인에 실패했습니다.");
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
