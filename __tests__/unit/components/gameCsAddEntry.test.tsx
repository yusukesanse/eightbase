/** @jest-environment jsdom */
/** CS の参加者一覧から、管理者が利用者を参加確定として追加する。 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import CsParticipantList from "@/components/admin/mahjongCs/CsParticipantList";
import { POKER_CS_RULES } from "@/lib/gameCsRules";
import type { MahjongCsEvent } from "@/types";

const event: MahjongCsEvent = {
  csEventId: "cs1", seasonId: "s1", name: "CS", eventDate: "2099-12-01", status: "entry", capacity: 1,
  priorityUserIds: [], entryOpensAt: "2099-11-01T00:00:00+09:00", entryClosesAt: "2099-11-20T00:00:00+09:00",
  entries: [
    { lineUserId: "a", displayName: "確定さん", tier: "M3", rank: 100000, enteredAt: "2099-11-01T00:00:00Z", state: "confirmed" },
    { lineUserId: "w", displayName: "待ちさん", tier: "M3", rank: 100000, enteredAt: "2099-11-02T00:00:00Z", state: "waitlisted" },
    { lineUserId: "k", displayName: "管理追加さん", tier: "M3", rank: 100000, enteredAt: "2099-11-03T00:00:00Z", state: "confirmed", adminAdded: true },
  ],
  entrants: [], rounds: [], createdAt: "2099-11-01T00:00:00Z", updatedAt: "",
};
const participants = [
  { lineUserId: "a", displayName: "確定さん", role: "member", pictureUrl: "" },
  { lineUserId: "w", displayName: "待ちさん", role: "member", pictureUrl: "" },
  { lineUserId: "x", displayName: "やまだ", role: "guest", pictureUrl: "" },
];

let patch: { ok: boolean; status: number; json: () => Promise<unknown> };
const onChanged = jest.fn();
const onError = jest.fn();
beforeEach(() => {
  onChanged.mockClear(); onError.mockClear();
  patch = { ok: true, status: 200, json: async () => ({ event }) };
  global.fetch = jest.fn(async (_url: string, options?: RequestInit) =>
    options?.method === "PATCH" ? patch : { ok: true, status: 200, json: async () => ({ participants }) }) as jest.Mock;
});
const renderList = (props: Partial<Parameters<typeof CsParticipantList>[0]> = {}) =>
  render(<CsParticipantList event={event} onChanged={onChanged} onError={onError} {...props} />);
async function openAndSearch(query: string) {
  fireEvent.click(screen.getByRole("button", { name: "＋ 参加者を追加" }));
  fireEvent.change(await screen.findByPlaceholderText(/名前で検索/), { target: { value: query } });
}

test("開くまで候補を読まず、開いたら1回だけ読む", async () => {
  renderList();
  expect(fetch).not.toHaveBeenCalled();
  await openAndSearch("やまだ");
  expect(await screen.findByRole("button", { name: "やまださんを追加" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "＋ 参加者を追加" }));
  fireEvent.click(screen.getByRole("button", { name: "＋ 参加者を追加" }));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("/api/admin/games/participants", expect.anything());
});

test("候補をカタカナでも検索でき、確認してから addEntry を送る", async () => {
  renderList();
  await openAndSearch("ヤマ");
  fireEvent.click(await screen.findByRole("button", { name: "やまださんを追加" }));
  expect(screen.getByText("やまださんを参加確定として追加しますか？（定員・締切・参加資格に関係なく追加されます）")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "追加する" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/mahjong/cs/cs1", expect.objectContaining({
    method: "PATCH", body: JSON.stringify({ action: "addEntry", lineUserId: "x" }),
  })));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(onError).toHaveBeenLastCalledWith(null);
});

test("確認でキャンセルすると送らない", async () => {
  renderList();
  await openAndSearch("やまだ");
  fireEvent.click(await screen.findByRole("button", { name: "やまださんを追加" }));
  fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(screen.queryByText(/参加確定として追加しますか/)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("既に参加確定の人は「参加確定」と出て押せない。キャンセル待ちの人は追加できる", async () => {
  renderList();
  await openAndSearch("さん");
  const confirmed = (await screen.findByRole("button", { name: "確定さんさんを追加" })).closest("li")!;
  expect(within(confirmed).getByText("参加確定")).toBeInTheDocument();
  expect(within(confirmed).getByRole("button")).toBeDisabled();
  const waiting = screen.getByRole("button", { name: "待ちさんさんを追加" }).closest("li")!;
  expect(within(waiting).getByText("キャンセル待ち")).toBeInTheDocument();
  expect(within(waiting).getByRole("button")).toBeEnabled();
});

test("追加に失敗したらエラー文を出す（409 は一覧を取り直す）", async () => {
  patch = { ok: false, status: 409, json: async () => ({ error: "現在の状態ではこの操作はできません" }) };
  renderList();
  await openAndSearch("やまだ");
  fireEvent.click(await screen.findByRole("button", { name: "やまださんを追加" }));
  fireEvent.click(screen.getByRole("button", { name: "追加する" }));
  await waitFor(() => expect(onError).toHaveBeenLastCalledWith("現在の状態ではこの操作はできません"));
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test("候補の取得に失敗したらエラー文を出す", async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "候補の取得に失敗しました" }) })) as jest.Mock;
  renderList();
  fireEvent.click(screen.getByRole("button", { name: "＋ 参加者を追加" }));
  await waitFor(() => expect(onError).toHaveBeenLastCalledWith("候補の取得に失敗しました"));
});

test("ポーカーの窓口へ送る", async () => {
  renderList({ rules: POKER_CS_RULES });
  await openAndSearch("やまだ");
  fireEvent.click(await screen.findByRole("button", { name: "やまださんを追加" }));
  fireEvent.click(screen.getByRole("button", { name: "追加する" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/poker/cs/cs1", expect.objectContaining({ method: "PATCH" })));
});

test("一覧の状態は、管理者が追加した人だけ「参加確定（管理者追加）」と出る", () => {
  renderList();
  const table = screen.getByRole("table");
  expect(within(within(table).getByText("管理追加さん").closest("tr")!).getByText("参加確定（管理者追加）")).toBeInTheDocument();
  expect(within(within(table).getByText("確定さん").closest("tr")!).getByText("参加確定")).toBeInTheDocument();
});
