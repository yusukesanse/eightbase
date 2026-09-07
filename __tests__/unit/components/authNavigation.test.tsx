/** @jest-environment jsdom */
import React, { useEffect, useState } from 'react';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';

let mockPath = '/';
let mockRole = 'guest';
let mockProfileComplete = false;
let mockListeners = new Set<() => void>();
let mockTransitions: string[] = [];
let mockRequests: string[] = [];
let mockAuthorized = true;
let mockAuthFailure = false;
let mockProfileStatus = 200;
let mockProfileNetworkFailure = false;
let mockLoginStatus = 200;
let mockProtectedMounts: string[] = [];
const mockRouter = {
  replace: (path: string) => {
    // Stop the real components after six redirects, so a faulty loop cannot run forever.
    if (mockTransitions.length >= 6) return;
    mockTransitions.push(path);
    window.history.replaceState({}, '', path);
    mockPath = window.location.pathname;
    mockListeners.forEach(fn => fn());
  },
};
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPath,
}));
jest.mock('next/image', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/env', () => ({ isDevLoginEnabled: () => false }));
jest.mock('@line/liff', () => ({
  __esModule: true,
  default: {
    init: async () => {},
    isLoggedIn: () => true,
    isInClient: () => true,
    getAccessToken: () => 'synthetic-investigation-token',
    getProfile: async () => ({ userId: 'investigation-user', displayName: 'Test' }),
  },
}));

import HomePage from '@/app/page';
import LoginPage from '@/app/login/page';
import SetupProfilePage from '@/app/setup-profile/page';
import { AuthGuard, clearAuthCache } from '@/components/AuthGuard';

function ProtectedPage() {
  useEffect(() => { mockProtectedMounts.push(mockPath); }, []);
  return <div>{mockPath}</div>;
}

function Harness() {
  const [, update] = useState(0);
  useEffect(() => {
    const changed = () => update(n => n + 1);
    mockListeners.add(changed);
    return () => { mockListeners.delete(changed); };
  }, []);
  const page = mockPath === '/' ? <HomePage />
    : mockPath === '/login' ? <LoginPage />
    : mockPath === '/setup-profile' ? <SetupProfilePage />
    : <ProtectedPage />;
  return <AuthGuard>{page}</AuthGuard>;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_LIFF_ID_PROD = 'test-investigation';
  window.history.replaceState({}, '', '/');
  mockAuthorized = true;
  mockAuthFailure = false;
  mockProfileStatus = 200;
  mockProfileNetworkFailure = false;
  mockLoginStatus = 200;
  mockProtectedMounts = [];
  mockPath = '/';
  mockRole = 'guest';
  mockProfileComplete = false;
  mockTransitions = [];
  mockRequests = [];
  mockListeners.clear();
  clearAuthCache();
  global.fetch = jest.fn(async (input) => {
    const url = String(input);
    mockRequests.push(url);
    let status = 200;
    let body: unknown;
    if (url === '/api/auth/liff-login') {
      // API response shape is also covered by liffLoginPendingRequest.test.ts.
      status = mockLoginStatus;
      body = status === 200 ? { success: true, role: mockRole, lineUserId: 'investigation-user', profileComplete: mockProfileComplete } : { error: 'ログインに失敗しました' };
    } else if (url === '/api/auth/profile') {
      // Actual API uses requireMember(), which refuses a guest with 401.
      if (mockProfileNetworkFailure) throw new Error('Offline');
      status = mockRole === 'guest' ? 401 : mockProfileStatus;
      body = status === 401 ? { error: '認証が必要です' }
        : { role: mockRole, profileComplete: mockProfileComplete, profile: {} };
    } else if (url === '/api/auth/check') {
      if (mockAuthFailure) throw new Error('Offline');
      body = { authorized: mockAuthorized, lineUserId: 'investigation-user', role: mockRole, profileComplete: mockProfileComplete };
    } else { throw new Error('Unexpected fetch: ' + url); }
    return { ok: status === 200, status, json: async () => body } as Response;
  });
});
afterEach(() => cleanup());

test('guest entry reaches games once, including React StrictMode effect replay', async () => {
  const page = render(<React.StrictMode><Harness /></React.StrictMode>);
  await waitFor(() => expect(page.getByText('/games')).toBeTruthy());
  expect(mockTransitions).toEqual(['/games']);
  expect(mockRequests.filter(x => x === '/api/auth/liff-login')).toHaveLength(1);
  expect(mockRequests).not.toContain('/api/auth/profile');
});

test.each(['/', '/login'])('guest with no member profile can enter through %s', async (entry) => {
  mockPath = entry;
  const page = render(<Harness />);
  await waitFor(() => expect(page.getByText('/games')).toBeTruthy());
  expect(mockTransitions).toEqual(['/games']);
  expect(mockRequests).not.toContain('/api/auth/profile');
});

test('guest entering profile URL is redirected before profile component mounts', async () => {
  mockPath = '/setup-profile';
  const page = render(<Harness />);
  await waitFor(() => expect(page.getByText('/games')).toBeTruthy());
  expect(mockTransitions).toEqual(['/games']);
  expect(mockRequests).not.toContain('/api/auth/profile');
});

