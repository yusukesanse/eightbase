/** @jest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ReservationPage from '@/app/reservation/page';
import type { Facility } from '@/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/reservation',
}));
// 規約表示は今回の対象外。Jest の CommonJS 環境で ESM を読み込まない。
jest.mock('react-markdown', () => ({ __esModule: true, default: () => null }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));

const facility: Facility = {
  id: 'footer-test-room',
  name: 'テスト会議室',
  type: 'meeting_room',
  capacity: 4,
  calendarId: '',
  openTime: '09:00',
  closeTime: '18:00',
  availableDays: [0, 1, 2, 3, 4, 5, 6],
  minAdvanceDays: 0,
};
const originalFetch = global.fetch;
let testFacility: Facility;

beforeEach(() => {
  testFacility = facility;
  jest.useFakeTimers({ now: new Date('2026-09-25T00:00:00Z') });
  sessionStorage.clear();
  global.fetch = jest.fn(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    let body: unknown;
    switch (url.pathname) {
      case '/api/facilities':
        body = { facilities: [testFacility] };
        break;
      case '/api/reservations/week-availability':
        body = { '2026-09-28': [] };
        break;
      case '/api/reservations/availability':
        body = { bookedSlots: [] };
        break;
      case '/api/reservations/companions':
        body = { candidates: [] };
        break;
      default:
        throw new Error(`Unexpected fetch: ${url.pathname}`);
    }
    return { ok: true, status: 200, json: async () => body } as Response;
  });
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  global.fetch = originalFetch;
  jest.useRealTimers();
});

async function renderReservation() {
  render(<ReservationPage />);
  return screen.findByRole('button', { name: 'テスト会議室 4名' });
}

test('フッターを sticky / fixed / bottom で時間選択に重ねない', async () => {
  await renderReservation();
  const footer = screen.getByTestId('reservation-footer');
  expect(Array.from(footer.classList)).not.toEqual(expect.arrayContaining(['sticky']));
  expect(Array.from(footer.classList)).not.toEqual(expect.arrayContaining(['fixed']));
  expect(footer.getAttribute('style') ?? '').not.toMatch(/bottom/i);
});

test('施設・日付・時間の選択後もフッターはタイムスロットより後ろにある', async () => {
  fireEvent.click(await renderReservation());
  fireEvent.click(await screen.findByRole('button', { name: '28' }));
  fireEvent.click(await screen.findByRole('button', { name: '09:00' }));
  fireEvent.click(screen.getByRole('button', { name: '10:00' }));

  const footer = screen.getByTestId('reservation-footer');
  expect(within(footer).getByRole('button', { name: '予約内容を確認する' })).toBeTruthy();
  expect(within(footer).getByText('9/28（月） 09:00〜10:00')).toBeTruthy();
  const timeslots = screen.getByTestId('reservation-timeslots');
  expect(timeslots.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('施設未選択のフッターとプレースホルダーを背景つきの箱にしない', async () => {
  await renderReservation();
  const footer = screen.getByTestId('reservation-footer');
  const placeholder = within(footer).getByText('上から施設を選択してください');
  for (const element of [footer, placeholder]) {
    const backgrounds = Array.from(element.classList).filter(
      (name) => name.startsWith('bg-') && name !== 'bg-transparent'
    );
    expect(backgrounds).toEqual([]);
  }
});

test('PageBg のルートに -mb-20 と !pb-[ナビ高さ+セーフエリア] を付ける', async () => {
  const { container } = render(<ReservationPage />);
  await screen.findByRole('button', { name: 'テスト会議室 4名' });

  const root = container.firstElementChild as HTMLElement;
  expect(Array.from(root.classList)).toContain('-mb-20');
  expect(Array.from(root.classList)).toContain(
    '!pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))]'
  );
});

test('同伴者必須施設の日時選択後は同伴者セクションがフッターより前にある', async () => {
  testFacility = { ...facility, requireCompanions: true, minPartySize: 2 };
  fireEvent.click(await renderReservation());
  fireEvent.click(await screen.findByRole('button', { name: '28' }));
  fireEvent.click(await screen.findByRole('button', { name: '09:00' }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '10:00' }));
  });

  await screen.findByRole('heading', { name: '一緒に入る人' });
  const companions = screen.getByTestId('reservation-companions');
  expect(within(companions).getByRole('combobox')).toBeTruthy();
  const footer = screen.getByTestId('reservation-footer');
  expect(within(footer).getByRole('button', { name: '予約内容を確認する' })).toBeTruthy();
  expect(companions.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
