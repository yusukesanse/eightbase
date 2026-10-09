/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SeasonMahjongCsPage from "@/app/admin/games/seasons/[seasonId]/mahjong-cs/page";
import CsCreateForm from "@/components/admin/mahjongCs/CsCreateForm";
import CsEntryAdminPanel from "@/components/admin/mahjongCs/CsEntryAdminPanel";
import type { MahjongCsEvent } from "@/types/mahjong";

jest.mock("next/navigation", () => ({ useParams: () => ({ seasonId: "s1" }) }));

function makeEvent(): MahjongCsEvent {
  return {
    csEventId: "cs1", seasonId: "s1", name: "秋CS", eventDate: "2099-10-20", status: "closed",
    capacity: 4, priorityUserIds: ["a"],
    entryOpensAt: "2099-10-01T00:00:00+09:00", entryClosesAt: "2099-10-08T00:00:00+09:00",
    entries: ["a", "b", "c", "d", "e"].map((id, i) => ({
      lineUserId: id, displayName: `選手${id}`, tier: i === 0 ? "M1" : "M3", rank: i + 1,
      enteredAt: `2099-10-01T00:0${i}:00Z`, state: i === 4 ? "waitlisted" : "confirmed",
    })),
    entrants: ["a", "b", "c", "d"].map((id, i) => ({
      lineUserId: id, displayName: `選手${id}`, rank: i + 1, seed: false,
    })),
    rounds: [], createdAt: "2099-10-01T00:00:00Z", updatedAt: "2099-10-01T00:00:00Z",
    bracket: { seedUserIds: [], rounds: [{
      type: "final", label: "決勝", advanceCount: 1,
      matches: [{ matchId: "F", label: "決勝卓", status: "reporting", players: [],
        seats: ["a", "b", "c", "d"].map((id) => ({ kind: "player", lineUserId: id })) }],
    }] },
  };
}
let event: MahjongCsEvent;
beforeEach(() => {
  event = makeEvent();
  global.fetch = jest.fn(async (_url, options) => {
    if (options?.method === "PATCH") {
      const input = JSON.parse(String(options.body));
      event = { ...event, entries: event.entries?.filter((e) => e.lineUserId !== input.lineUserId),
        entrants: event.entrants.filter((e) => e.lineUserId !== input.lineUserId),
        bracket: { ...event.bracket!, rounds: event.bracket!.rounds.map((r) => ({ ...r,
          matches: r.matches.map((m) => ({ ...m, seats: m.seats!.map((s) =>
            s?.kind === "player" && s.lineUserId === input.lineUserId ? null : s) })),
        })) },
      };
      return { ok: true, json: async () => ({ event }) };
    }
    return { ok: true, json: async () => ({ events: [event], activeSeasonId: "s1", priorityPreviewCount: 1 }) };
  }) as jest.Mock;
});

test("締切後は編成の上に共通参加者一覧を表示し、確認後の削除で編成を再取得する", async () => {
  render(<SeasonMahjongCsPage />);
  const table = await screen.findByRole("table");
  expect(table.compareDocumentPosition(screen.getByText("決勝卓")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(table).getByText("選手a")).toBeTruthy();
  expect(within(table).getByText("2099/10/01 09:00")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "キャンセル待ち" }));
  expect(within(table).queryByText("選手a")).toBeNull();
  expect(within(table).getByText("選手e")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "優先枠" }));
  expect(within(table).getByText("選手a")).toBeTruthy();
  expect(within(table).queryByText("選手e")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "選手aさんを外す" }));
  expect(screen.getByText("選手aさんを参加者から外しますか？")).toBeTruthy();
  expect((fetch as jest.Mock).mock.calls).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "外す" }));
  await waitFor(() => expect(within(table).queryByText("選手a")).toBeNull());
  expect(fetch).toHaveBeenCalledWith("/api/admin/mahjong/cs/cs1", expect.objectContaining({
    method: "PATCH", body: JSON.stringify({ action: "removeEntry", lineUserId: "a" }),
  }));
  expect(screen.queryByText("選手a")).toBeNull();
  expect(within(screen.getByRole("button", { name: "決勝卓 1席目" })).getByText("空席")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "期間・定員を変更" })).toBeNull();
  expect(screen.queryByRole("button", { name: "今すぐ締め切る" })).toBeNull();
  expect(screen.queryByRole("button", { name: /ダミーで定員/ })).toBeNull();
});

test.each(["running", "finished"] as const)("管理者の%s表示で決勝に通過人数を出さない", async (status) => {
  event.status = status;
  event.rounds = [
    { type: "prelim", label: "予選", advanceCount: 2, matches: [] },
    { type: "final", label: "決勝", advanceCount: 1, matches: [] },
  ];
  render(<SeasonMahjongCsPage />);
  expect(await screen.findByText("予選（各卓 上位2名通過）")).toBeTruthy();
  expect(screen.getByText("決勝")).toBeTruthy();
  expect(screen.queryByText(/決勝（各卓/)).toBeNull();
});

test("作成の定員空欄はフォーカスを外しても保持し、送信できない", () => {
  render(<CsCreateForm priorityPreviewCount={0} onCreated={jest.fn()} />);
  const capacity = screen.getByRole("spinbutton", { name: "定員" });
  fireEvent.change(capacity, { target: { value: "" } });
  fireEvent.blur(capacity);
  expect(capacity).toHaveValue(null);
  expect(screen.getByText("定員を入力してください")).toBeTruthy();
  const submit = screen.getByRole("button", { name: "作成して参加受付を始める" });
  expect(submit).toBeDisabled();
  fireEvent.click(submit);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(capacity, { target: { value: "8" } });
  expect(submit).toBeEnabled();
});

test("受付編集の定員空欄は保存できず、入力で再開する", () => {
  event.status = "entry";
  render(<CsEntryAdminPanel event={event} onChanged={jest.fn()} onError={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "期間・定員を変更" }));
  const capacity = screen.getByRole("spinbutton", { name: "定員" });
  fireEvent.change(capacity, { target: { value: "" } });
  fireEvent.blur(capacity);
  expect(capacity).toHaveValue(null);
  expect(screen.getByText("定員を入力してください")).toBeTruthy();
  const save = screen.getByRole("button", { name: "保存" });
  expect(save).toBeDisabled();
  fireEvent.click(save);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(capacity, { target: { value: "8" } });
  expect(save).toBeEnabled();
});

test("作成の409エラーをそのまま表示する", async () => {
  const error = "進行中のCSがあります。終了するか削除してから作成してください";
  (fetch as jest.Mock).mockResolvedValue({ ok: false, status: 409, json: async () => ({ error }) });
  render(<CsCreateForm priorityPreviewCount={0} onCreated={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "作成して参加受付を始める" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(error);
});
