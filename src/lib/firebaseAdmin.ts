import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import { assertEnvConsistency } from "./env";

let app: App;
let db: Firestore;
let storage: Storage;

function getAdminApp(): App {
  if (app) return app;

  // 環境変数の取り違え（demo に本番値が混入 等）を初期化前に検知して止める。
  // 本番 Firestore へ誤って接続する前の最後の砦。
  assertEnvConsistency();

  if (getApps().length > 0) {
    app = getApps()[0];
    return app;
  }

  app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel の環境変数では改行が \n になるため replace が必要
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });

  return app;
}

export function getDb(): Firestore {
  if (db) return db;
  getAdminApp();
  db = getFirestore();
  // undefined のフィールドを書き込み時に無視（任意項目が undefined でも例外にしない）
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // 既に settings 済みの場合は無視
  }
  return db;
}

/**
 * 全アクティブユーザーの lineUserId を取得
 */
export async function getAllActiveLineUserIds(): Promise<string[]> {
  const snap = await getDb()
    .collection("authorizedUsers")
    .where("active", "==", true)
    .get();

  return snap.docs
    .map((doc) => doc.data().lineUserId as string | undefined)
    .filter((id): id is string => !!id);
}

export function getBucket() {
  if (!storage) {
    getAdminApp();
    storage = getStorage();
  }
  return storage.bucket();
}
