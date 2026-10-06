/** @jest-environment jsdom */
import { Profiler } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LikersSheet } from '@/components/LikersSheet';

const fetchMock = jest.fn();
beforeEach(() => { fetchMock.mockReset(); global.fetch = fetchMock; });
const props = { onClose: jest.fn(), fetchUrl: '/api/posts/p/likes' };
test('閉じている間は取得せず、開くたびにno-storeで再取得', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ users: [{ name: '太郎', pictureUrl: '' }] }) });
  const { rerender } = render(<LikersSheet {...props} open={false} />);
  expect(fetchMock).not.toHaveBeenCalled();
  rerender(<LikersSheet {...props} open />);
  expect(screen.getByText('読み込み中…')).toBeTruthy();
  await screen.findByText('太郎');
  expect(fetchMock).toHaveBeenCalledWith(props.fetchUrl, expect.objectContaining({ cache: 'no-store' }));
  fireEvent.click(screen.getByLabelText('閉じる'));
  expect(props.onClose).toHaveBeenCalled();
  rerender(<LikersSheet {...props} open={false} />);
  rerender(<LikersSheet {...props} open />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});
test('空表示', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ users: [] }) });
  render(<LikersSheet {...props} open />);
  await screen.findByText('表示できる人はいません');
});
test.each(['http', 'network'])('取得失敗(%s)を表示', async kind => {
  if (kind === 'http') fetchMock.mockResolvedValue({ ok: false });
  else fetchMock.mockRejectedValue(new Error('offline'));
  render(<LikersSheet {...props} open />);
  await screen.findByRole('alert');
});
test('URL切替前の遅いレスポンスで現在の一覧を上書きしない', async () => {
  let finish!: (value: unknown) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ users: [{ name: '新しい人', pictureUrl: '' }] }) });
  const { rerender } = render(<LikersSheet {...props} open />);
  rerender(<LikersSheet {...props} fetchUrl='/api/posts/other/likes' open />);
  await screen.findByText('新しい人');
  finish({ ok: true, json: async () => ({ users: [{ name: '古い人', pictureUrl: '' }] }) });
  await waitFor(() => expect(screen.queryByText('古い人')).toBeNull());
});

test.each(['users', 'error'])('再オープンの初回描画に前回の状態(%s)を表示しない', async state => {
  fetchMock.mockResolvedValueOnce(state === 'users'
    ? { ok: true, json: async () => ({ users: [{ name: '前回の名前', pictureUrl: '' }] }) }
    : { ok: false });
  fetchMock.mockImplementation(() => new Promise(() => {}));
  const frames: string[] = [];
  const sheet = (open: boolean) => (
    <Profiler id="likers" onRender={() => { if (open) frames.push(document.body.textContent ?? ''); }}>
      <LikersSheet {...props} open={open} />
    </Profiler>
  );
  const { rerender } = render(sheet(true));
  if (state === 'users') await screen.findByText('前回の名前');
  else await screen.findByRole('alert');
  rerender(sheet(false));
  frames.length = 0;
  rerender(sheet(true));
  expect(frames.length).toBeGreaterThan(0);
  expect(frames[0]).toContain('読み込み中…');
  expect(frames[0]).not.toContain('前回の名前');
  expect(frames[0]).not.toContain('読み込めませんでした');
});
