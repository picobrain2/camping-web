/**
 * public/data JSON 팩 → Firestore camps/{id} + catalog/meta
 *
 * 인증 (우선순위):
 *   1. FIREBASE_SERVICE_ACCOUNT  — 서비스 계정 JSON 문자열 (CI 권장)
 *   2. FIREBASE_TOKEN / firebase login — firebase-tools ADC
 *
 *   npm run catalog:upload
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "public/data");
const PROJECT = process.env.FIREBASE_PROJECT || process.env.GCLOUD_PROJECT || "camping-cf64d";

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

function loadCamps() {
  const index = JSON.parse(readFileSync(join(DATA, "index.json"), "utf8"));
  const byId = new Map();
  for (const pack of index.packs) {
    const payload = JSON.parse(readFileSync(join(DATA, pack), "utf8"));
    for (const camp of payload.camps ?? []) {
      if (!camp?.id || byId.has(camp.id)) continue;
      byId.set(camp.id, stripUndefined(camp));
    }
  }
  return {
    updatedAt: index.updatedAt ?? new Date().toISOString().slice(0, 10),
    note: index.note ?? "Firestore camps collection",
    camps: [...byId.values()],
  };
}

async function initAdmin() {
  if (getApps().length) return getFirestore();

  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (saRaw) {
    const sa = JSON.parse(saRaw);
    initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT });
    return getFirestore();
  }

  const token = process.env.FIREBASE_TOKEN?.trim();
  if (token) {
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const api = require("firebase-tools/lib/api.js");
    const dir = mkdtempSync(join(tmpdir(), "fb-adc-"));
    const credPath = join(dir, "adc.json");
    writeFileSync(
      credPath,
      JSON.stringify({
        type: "authorized_user",
        client_id: api.clientId(),
        client_secret: api.clientSecret(),
        refresh_token: token,
      })
    );
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
    initializeApp({ credential: applicationDefault(), projectId: PROJECT });
    return getFirestore();
  }

  const { getGlobalDefaultAccount } = require("firebase-tools/lib/auth.js");
  const { getCredentialPathAsync } = require("firebase-tools/lib/defaultCredentials.js");
  const account = getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) {
    throw new Error(
      "Firestore 업로드 인증이 없습니다. CI는 FIREBASE_SERVICE_ACCOUNT 또는 FIREBASE_TOKEN Secret을, 로컬은 `npx firebase login`을 사용하세요."
    );
  }

  const credPath = await getCredentialPathAsync(account);
  if (!credPath) throw new Error("firebase-tools ADC 파일을 만들지 못했습니다.");
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
  initializeApp({ credential: applicationDefault(), projectId: PROJECT });
  return getFirestore();
}

async function main() {
  const db = await initAdmin();
  const { updatedAt, note, camps } = loadCamps();

  const CHUNK = 400;
  const openCamps = camps.filter((c) => !c.closed);
  const closedIds = camps.filter((c) => c.closed).map((c) => c.id);
  console.log(`project=${PROJECT} open=${openCamps.length} closed=${closedIds.length}`);

  for (let i = 0; i < openCamps.length; i += CHUNK) {
    const slice = openCamps.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const camp of slice) {
      batch.set(db.collection("camps").doc(camp.id), camp, { merge: true });
    }
    await batch.commit();
    console.log(`uploaded ${Math.min(i + slice.length, openCamps.length)}/${openCamps.length}`);
  }

  for (let i = 0; i < closedIds.length; i += CHUNK) {
    const slice = closedIds.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const id of slice) batch.delete(db.collection("camps").doc(id));
    await batch.commit();
    console.log(`deleted closed ${Math.min(i + slice.length, closedIds.length)}/${closedIds.length}`);
  }

  await db.collection("catalog").doc("meta").set(
    {
      updatedAt,
      note,
      count: openCamps.length,
      closedCount: closedIds.length,
      source: "json-packs",
      uploadedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  console.log(`done: ${openCamps.length} open camps → Firestore (closed removed ${closedIds.length})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
