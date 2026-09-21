import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";

/** Google Cloud OAuth 웹 클라이언트 (공개 client_id). redirect_uri가 아니라 JS origin만 필요 */
const GOOGLE_OAUTH_CLIENT_ID =
  String(import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? "").trim() ||
  "820687962490-0hdcuee6i5c7aejar761nv5c84ogque2.apps.googleusercontent.com";

type GisPromptNotification = { isNotDisplayed: () => boolean; isSkippedMoment: () => boolean; getNotDisplayedReason?: () => string };
type GisCredentialResponse = { credential?: string };
type GisTokenResponse = { access_token?: string; error?: string; error_description?: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (res: GisCredentialResponse) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
            use_fedcm_for_prompt?: boolean;
          }) => void;
          prompt: (listener?: (n: GisPromptNotification) => void) => void;
          cancel: () => void;
        };
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (res: GisTokenResponse) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => { requestAccessToken: (override?: { prompt?: string }) => void };
        };
      };
    };
  }
}
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
  const crossAuthHost =
    !location.hostname.endsWith(".firebaseapp.com") && location.hostname !== "localhost";
  return mobile || crossAuthHost;
}

function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("브라우저에서만 로그인할 수 있습니다."));
  if (window.google?.accounts?.id && window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-eodicamp-gsi="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google 로그인 스크립트를 불러오지 못했습니다.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.dataset.eodicampGsi = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google 로그인 스크립트를 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
}

/** GIS ID 토큰 / 액세스 토큰 → Firebase 세션 (__/auth/handler redirect_uri 불필요) */
async function signInWithGoogleIdentity(auth: Auth): Promise<CloudUser> {
  await loadGoogleIdentityScript();
  if (!window.google?.accounts) throw new Error("Google 로그인을 초기화하지 못했습니다.");

  // 1) One Tap / FedCM — 모바일·Safari에서 redirect_uri_mismatch를 피할 수 있음
  try {
    const idToken = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error, token?: string) => {
        if (settled) return;
        settled = true;
        try {
          window.google?.accounts.id.cancel();
        } catch {
          // ignore
        }
        if (err) reject(err);
        else resolve(token!);
      };
      const timer = window.setTimeout(() => finish(new Error("구글 로그인 대기 시간이 지났습니다.")), 45_000);
      window.google!.accounts.id.initialize({
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        auto_select: false,
        cancel_on_tap_outside: true,
        use_fedcm_for_prompt: true,
        callback: (res) => {
          window.clearTimeout(timer);
          if (res.credential) finish(undefined, res.credential);
          else finish(new Error("구글 로그인 토큰이 없습니다."));
        },
      });
      window.google!.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          window.clearTimeout(timer);
          finish(new Error(notification.getNotDisplayedReason?.() || "구글 로그인 창을 띄우지 못했습니다."));
        }
      });
    });
    const cred = GoogleAuthProvider.credential(idToken);
    const result = await signInWithCredential(auth, cred);
    return toCloudUser(result.user)!;
  } catch {
    // One Tap 실패 시 토큰 클라이언트로 재시도
  }

  // 2) OAuth 토큰 클라이언트 (팝업/계정 선택)
  const accessToken = await new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      scope: "openid email profile",
      prompt: "select_account",
      callback: (res) => {
        if (res.error) reject(new Error(res.error_description || res.error));
        else if (res.access_token) resolve(res.access_token);
        else reject(new Error("구글 액세스 토큰이 없습니다."));
      },
      error_callback: (err) => reject(new Error(err?.message || "구글 로그인이 취소되었습니다.")),
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
  const cred = GoogleAuthProvider.credential(null, accessToken);
  const result = await signInWithCredential(auth, cred);
  return toCloudUser(result.user)!;
}

export async function signInWithGoogle(): Promise<CloudUser> {
  const { auth } = ensureFirebase();
  await setPersistence(auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  // 모바일/커스텀 도메인: Firebase redirect(/__/auth/handler) 대신 GIS 사용
  // (redirect_uri_mismatch · 3P 쿠키 이슈 회피). JS origin에 camping-kr.web.app 필요.
  if (prefersRedirectSignIn()) {
    try {
      return await signInWithGoogleIdentity(auth);
    } catch (gisError) {
      console.warn("Google Identity 로그인 실패, popup으로 재시도:", gisError);
      try {
        const result = await signInWithPopup(auth, provider);
        return toCloudUser(result.user)!;
      } catch (popupError) {
        const message = popupError instanceof Error ? popupError.message : String(popupError);
        const gisMessage = gisError instanceof Error ? gisError.message : String(gisError);
        throw new Error(
          `구글 로그인에 실패했습니다. Google Cloud → 클라이언트 → Authorized JavaScript origins에 https://${location.hostname} 이 있는지 확인해 주세요. (${gisMessage || message})`
        );
      }
    }
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
      try {
        return await signInWithGoogleIdentity(auth);
      } catch {
        // last resort: classic redirect
      }
      try {
        sessionStorage.setItem("eodicamp.auth.redirect", "1");
      } catch {
        // ignore
      }
      await signInWithRedirect(auth, provider);
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
