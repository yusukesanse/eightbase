"use client";

import { useEffect, useState } from "react";
import type { Season } from "@/types";

/**
 * DEV-ONLY（develop 専用 / main へ入れない）
 * 検証データ（麻雀・非本番専用）
 * 管理者が作った実シーズンへダミー参加者データを投入/削除する独立ツール。
 * - ダミーは支払い済み参加・順位・当日卓・CS を含む（demoDummy タグ付き）。
 * - 削除はダミー（タグ付き）のみ。シーズン本体・ログインアカウントは残す。
 */
export default function DemoDataPage() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"seed" | "clear" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    fetch("/api/admin/scoreboard/seasons", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        // 麻雀・ダーツ・ビリヤード・ポーカーの当日フロー付きシーズンを対象にする（種目で投入内容が分岐）。
        const list: Season[] = (d.seasons ?? []).filter(
          (s: Season) =>
            s.gameCategory === "mahjong" ||
            s.gameCategory === "darts" ||
            s.gameCategory === "billiards" ||
            s.gameCategory === "poker" ||
            !s.gameCategory
        );
        setSeasons(list);
        // 既定は開催中(active)→なければ先頭
        const active = list.find((s) => s.active);
        setSeasonId(active?.seasonId ?? list[0]?.seasonId ?? "");
      })
      .catch(() => setMsg({ ok: false, text: "シーズンの取得に失敗しました" }))
      .finally(() => setLoading(false));
  }, []);

  async function seed() {
    if (!seasonId) return;
    setBusy("seed");
    setMsg(null);
    try {
      const res = await fetch("/api/admin/games/demo-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ seasonId }),
      });
      const data = await res.json();
      if (res.ok) {
        const s = data.summary ?? {};
        setMsg({
          ok: true,
          text: `ダミーを投入しました（参加者${s.players}名・日程${s.schedule}・卓${s.tables}・参加${s.entries}・CS${s.csEvents}）。対象シーズンを開催中に設定しました。`,
        });
      } else {
        setMsg({ ok: false, text: data.error ?? "投入に失敗しました" });
      }
    } catch {
      setMsg({ ok: false, text: "投入に失敗しました" });
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    setMsg(null);
    try {
      const res = await fetch("/api/admin/games/demo-data", {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (res.ok) {
        const s = data.summary ?? {};
        const total = Object.values(s).reduce((a: number, b) => a + (b as number), 0);
        setMsg({ ok: true, text: `ダミーデータを削除しました（${total}件）。シーズンとログインユーザーは残ります。` });
      } else {
        setMsg({ ok: false, text: data.error ?? "削除に失敗しました" });
      }
      setConfirmClear(false);
    } catch {
      setMsg({ ok: false, text: "削除に失敗しました" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-5 max-w-2xl">
      <h1 className="text-lg font-bold text-[#231714]">検証データ（麻雀）</h1>
      <p className="text-[12.5px] text-[#231714]/85 mt-1 leading-relaxed">
        麻雀の実機確認用に、選んだシーズンへダミー参加者を投入します。参加は<strong>支払い済み</strong>で入ります。
        ダミーは <code>demoDummy</code> タグ付きで投入され、削除でまとめて消せます（シーズン・ログインユーザーは残ります）。
        <br />
        ※ この画面は<strong>非本番（demo/ローカル）専用</strong>です。
      </p>

      {msg && (
        <div
          className={`mt-4 rounded-xl px-4 py-3 text-[13px] font-bold ${
            msg.ok ? "bg-[#eef4dd] text-[#5f7d1e]" : "bg-[#fdece8] text-[#d8533a]"
          }`}
        >
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="mt-6 text-sm text-[#231714]/80">読み込み中...</div>
      ) : seasons.length === 0 ? (
        <div className="mt-6 rounded-xl border border-gray-100 bg-white p-6 text-center text-sm text-[#231714]/85">
          先に「シーズン」タブで麻雀またはダーツのシーズンを作成してください。
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div>
            <label className="block text-[11px] font-extrabold text-[#231714]/85 tracking-wide mb-1.5">
              対象シーズン
            </label>
            <select
              value={seasonId}
              onChange={(e) => setSeasonId(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-[#231714]"
            >
              {seasons.map((s) => (
                <option key={s.seasonId} value={s.seasonId}>
                  [{s.gameCategory === "darts" ? "ダーツ" : s.gameCategory === "billiards" ? "ビリヤード" : s.gameCategory === "poker" ? "ポーカー" : "麻雀"}] {s.name || s.seasonId}
                  {s.active ? "（開催中）" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              onClick={seed}
              disabled={busy !== null || !seasonId}
              className="w-full py-3 rounded-2xl text-sm font-extrabold text-white bg-[#231714] active:scale-[0.98] disabled:opacity-50"
            >
              {busy === "seed" ? "投入中..." : "ダミー参加者を追加（このシーズンに）"}
            </button>

            {!confirmClear ? (
              <button
                onClick={() => setConfirmClear(true)}
                disabled={busy !== null}
                className="w-full py-3 rounded-2xl text-sm font-bold text-[#d8533a] bg-white border border-[#f0c5bb] active:scale-[0.98] disabled:opacity-50"
              >
                ダミーデータを全削除
              </button>
            ) : (
              <div className="rounded-2xl border border-[#f0c5bb] bg-[#fdf4f2] p-3">
                <p className="text-[12.5px] text-[#231714]/85 mb-2.5">
                  demoDummy タグの参加/順位/卓/CS を全て削除します。シーズンとログインユーザーは残ります。よろしいですか？
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmClear(false)}
                    disabled={busy !== null}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-[#231714]/80 bg-white border border-gray-200"
                  >
                    やめる
                  </button>
                  <button
                    onClick={clear}
                    disabled={busy !== null}
                    className="flex-1 py-2.5 rounded-xl text-sm font-extrabold text-white bg-[#d8533a] disabled:opacity-50"
                  >
                    {busy === "clear" ? "削除中..." : "削除する"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-[#f7f8f8] p-3.5 text-[12px] text-[#231714]/75 leading-relaxed">
            投入される内容：
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              <li>完了卓12名分（M1/M2/M3の順位・ピラミッド）＋CS参戦者8名</li>
              <li>当日の参加8名（支払い済み・demoユーザー＝GM を含む。先着8名の残り枠はゲスト/スタッフで参加・支払いを試せます）</li>
              <li>
                当日は<b>受付中</b>（卓は未確定）。「卓確認・申告」タブの GM パネルで
                <b>ゲーム開始 → 卓振り分け → スコア申告 → 本日終了</b>まで通しで確認できます。
                ダミー分の申告は同タブの「デモ操作」（1名ずつ／一括）で代行します。
              </li>
            </ul>
            <p className="mt-2 text-[#231714]/75">
              ※ もう一度この投入を実行すると当日の進行（開始・卓・申告）がリセットされ、最初からやり直せます。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
