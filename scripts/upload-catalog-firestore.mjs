/**
 * public/data JSON → Firestore camps/{id} + catalog/meta
 * (클라이언트 SDK · 업로드 중에만 camps/catalog write 규칙 열기)
 *
 *   npm run catalog:upload
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase/app";
import { collection, doc, getDocs, getFirestore, writeBatch } from "firebase/firestore";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "public/data");
const envPath = join(ROOT, ".env.local");

function loadEnv() {
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

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

async function main() {
  const env = loadEnv();
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  const db = getFirestore(app);
  const { updatedAt, note, camps } = loadCamps();
  console.log(`project=${env.VITE_FIREBASE_PROJECT_ID} camps=${camps.length}`);

  // existing ids not in seed → leave (no delete) to be safe
  const CHUNK = 400;
  for (let i = 0; i < camps.length; i += CHUNK) {
    const slice = camps.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const camp of slice) {
      batch.set(doc(db, "camps", camp.id), camp, { merge: true });
    }
    await batch.commit();
    console.log(`uploaded ${Math.min(i + slice.length, camps.length)}/${camps.length}`);
  }

  await writeBatch(db)
    .set(
      doc(db, "catalog", "meta"),
      {
        updatedAt,
        note,
        count: camps.length,
        source: "json-packs",
        uploadedAt: new Date().toISOString(),
      },
      { merge: true }
    )
    .commit();

  const snap = await getDocs(collection(db, "camps"));
  console.log(`done: firestore camps=${snap.size}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
