import { NextRequest } from 'next/server';
import { GET as postsGET } from '@/app/api/posts/[id]/likes/route';
import { GET as eventsGET } from '@/app/api/events/[eventId]/goods/route';
import { requireMember } from '@/lib/auth';
import { getDb } from '@/lib/firebaseAdmin';

jest.mock('@/lib/auth', () => ({ requireMember: jest.fn() }));
jest.mock('@/lib/firebaseAdmin', () => ({ getDb: jest.fn() }));

const auth = jest.mocked(requireMember);
const read = jest.fn();
const goodsRead = jest.fn();
const orderBy = jest.fn(() => ({ get: goodsRead }));
const subcollection = jest.fn(() => ({ orderBy }));
let authorizedUsers = [{ lineUserId: 'U_PRIVATE', active: true, displayName: '名前' }];
const collection = jest.fn((name: string) => name === 'authorizedUsers' ? {
  where: () => ({ get: async () => ({ docs: authorizedUsers.map(user => ({ data: () => user })) }) }),
} : { doc: (id: string) => ({ id, get: read, collection: subcollection }) });

beforeEach(() => {
  jest.clearAllMocks();
  authorizedUsers = [{ lineUserId: 'U_PRIVATE', active: true, displayName: '名前' }];
  auth.mockResolvedValue('viewer');
  read.mockResolvedValue({ exists: true, data: () => ({ published: true, likes: ['U_PRIVATE', 'U_INACTIVE'] }) });
  goodsRead.mockResolvedValue({ docs: ['U_PRIVATE', 'U_INACTIVE'].map(userId => ({ data: () => ({ userId }) })) });
  jest.mocked(getDb).mockReturnValue({ collection, getAll: async () => [{ id: 'U_PRIVATE', exists: true, data: () => ({ pictureUrl: 'icon' }) }] } as unknown as FirebaseFirestore.Firestore);
});

const routes = [
  ['posts', () => postsGET(new NextRequest('https://example.test/api/posts/p/likes'), { params: Promise.resolve({ id: 'p' }) })],
  ['events', () => eventsGET(new NextRequest('https://example.test/api/events/e/goods'), { params: Promise.resolve({ eventId: 'e' }) })],
] as const;

describe.each(routes)('%s', (_name, get) => {
  test('非会員は401・DBを読まない', async () => {
    auth.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });
  test('存在しなければ404', async () => {
    read.mockResolvedValue({ exists: false });
    expect((await get()).status).toBe(404);
    expect(subcollection).not.toHaveBeenCalled();
  });
  test('名前とアイコンのみ・解決後の件数・no-store', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({ users: [{ name: '名前', pictureUrl: 'icon' }], count: 1 });
    expect(JSON.stringify(body)).not.toMatch(/lineUserId|U_PRIVATE|U_INACTIVE/);
  });
});

test.each([false, undefined])('非公開イベント(%s)は404・goodsを読まない', async published => {
  read.mockResolvedValue({ exists: true, data: () => ({ published }) });
  expect((await routes[1][1]()).status).toBe(404);
  expect(subcollection).not.toHaveBeenCalled();
});
test('goodsをcreatedAt降順で取得', async () => {
  await routes[1][1]();
  expect(subcollection).toHaveBeenCalledWith('goods');
  expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
});

test.each(routes)('%s: 新しいいいねから名前を返す', async (name, get) => {
  authorizedUsers = [
    { lineUserId: 'old', active: true, displayName: '古い人' },
    { lineUserId: 'new', active: true, displayName: '新しい人' },
  ];
  read.mockResolvedValue({ exists: true, data: () => ({ published: true, likes: ['old', 'new'] }) });
  goodsRead.mockResolvedValue({ docs: ['new', 'old'].map(userId => ({ data: () => ({ userId }) })) });
  expect(await (await get()).json()).toEqual({
    users: [{ name: '新しい人', pictureUrl: '' }, { name: '古い人', pictureUrl: '' }], count: 2,
  });
  if (name === 'events') expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
});

test.each([undefined, null, 'U_PRIVATE', 1, { userId: 'U_PRIVATE' }])('posts: 配列でないlikes(%p)は空一覧', async likes => {
  read.mockResolvedValue({ exists: true, data: () => ({ likes }) });
  const res = await routes[0][1]();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ users: [], count: 0 });
});

test.each(routes)('%s: 取得失敗時に原因を記録して500を返す', async (name, get) => {
  const error = new Error('read failed');
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    read.mockRejectedValueOnce(error);
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'いいねした人の取得に失敗しました' });
    expect(log).toHaveBeenCalledWith(name === 'posts' ? '[posts/likes] Error:' : '[events/goods] Error:', error);
  } finally {
    log.mockRestore();
  }
});
