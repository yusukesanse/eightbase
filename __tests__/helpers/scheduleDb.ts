import { FieldValue } from "firebase-admin/firestore";
type Data = Record<string, unknown>;

/** トランザクション（tx.get で docRef と where クエリの両方を扱う）に対応する簡易 Firestore。 */
export function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  const reads: string[] = [];
  const col = (n: string) => {
    if (!store.has(n)) store.set(n, new Map());
    return store.get(n)!;
  };
  const docRef = (c: string, id: string) => ({
    __kind: "doc" as const,
    __c: c,
    id,
    get: async () => ({ exists: col(c).has(id), id, data: () => col(c).get(id) }),
    set: async (d: Data, opt?: { merge?: boolean }) => {
      col(c).set(id, opt?.merge ? { ...(col(c).get(id) ?? {}), ...d } : { ...d });
    },
    delete: async () => {
      col(c).delete(id);
    },
  });
  const query = (c: string, conds: [string, unknown][]) => ({
    __kind: "query" as const,
    __c: c,
    __conds: conds,
    where: (f: string, _op: string, v: unknown) => query(c, [...conds, [f, v]]),
    get: async () => {
      reads.push(c);
      const docs = [...col(c).entries()]
        .filter(([, v]) => conds.every(([f, val]) => v[f] === val))
        .map(([id, v]) => ({ id, exists: true, data: () => v }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  type Ref = ReturnType<typeof docRef> | ReturnType<typeof query>;
  const db = {
    collection: (c: string) => ({
      doc: (id: string) => docRef(c, id),
      where: (f: string, _op: string, v: unknown) => query(c, [[f, v]]),
    }),
    batch: () => {
      const ops: (() => void)[] = [];
      return {
        set: (ref: ReturnType<typeof docRef>, data: Data, opt?: { merge?: boolean }) => ops.push(() => { col(ref.__c).set(ref.id, opt?.merge ? { ...col(ref.__c).get(ref.id), ...data } : data); }),
        delete: (ref: ReturnType<typeof docRef>) => ops.push(() => { col(ref.__c).delete(ref.id); }),
        commit: async () => { ops.forEach((op) => op()); },
      };
    },
    runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
      const writes: [string, string, Data, boolean][] = [];
      const deletes: ReturnType<typeof docRef>[] = [];
      const tx = {
        delete: (ref: ReturnType<typeof docRef>) => deletes.push(ref),
        create: (ref: ReturnType<typeof docRef>, d: Data) => writes.push([ref.__c, ref.id, d, false]),
        update: (ref: ReturnType<typeof docRef>, d: Data) => writes.push([ref.__c, ref.id, d, true]),
        get: async (ref: Ref) => ref.get(),
        set: (ref: ReturnType<typeof docRef>, d: Data, opt?: { merge?: boolean }) => {
          writes.push([ref.__c, ref.id, d, !!opt?.merge]);
        },
      };
      await fn(tx);
      deletes.forEach((ref) => col(ref.__c).delete(ref.id));
      // 例外が出たら writes は捨てる＝ロールバック相当。
      writes.forEach(([c, id, d, merge]) => {
        const saved = merge ? { ...(col(c).get(id) ?? {}), ...d } : { ...d };
        for (const [field, value] of Object.entries(d)) {
          if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) {
            if (!merge) throw new Error("FieldValue.delete requires merge");
            delete saved[field];
          }
        }
        col(c).set(id, saved);
      });
    },
    __set: (c: string, id: string, d: Data) => col(c).set(id, d),
    __get: (c: string, id: string) => col(c).get(id),
    __reads: reads,
    __size: (c: string) => col(c).size,
  };
  return db;
}

