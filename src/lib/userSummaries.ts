export interface UserSummary {
  name: string;
  pictureUrl: string;
}

const CHUNK_SIZE = 30;
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

/** 対象の active 利用者だけを読み、入力順で公開用の名前・アイコンを返す。 */
export async function resolveUserSummaries(
  db: FirebaseFirestore.Firestore,
  lineUserIds: string[],
): Promise<UserSummary[]> {
  const ids = [...new Set(lineUserIds.filter(id => typeof id === "string" && id.length > 0))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const snap = await db.collection("authorizedUsers")
      .where("lineUserId", "in", ids.slice(i, i + CHUNK_SIZE)).get();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.active === true && !names.has(data.lineUserId)) {
        names.set(data.lineUserId, text(data.displayName));
      }
    }
  }

  const activeIds = ids.filter(id => names.has(id));
  const profiles = new Map<string, FirebaseFirestore.DocumentData>();
  for (let i = 0; i < activeIds.length; i += CHUNK_SIZE) {
    const docs = await db.getAll(...activeIds.slice(i, i + CHUNK_SIZE).map(id => db.collection("users").doc(id)));
    for (const doc of docs) {
      if (doc.exists) profiles.set(doc.id, doc.data() ?? {});
    }
  }
  return activeIds.map(id => {
    const profile = profiles.get(id);
    return {
      name: names.get(id) || text(profile?.displayName) || text(profile?.lineDisplayName),
      pictureUrl: text(profile?.pictureUrl),
    };
  }).filter(user => user.name !== "");
}
