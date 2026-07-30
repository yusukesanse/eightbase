"use client";

import { useState } from "react";

/**
 * DEV-ONLY（develop 専用 / main へ入れない）
 * 検証データ（アプリ全体） — demo 環境を1操作で通し確認できる状態にする。
 *
 * 種目単位・機能単位に分かれていた投入ツールの単一の入口。
 * 「画面ごとにデータが欠けていて確認しづらい」を解消するのが目的。
 */

interface Summary {
  facilities: number;
  news: number;
  events: number;
  posts: number;
  seasons: number;
  games: Record<string, unknown>;
  sauna: Record<string, unknown>;
  notes: string[];
}

export default function AppDemoDataPage() {
  const [busy, setBusy] = useState<"seed" | "clear" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  async function run(method: "POST" | "DELETE") {
    setBusy(method === "POST" ? "seed" : "clear");
    setMsg(null);
    setSummary(null);
    try {
      const res = await fetch("/api/admin/demo-data", { method, credentials: "same-origin" });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "失敗しました" });
        return;
      }
      if (method === "POST") {
        setSummary(data.summary as Summary);
        setMsg({ ok: true, text: "demo 環境を整えました。利用者アプリで通しの確認ができます。" });
      } else {
        const total = Object.values(data.summary ?? {}).reduce(
          (a: number, b) => a + (typeof b === "number" ? b : 0),
          0
        );
        setMsg({ ok: true, text: `検証データを削除しました（${total}件）。標準施設は残しています。` });
      }
      setConfirmClear(false);
    } catch {
      setMsg({ ok: false, text: "通信に失敗しました" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-5 max-w-2xl">
      <h1 className="text-lg font-bold text-[#231714]">検証データ（アプリ全体）</h1>
      <p className="text-[12.5px] text-[#231714]/85 mt-1 leading-relaxed">
        demo で<strong>通しの動作確認</strong>ができる状態にします。施設・サウナ・ニュース・イベント・掲示板・
        ゲーム4種目を<strong>1操作でまとめて</strong>投入します（種目ごとに投入する必要はありません）。
        <br />
        何度実行しても重複しません（固定IDで上書き）。
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

      <div className="mt-5 flex flex-col gap-2.5">
        <button
          onClick={() => run("POST")}
          disabled={busy !== null}
          className="w-full py-3.5 rounded-2xl text-sm font-extrabold text-white bg-[#231714] active:scale-[0.98] disabled:opacity-50"
        >
          {busy === "seed" ? "投入中…（30秒ほどかかります）" : "demo 環境をまとめて整える"}
        </button>

        {!confirmClear ? (
          <button
            onClick={() => setConfirmClear(true)}
            disabled={busy !== null}
            className="w-full py-3 rounded-2xl text-sm font-bold text-[#d8533a] bg-white border border-[#f0c5bb] active:scale-[0.98] disabled:opacity-50"
          >
            検証データを削除
          </button>
        ) : (
          <div className="rounded-2xl border border-[#f0c5bb] bg-[#fdf4f2] p-3">
            <p className="text-[12.5px] text-[#231714]/85 mb-2.5">
              投入した検証データ（サウナ施設・ダミーアカウント・ニュース・イベント・掲示板・シーズンと
              ゲームデータ・トレーラー検証施設）を削除します。
              <strong>標準施設（会議室・ブース）は残します。</strong>
              サウナ施設の予約と対応する Google カレンダーの予定も削除されます。よろしいですか？
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
                onClick={() => run("DELETE")}
                disabled={busy !== null}
                className="flex-1 py-2.5 rounded-xl text-sm font-extrabold text-white bg-[#d8533a] disabled:opacity-50"
              >
                {busy === "clear" ? "削除中…" : "削除する"}
              </button>
            </div>
          </div>
        )}
      </div>

      {summary && (
        <div className="mt-5 rounded-xl border border-gray-100 bg-white p-4 text-[12.5px] text-[#231714]/85">
          <p className="font-extrabold text-[#231714] mb-2">投入結果</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>施設 {summary.facilities}（会議室・ブース・トレーラー検証）＋ サウナ検証</li>
            <li>ニュース {summary.news} / イベント {summary.events} / 掲示板 {summary.posts}</li>
            <li>シーズン {summary.seasons}（麻雀・ダーツ・ビリヤード・ポーカー）＋ 各種目の参加・順位・当日データ</li>
          </ul>
          {summary.notes?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
              {summary.notes.map((n, i) => (
                <p key={i} className="text-[12px] text-[#231714]/75 leading-relaxed">
                  ※ {n}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 rounded-xl bg-[#f7f8f8] p-3.5 text-[12px] text-[#231714]/75 leading-relaxed">
        <p className="font-bold text-[#231714]/85">投入される内容</p>
        <ul className="mt-1 list-disc pl-4 space-y-0.5">
          <li>
            <b>施設</b>… 会議室A/B/C・ブース1〜3（標準）＋<b>トレーラー検証</b>（Square決済＋SwitchBot解錠＋長い規約）
            ＋<b>サウナ検証</b>（同伴者必須・土曜のみ・7日前まで）
          </li>
          <li>
            <b>規約の長短を両方用意</b>… 会議室Cは短い規約、トレーラーは長い規約。
            規約が短い施設で同意ボタンが出ない不具合の再発チェックを兼ねます
          </li>
          <li><b>同伴者候補のアカウント</b>… 同姓同名・カタカナ・英字名を含む。掲示板の投稿者も同じアカウント</li>
          <li><b>ニュース・イベント・掲示板</b>… 各画面が空にならない程度に投入（LINE配信はしません）</li>
          <li><b>ゲーム4種目</b>… シーズンを作成して active にし、参加・順位・当日・CS を投入</li>
        </ul>
        <p className="mt-2">
          <b>予約は投入しません</b>（サウナの「自分が同伴者」1件のみ）。予約フローは利用者アプリで
          実際に取って確認するものなので、シードで作ると経路を通さないことになるためです。
        </p>
      </div>
    </div>
  );
}
