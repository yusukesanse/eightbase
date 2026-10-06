import { resolveUserSummaries } from '@/lib/userSummaries';

function fixture(auth: Record<string, unknown>[], users: Record<string, Record<string, unknown>> = {}) {
  const where = jest.fn((_field, _op, ids: string[]) => ({ get: async () => ({
    docs: auth.filter(a => ids.includes(a.lineUserId as string)).reverse().map(a => ({ data: () => a })),
  }) }));
  const getAll = jest.fn(async (...refs: { id: string }[]) => refs.map(({ id }) => ({ id, exists: !!users[id], data: () => users[id] })));
  const collection = jest.fn(() => ({ where, doc: (id: string) => ({ id }) }));
  return { db: { collection, getAll } as unknown as FirebaseFirestore.Firestore, where, getAll, collection };
}

test('入力順・重複除去・名前の優先順位・ID非公開', async () => {
  const f = fixture([
    { lineUserId: 'U1', active: true, displayName: '管理名' },
    { lineUserId: 'U2', active: true },
    { lineUserId: 'U3', active: true },
  ], { U1: { displayName: '旧名', pictureUrl: 'icon' }, U2: { displayName: 'ユーザー名' }, U3: { lineDisplayName: 'LINE名' } });
  const result = await resolveUserSummaries(f.db, ['U3', 'U1', 'U2', 'U1']);
  expect(result).toEqual([{ name: 'LINE名', pictureUrl: '' }, { name: '管理名', pictureUrl: 'icon' }, { name: 'ユーザー名', pictureUrl: '' }]);
  expect(JSON.stringify(result)).not.toContain('lineUserId');
  expect(f.getAll.mock.calls[0]).toHaveLength(3);
});

test('inactive・認可レコードなし・名前が空の人を除外', async () => {
  const f = fixture([
    { lineUserId: 'inactive', active: false }, { lineUserId: 'unset' },
    { lineUserId: 'empty', active: true, displayName: '  ' },
    { lineUserId: 'named', active: true, displayName: '名前' },
  ], { inactive: { displayName: '非表示' }, missing: { displayName: '非表示' } });
  expect(await resolveUserSummaries(f.db, ['inactive', 'unset', 'empty', 'missing', 'named'])).toEqual([{ name: '名前', pictureUrl: '' }]);
  expect(f.getAll.mock.calls.flat().map(r => r.id)).toEqual(['empty', 'named']);
});

test('空配列ではFirestoreを読まない', async () => {
  const f = fixture([]);
  expect(await resolveUserSummaries(f.db, [])).toEqual([]);
  expect(f.collection).not.toHaveBeenCalled();
});

test.each([31, 301])('%i件を上限内で分割し順序を保つ', async count => {
  const ids = Array.from({ length: count }, (_, i) => `U${i}`);
  const f = fixture(ids.map(id => ({ lineUserId: id, active: true, displayName: `名前${id}` })));
  expect(await resolveUserSummaries(f.db, ids)).toEqual(ids.map(id => ({ name: `名前${id}`, pictureUrl: '' })));
  expect(f.where).toHaveBeenCalledTimes(Math.ceil(count / 30));
  for (const call of f.where.mock.calls) {
    expect(call.slice(0, 2)).toEqual(['lineUserId', 'in']);
    expect(call[2].length).toBeLessThanOrEqual(30);
  }
  expect(f.getAll.mock.calls.length).toBeGreaterThan(1);
  expect(f.getAll.mock.calls.flat().map(r => r.id)).toEqual(ids);
});