test('guest can enter games directly', async () => {
  mockPath = '/games';
  const page = render(<Harness />);
  await waitFor(() => expect(page.getByText('/games')).toBeTruthy());
  expect(mockTransitions).toEqual([]);
});

test('guest with profileComplete true also goes directly to games', async () => {
  mockProfileComplete = true;
  const page = render(<Harness />);
  await waitFor(() => expect(page.getByText('/games')).toBeTruthy());
  expect(mockTransitions).toEqual(['/games']);
});

test.each(['member', 'staff'])('%s with incomplete profile can finish onboarding', async (role) => {
  mockRole = role;
  const page = render(<Harness />);
  await waitFor(() => expect(page.container.querySelector('input')).toBeTruthy());
  expect(mockPath).toBe('/setup-profile');
  expect(mockTransitions).toEqual(['/setup-profile']);
});

test.each(['member', 'staff'])('%s with complete profile reaches reservation', async (role) => {
  mockRole = role;
  mockProfileComplete = true;
  const page = render(<Harness />);
  await waitFor(() => expect(page.getByText('/reservation')).toBeTruthy());
  expect(mockTransitions).toEqual(['/reservation']);
});

test('missing session after successful LINE login stops instead of logging in again automatically', async () => {
  mockAuthorized = false;
  const page = render(<Harness />);
  await waitFor(() => expect(page.getByRole('button', { name: 'ログインする' })).toBeTruthy());
  expect(mockTransitions).toEqual(['/games']);
  expect(mockRequests.filter(x => x === '/api/auth/liff-login')).toHaveLength(1);
  expect(page.queryByText('/games')).toBeNull();
  // A retry is an explicit user action; a second failure also stops.
  fireEvent.click(page.getByRole('button', { name: 'ログインする' }));
  await waitFor(() => expect(mockRequests.filter(x => x === '/api/auth/liff-login')).toHaveLength(2));
  await waitFor(() => expect(page.getByRole('button', { name: 'ログインする' })).toBeTruthy());
  expect(mockTransitions).toEqual(['/games', '/login', '/games']);
  expect(mockProtectedMounts).toEqual([]); // 再ログイン失敗時も保護ページを一瞬表示しない
});

test('auth connection failure stays on the same page and retries when requested', async () => {
  mockPath = '/games';
  mockAuthFailure = true;
  const page = render(<Harness />);
  await waitFor(() => expect(page.getByRole('alert')).toBeTruthy());
  expect(mockTransitions).toEqual([]);
  expect(mockRequests).toEqual(['/api/auth/check']);
  mockAuthFailure = false;
  fireEvent.click(page.getByRole('button', { name: 'もう一度試す' }));
  await waitFor(() => expect(page.getByText('/games')).toBeTruthy());
  expect(mockRequests).toEqual(['/api/auth/check', '/api/auth/check']);
});

test.each([401, 403, 500])('profile HTTP %s never sends the user into automatic login', async (status) => {
  mockRole = 'member';
  mockProfileStatus = status;
  const page = render(<Harness />);
  await waitFor(() => expect(page.getByText('プロフィールを読み込めませんでした')).toBeTruthy());
  expect(mockTransitions).toEqual(['/setup-profile']);
  expect(mockRequests.filter(x => x === '/api/auth/profile')).toHaveLength(1);
  expect(page.container.querySelector('input')).toBeNull();
});

test('profile connection failure retries without changing pages', async () => {
  mockRole = 'staff';
  mockProfileNetworkFailure = true;
  const page = render(<Harness />);
  await waitFor(() => expect(page.getByRole('alert')).toBeTruthy());
  mockProfileNetworkFailure = false;
  fireEvent.click(page.getByRole('button', { name: 'もう一度試す' }));
  await waitFor(() => expect(page.container.querySelector('input')).toBeTruthy());
  expect(mockTransitions).toEqual(['/setup-profile']);
  expect(mockRequests.filter(x => x === '/api/auth/profile')).toHaveLength(2);
});

test.each(['/', '/login'])('login failure at %s shows recovery and can be retried', async (path) => {
  mockPath = path;
  mockLoginStatus = 500;
  const page = render(<Harness />);
  await waitFor(() => expect(page.getByRole('alert')).toBeTruthy());
  expect(mockTransitions).toEqual([]);
  expect(mockRequests).toEqual(['/api/auth/liff-login']);
  mockLoginStatus = 200;
  fireEvent.click(page.getByRole('button', { name: 'もう一度試す' }));
  await waitFor(() => expect(page.getByText('/games')).toBeTruthy());
  expect(mockTransitions).toEqual(['/games']);
});

test('game payment return survives explicit reauthentication', async () => {
  mockPath = '/games';
  window.history.replaceState({}, '', '/games?dartspay=entry123');
  mockAuthorized = false;
  const page = render(<Harness />);
  await waitFor(() => expect(page.getByRole('button', { name: 'ログインする' })).toBeTruthy());
  mockAuthorized = true;
  fireEvent.click(page.getByRole('button', { name: 'ログインする' }));
  await waitFor(() => expect(page.getByText('/games')).toBeTruthy());
  expect(mockTransitions).toEqual(['/login?dartspay=entry123', '/games?dartspay=entry123']);
});
