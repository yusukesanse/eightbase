import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";

let app: App;
let db: Firestore;
let storage: Storage;

function getAdminApp(): App {
  if (app) return app;

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
