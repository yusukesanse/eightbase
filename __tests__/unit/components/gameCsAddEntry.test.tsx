/** @jest-environment jsdom */
/** CS の参加者一覧から、管理者が利用者を参加確定として追加する。 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import CsParticipantList from "@/components/admin/mahjongCs/CsParticipantList";
import { POKER_CS_RULES } from "@/lib/gameCsRules";
import type { MahjongCsEvent } from "@/types";

const event: MahjongCsEvent = {
  csEventId: "cs1", seasonId: "s1", name: "CS", eventDate: "2099-12-01", status: "entry", capacity: 3,
  priorityUserIds: [], entryOpensAt: "2099-11-01T00:00:00+09:00", entryClosesAt: "2099-11-20T00:00:00+09:00",
  entries: [
    { lineUserId: "a", displayName: "確定さん", tier: "M3", rank: 100000, enteredAt: "2099-11-01T00:00:00Z", state: "confirmed" },
    { lineUserId: "k", displayName: "管理追加さん", tier: "M3", rank: 100000, enteredAt: "2099-11-03T00:00:00Z", state: "confirmed", adminAdded: true },
  ],
  entrants: [], rounds: [], createdAt: "2099-11-01T00:00:00Z", updatedAt: "",
};
/** 定員2・確定2名で満員、待ちさんがキャンセル待ち。 */
const full: MahjongCsEvent = { ...event, capacity: 2, entries: [...event.entries!,
  { lineUserId: "w", displayName: "待ちさん", tier: "M3", rank: 100000, enteredAt: "2099-11-04T00:00:00Z", state: "waitlisted" }] };
const participants = [
  { lineUserId: "a", displayName: "確定さん", role: "member", pictureUrl: "" },
  { lineUserId: "w", displayName: "待ちさん", role: "member", pictureUrl: "" },
  { lineUserId: "x", displayName: "やまだ", role: "guest", pictureUrl: "" },
  { lineUserId: "y", displayName: "ささき", role: "member", pictureUrl: "" },
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
  expect(screen.getByText("やまださんを参加確定として追加しますか？（締切・参加資格に関係なく追加されます）")).toBeInTheDocument();
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

test("既に参加確定の人は「参加確定」と出て押せない", async () => {
  renderList();
  await openAndSearch("さん");
  const confirmed = (await screen.findByRole("button", { name: "確定さんさんを追加" })).closest("li")!;
  expect(within(confirmed).getByText("参加確定")).toBeInTheDocument();
  expect(within(confirmed).getByRole("button")).toBeDisabled();
});

test("満員のときは「＋ 参加者を追加」を押せず、「定員に達しています」と出る", () => {
  renderList({ event: full });
  expect(screen.getByRole("button", { name: "＋ 参加者を追加" })).toBeDisabled();
  expect(screen.getByText("定員に達しています")).toBeInTheDocument();
});

test("空きがあれば「定員に達しています」は出ない", () => {
  renderList();
  expect(screen.getByRole("button", { name: "＋ 参加者を追加" })).toBeEnabled();
  expect(screen.queryByText("定員に達しています")).toBeNull();
});

test("受付中は、未表明の優先枠の席を空きに数えない（締切後は数える）", () => {
  const { unmount } = renderList({ event: { ...event, priorityUserIds: ["p"] } });
  expect(screen.getByText("定員に達しています")).toBeInTheDocument();
  unmount();
  renderList({ event: { ...event, priorityUserIds: ["p"], status: "closed" } });
  expect(screen.queryByText("定員に達しています")).toBeNull();
});

test("受付中に一般枠が満員でも、未表明の優先枠の人だけは追加できる", async () => {
  // 定員3・確定2名・優先枠 x（未表明）の席で満員
  renderList({ event: { ...event, priorityUserIds: ["x"] } });
  expect(screen.getByText("定員に達しています")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "＋ 参加者を追加" })).toBeEnabled();
  await openAndSearch("さ");
  const general = (await screen.findByRole("button", { name: "ささきさんを追加" })).closest("li")!;
  expect(within(general).getByRole("button")).toBeDisabled();
  expect(within(general).queryByText("優先枠")).toBeNull();
  fireEvent.change(screen.getByPlaceholderText(/名前で検索/), { target: { value: "やまだ" } });
  const priority = screen.getByRole("button", { name: "やまださんを追加" }).closest("li")!;
  expect(within(priority).getByText("優先枠")).toBeInTheDocument();
  expect(within(priority).getByRole("button")).toBeEnabled();
});

test("操作を止めている間（disabled）は「＋ 参加者を追加」を押せない", () => {
  renderList({ disabled: true });
  expect(screen.getByRole("button", { name: "＋ 参加者を追加" })).toBeDisabled();
});

test("満員になったら追加欄を閉じ、空きができても勝手に開かない", async () => {
  const { rerender } = renderList();
  await openAndSearch("やまだ");
  const props = { onChanged, onError };
  rerender(<CsParticipantList event={full} {...props} />);
  expect(screen.queryByPlaceholderText(/名前で検索/)).toBeNull();
  rerender(<CsParticipantList event={event} {...props} />);
  expect(screen.queryByPlaceholderText(/名前で検索/)).toBeNull();
});

test("候補の読み込み中は「読み込み中」と出す", async () => {
  let done!: (v: unknown) => void;
  global.fetch = jest.fn(() => new Promise((resolve) => { done = resolve; })) as jest.Mock;
  renderList();
  await openAndSearch("やまだ");
  expect(screen.getByText("候補を読み込み中…")).toBeInTheDocument();
  expect(screen.queryByText("該当する候補はいません。")).toBeNull();
  done({ ok: true, status: 200, json: async () => ({ participants }) });
  expect(await screen.findByRole("button", { name: "やまださんを追加" })).toBeEnabled();
});

test("追加に失敗したらエラー文を出す（409 は一覧を取り直す）", async () => {
  patch = { ok: false, status: 409, json: async () => ({ error: "定員に達しているため追加できません" }) };
  renderList();
  await openAndSearch("やまだ");
  fireEvent.click(await screen.findByRole("button", { name: "やまださんを追加" }));
  fireEvent.click(screen.getByRole("button", { name: "追加する" }));
  await waitFor(() => expect(onError).toHaveBeenLastCalledWith("定員に達しているため追加できません"));
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
