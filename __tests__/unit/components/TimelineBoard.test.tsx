/** @jest-environment jsdom */
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TimelineBoard } from '@/components/TimelineBoard';

const router = { replace: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => router }));
const fetchMock = jest.fn();
beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  global.fetch = fetchMock;
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/posts') return { ok: true, json: async () => [{
      postId: 'p', authorId: 'author', authorName: '投稿者', authorPictureUrl: '',
      authorLineUrl: '', type: 'offer', content: 'テスト投稿の本文', tags: [],
      likes: ['liker'], commentCount: 0, createdAt: '2026-10-06T00:00:00Z',
    }] };
    if (url === '/api/auth/check') return { ok: true, json: async () => ({ lineUserId: 'viewer' }) };
    if (url === '/api/posts/p/likes') return { ok: true, json: async () => ({ users: [{ name: 'いいねした会員', pictureUrl: '' }], count: 1 }) };
    throw new Error(`Unexpected URL: ${url}`);
  });
});

test('詳細から一覧を開いてEscapeを押すと一覧だけ閉じて詳細が残る', async () => {
  render(<TimelineBoard />);
  fireEvent.click(await screen.findByText('テスト投稿の本文'));
  const detail = screen.getByRole('dialog');
  expect(within(detail).getByText('投稿の詳細')).toBeInTheDocument();
  fireEvent.click(within(detail).getByRole('button', { name: 'いいねした人を見る' }));
  await screen.findByText('いいねした会員');
  expect(screen.getAllByRole('dialog')).toHaveLength(2);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByText('いいねした人')).not.toBeInTheDocument();
  expect(screen.queryByText('いいねした会員')).not.toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBe(detail);
  expect(within(detail).getByText('テスト投稿の本文')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
