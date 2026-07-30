"use client";

import { useEffect, useState } from "react";

/**
 * DEV-ONLY（develop 専用 / main へ入れない）
 * 検証データ（サウナ予約・非本番専用）
 * 同伴者必須（1人での利用を禁止する）施設の予約フローを demo で通しで確認するためのツール。
 * - 同伴者ピッカーは実在アカウントしか候補に出さないので、ここでは**アカウントも作る**。
 * - 削除は demoDummy タグ ＋ lineUserId が `demo-sauna-` で始まるものに限定（実ユーザーは消さない）。
 */

interface AccountNote {
  displayName: string;
  companyName: string;
  role: "member" | "guest" | "staff";
  selectable: boolean;
  note: string;
}

interface SeedSummary {
  facilityId: string;
  facilityName: string;
  calendarId: string;
  calendarIdSource: "request" | "env" | "copied" | "none";
  copiedFrom?: string;
  minPartySize: number;
  maxCompanions: number;
  minAdvanceDays: number;
  earliestBookableDate: string;
  selectable: number;
  excluded: number;
  reservationDate: string;
  reservationTime: string;
}

const ROLE_LABELS: Record<AccountNote["role"], string> = {
  member: "会員",
  guest: "ゲスト",
  staff: "エイト社員",
};

export default function SaunaDemoDataPage() {
  const [accounts, setAccounts] = useState<AccountNote[]>([]);
  const [calendarId, setCalendarId] = useState("");
  const [busy, setBusy] = useState<"seed" | "clear" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    fetch("/api/admin/reservations/demo-data", { credentials: "same-origin", cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts ?? []))
      .catch(() => setMsg({ ok: false, text: "投入内容の取得に失敗しました" }));
  }, []);

  async function seed() {
    setBusy("seed");
    setMsg(null);
    setWarn(null);
    try {
      const res = await fetch("/api/admin/reservations/demo-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(calendarId.trim() ? { calendarId: calendarId.trim() } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "投入に失敗しました" });
        return;
      }
      const s = data.summary as SeedSummary;
      setMsg({
        ok: true,
        text:
          `「${s.facilityName}」を作成しました（同伴者候補${s.selectable}名／候補外${s.excluded}名・` +
          `最低${s.minPartySize}名・同伴者は最大${s.maxCompanions}名）。` +
          `利用日の${s.minAdvanceDays}日前までに予約が必要なので、新規予約は ${s.earliestBookableDate} 以降の土曜から選べます。` +
          `${s.reservationDate} ${s.reservationTime} には「demoユーザーが同伴者」の既存予約を1件入れました。`,
      });
      // カレンダーの取り違えは検証結果を狂わせるので必ず出す
      if (s.calendarIdSource === "none") {
        setWarn(
          "Google Calendar ID が未解決です。この状態では予約 POST が失敗します。" +
            "下の入力欄にサウナ用のカレンダーIDを入れて再実行するか、カレンダー管理で施設を編集してください。"
        );
      } else if (s.calendarIdSource === "copied") {
        setWarn(
          `Google Calendar ID を既存施設「${s.copiedFrom}」からコピーしました。` +
            "カレンダーを共有するため、その施設の予約とサウナの予約が互いの空きを塞ぎます。" +
            "サウナ専用のカレンダーIDを入れて再実行するのが確実です。"
        );
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
    setWarn(null);
    try {
      const res = await fetch("/api/admin/reservations/demo-data", {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (res.ok) {
        const s = data.summary ?? {};
        setMsg({
          ok: true,
          text:
            `削除しました（施設${s.facilities}・アカウント${s.authorizedUsers}・` +
            `予約${s.reservations}・ロック${s.reservationLocks}・カレンダー${s.calendarEvents}）。`,
        });
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
      <h1 className="text-lg font-bold text-[#231714]">検証データ（サウナ予約）</h1>
      <p className="text-[12.5px] text-[#231714]/85 mt-1 leading-relaxed">
        <strong>1人での利用を禁止する施設</strong>（同伴者必須）の予約フローを確認するためのデータを投入します。
        同伴者ピッカーは<strong>実在するアプリ利用者しか候補に出さない</strong>ため、ここでは施設に加えて
        <strong>ダミーアカウントも作成</strong>します（<code>demoDummy</code> タグ ＋{" "}
        <code>demo-sauna-</code> 接頭辞付き）。
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

      {warn && (
        <div className="mt-3 rounded-xl bg-[#fff7e6] border border-[#f0d9a8] px-4 py-3 text-[12.5px] text-[#8a6300] leading-relaxed">
          {warn}
        </div>
      )}

      <div className="mt-5 space-y-5">
        <div>
          <label className="block text-[11px] font-extrabold text-[#231714]/85 tracking-wide mb-1.5">
            Google Calendar ID（任意）
          </label>
          <input
            type="text"
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
            placeholder="sauna@group.calendar.google.com"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-[#231714]"
          />
          <p className="text-[11.5px] text-[#231714]/75 mt-1.5 leading-relaxed">
            空欄なら環境変数 <code>CALENDAR_ID_SAUNA</code> →
            既存施設からのコピー、の順で決めます。専用カレンダーを指定するのが確実です。
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            onClick={seed}
            disabled={busy !== null}
            className="w-full py-3 rounded-2xl text-sm font-extrabold text-white bg-[#231714] active:scale-[0.98] disabled:opacity-50"
          >
            {busy === "seed" ? "投入中..." : "サウナ検証データを投入する"}
          </button>

          {!confirmClear ? (
            <button
              onClick={() => setConfirmClear(true)}
              disabled={busy !== null}
              className="w-full py-3 rounded-2xl text-sm font-bold text-[#d8533a] bg-white border border-[#f0c5bb] active:scale-[0.98] disabled:opacity-50"
            >
              サウナ検証データを削除
            </button>
          ) : (
            <div className="rounded-2xl border border-[#f0c5bb] bg-[#fdf4f2] p-3">
              <p className="text-[12.5px] text-[#231714]/85 mb-2.5">
                検証用サウナ施設・ダミーアカウント・<strong>サウナ施設の予約すべて（検証中に自分で取った分も）</strong>
                と対応する Google カレンダーの予定を削除します。他の施設・実ユーザーには触れません。よろしいですか？
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
            <li>
              施設「サウナ（検証）」… <b>土曜のみ</b>・10:00〜22:00・<b>60分の固定枠</b>・定員4名・
              <b>同伴者必須（最低2名・同伴者は最大3名）</b>・
              <b>利用日の7日前までに予約（直前予約 不可）</b>。決済と解錠は付けません。
            </li>
            <li>同伴者候補のダミーアカウント（同姓同名・カタカナ氏名・英字名を含む）</li>
            <li>
              直近の土曜 17:00〜18:00 に「<b>demoユーザーが同伴者</b>」の予約1件（＋対応するロック）。
              ダミーはログインできないので、この状態だけは手作業で作れません。
            </li>
          </ul>
          <p className="mt-2">
            確認したいこと：<b>7日以内の日付がカレンダーで選べない</b>（案内が出る）／同伴者を選ばないと
            予約ボタンが押せない／同伴者を選べば予約できる／マイ予約で同伴者側は
            <b>キャンセル不可・解錠コード非表示</b>／管理の予約管理に同伴者が並ぶ。
          </p>
          <p className="mt-2">
            ※ 予約者側の確認は、利用者アプリで <b>Dev ログイン（会員＝demoユーザー）</b>して実際に予約してください
            （同伴者の予約はそのアカウントを指しています）。
          </p>
          <p className="mt-2">※ もう一度投入すると、サウナの予約とロックがリセットされます。</p>
        </div>

        {accounts.length > 0 && (
          <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-gray-100 text-[12px] font-extrabold text-[#231714]/85">
              作成されるアカウント（{accounts.filter((a) => a.selectable).length}名が候補に出る）
            </div>
            <ul className="divide-y divide-gray-50">
              {accounts.map((a, i) => (
                <li key={i} className="px-3.5 py-2.5 flex items-start gap-2.5">
                  <span
                    className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      a.selectable ? "bg-[#eef4dd] text-[#5f7d1e]" : "bg-[#f3f5f6] text-[#45484d]"
                    }`}
                  >
                    {a.selectable ? "候補" : "候補外"}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] text-[#231714]">
                      {a.displayName}
                      <span className="text-[11px] text-[#231714]/70 ml-1.5">
                        {ROLE_LABELS[a.role]}
                        {a.companyName ? ` / ${a.companyName}` : ""}
                      </span>
                    </span>
                    <span className="block text-[11.5px] text-[#231714]/75">{a.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
