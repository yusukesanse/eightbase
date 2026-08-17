"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BILLING_SOURCES,
  BILLING_SOURCE_LABEL,
  BILLING_STATUS_LABEL,
  billingDate,
  summarizeBilling,
  type BillingBasis,
  type BillingRecord,
  type BillingSource,
  type BillingStatus,
} from "@/lib/billing";
import type { Season } from "@/types";

/**
 * 請求管理。施設予約（トレーラー等）とゲーム参加費の入金を1つの表で見る。
 *
 * 元データは Firestore の記録（＝アプリ経由の Square 決済結果）。Square 管理画面との
 * 突き合わせは注文ID(orderId)/決済ID(paymentId)で行う。理由は `src/lib/billing.ts` 冒頭。
 * 集計値は表示中（絞り込み後）のレコードから計算する＝画面の数字と明細が常に一致する。
 */

interface ApiResponse {
  range: { from: string; to: string; label: string };
  basis: BillingBasis;
  records: BillingRecord[];
  summary: unknown;
}

type Mode = "month" | "year" | "season";

const STATUS_STYLE: Record<BillingStatus, { color: string; bg: string }> = {
  paid: { color: "#2f7d57", bg: "#eef6f0" },
  unpaid: { color: "#a1502c", bg: "#fff4ec" },
  refundRequested: { color: "#b4291f", bg: "#fdece8" },
  refunded: { color: "#5f6266", bg: "#f1f3f4" },
  cancelled: { color: "#5f6266", bg: "#f1f3f4" },
  exempt: { color: "#1172a5", bg: "#eef4f8" },
};

const yen = (n: number) => `¥${n.toLocaleString()}`;
const fmtDateTime = (iso: string | null) => {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "-";
  // JST 固定で表示（本番サーバーは UTC だがここはブラウザ描画なので +9h を明示する）。
  const d = new Date(t + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

export default function AdminBillingPage() {
  const now = new Date();
  const thisYear = now.getFullYear();
  const [mode, setMode] = useState<Mode>("month");
  const [year, setYear] = useState(String(thisYear));
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [seasonId, setSeasonId] = useState("");
  const [basis, setBasis] = useState<BillingBasis>("use");
  const [source, setSource] = useState<BillingSource | "all">("all");
  const [status, setStatus] = useState<BillingStatus | "all">("all");
  const [keyword, setKeyword] = useState("");

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/scoreboard/seasons", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setSeasons(d.seasons ?? []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ mode, basis, source });
    if (mode === "month") params.set("month", `${year}-${month}`);
    if (mode === "year") params.set("year", year);
    if (mode === "season") params.set("seasonId", seasonId);
    try {
      const res = await fetch(`/api/admin/billing?${params}`, { credentials: "same-origin" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "取得に失敗しました");
      setData(json);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [mode, basis, source, year, month, seasonId]);

  // シーズン別に切り替えたら先頭のシーズンを自動選択する（未選択のままだと何も出ないため）。
  useEffect(() => {
    if (mode === "season" && !seasonId && seasons.length > 0) setSeasonId(seasons[0].seasonId);
  }, [mode, seasonId, seasons]);

  useEffect(() => {
    if (mode === "season" && !seasonId) return; // シーズン確定前は読みに行かない
    load();
  }, [load, mode, seasonId]);

  const records = useMemo(() => {
    const all = data?.records ?? [];
    const kw = keyword.trim();
    return all.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (kw && !`${r.displayName} ${r.itemName} ${r.seasonName ?? ""}`.includes(kw)) return false;
      return true;
    });
  }, [data, status, keyword]);

  const summary = useMemo(() => summarizeBilling(records), [records]);

  /**
   * 入金済のまま取消された予約を「返金済」として記録する。
   * ⚠️ Square の返金操作そのものはここでは行わない（Square 管理画面で返金してから記録する）。
   *    サーバーが Square に返金があるか照合し、見つからなければ 409。現金対応などで
   *    どうしても記録が必要なときだけ、明示的な確認のうえ force で記録する。
   */
  async function markReservationRefunded(r: BillingRecord, force = false) {
    if (busy) return;
    if (!force && !confirm(
      `${r.displayName} さんの予約を「返金済」として記録します。\n` +
      `（${r.itemName} / ${r.useDate} / ${yen(r.amount)}）\n\n` +
      `先に Square 管理画面で返金を済ませてください。\n` +
      `Square 側で返金が確認できた場合のみ記録します。`
    )) return;

    setBusy(r.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/reservations/${r.refId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ force }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.code === "REFUND_NOT_FOUND" && !force) {
          // 現金返金・別アカウントでの返金など、Square から確認できないケースの逃げ道。
          if (confirm(`${json.error}\n\nSquare では確認できませんでしたが、返金済として記録しますか？`)) {
            setBusy(null);
            return markReservationRefunded(r, true);
          }
          setBusy(null);
          return;
        }
        setMessage({ ok: false, text: json.error ?? "記録できませんでした" });
      } else {
        setMessage({
          ok: true,
          text: json.alreadyRefunded
            ? "すでに返金済として記録されています。"
            : json.verified
              ? `返金済として記録しました（Square の返金 ${yen(json.refundedAmount ?? 0)} を確認）。`
              : "返金済として記録しました（Square では未確認のため、記録のみです）。",
        });
        await load();
      }
    } catch {
      setMessage({ ok: false, text: "通信に失敗しました" });
    } finally {
      setBusy(null);
    }
  }

  function downloadCsv() {
    const header = [
      "計上日", "利用日/開催日", "入金日時", "種別", "内容", "シーズン",
      "利用者", "金額", "状態", "備考", "Square注文ID", "Square決済ID",
    ];
    const rows = records.map((r) => [
      billingDate(r, basis),
      r.useDate,
      fmtDateTime(r.paidAt),
      BILLING_SOURCE_LABEL[r.source],
      r.itemName,
      r.seasonName ?? "",
      r.displayName,
      String(r.amount),
      BILLING_STATUS_LABEL[r.status],
      r.note ?? "",
      r.orderId ?? "",
      r.paymentId ?? "",
    ]);
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((line) => line.map(escape).join(",")).join("\r\n");
    // Excel で開いたときに文字化けしないよう BOM を付ける。
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `billing_${data?.range.label ?? ""}.csv`.replace(/[^\w.-]/g, "_");
    a.click();
    URL.revokeObjectURL(url);
  }

  const years = Array.from({ length: 5 }, (_, i) => String(thisYear - 3 + i));
  const selectClass =
    "px-3 py-2 text-sm border border-[#231714]/10 rounded-lg bg-white focus:outline-none focus:border-[#231714]";

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-[#231714]">請求管理</h2>
        <p className="text-sm text-[#231714]/80 mt-1">
          施設予約（トレーラー等）とゲーム参加費の入金を月別・シーズン別に集計します。
          金額はアプリ経由の Square 決済の記録です（Square 管理画面とは注文IDで突き合わせできます）。
        </p>
      </div>

      {/* ── 絞り込み ── */}
      <div className="bg-white rounded-xl border border-[#231714]/10 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-[#231714]/10 overflow-hidden">
          {([["month", "月別"], ["year", "年別"], ["season", "シーズン別"]] as [Mode, string][]).map(
            ([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-2 text-sm ${mode === m ? "bg-[#231714] text-white" : "bg-white text-[#231714]/80 hover:bg-gray-50"}`}
              >
                {label}
              </button>
            ),
          )}
        </div>

        {mode !== "season" && (
          <select value={year} onChange={(e) => setYear(e.target.value)} className={selectClass}>
            {years.map((y) => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
        )}
        {mode === "month" && (
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectClass}>
            {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => (
              <option key={m} value={m}>{Number(m)}月</option>
            ))}
          </select>
        )}
        {mode === "season" && (
          <select value={seasonId} onChange={(e) => setSeasonId(e.target.value)} className={selectClass}>
            {seasons.length === 0 && <option value="">シーズンがありません</option>}
            {seasons.map((s) => (
              <option key={s.seasonId} value={s.seasonId}>
                {s.name}（{BILLING_SOURCE_LABEL[s.gameCategory].replace(" 参加費", "")}）
              </option>
            ))}
          </select>
        )}

        <select
          value={source}
          onChange={(e) => setSource(e.target.value as BillingSource | "all")}
          className={selectClass}
        >
          <option value="all">すべての種別</option>
          {BILLING_SOURCES.map((s) => (
            <option key={s} value={s}>{BILLING_SOURCE_LABEL[s]}</option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as BillingStatus | "all")}
          className={selectClass}
        >
          <option value="all">すべての状態</option>
          {(Object.keys(BILLING_STATUS_LABEL) as BillingStatus[]).map((s) => (
            <option key={s} value={s}>{BILLING_STATUS_LABEL[s]}</option>
          ))}
        </select>

        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="利用者・内容で絞り込み"
          className="px-3 py-2 text-sm border border-[#231714]/10 rounded-lg focus:outline-none focus:border-[#231714] w-48"
        />

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs font-medium text-[#231714]/80">集計基準</span>
          <div className="flex rounded-lg border border-[#231714]/10 overflow-hidden">
            {([["use", "利用日/開催日"], ["paid", "入金日"]] as [BillingBasis, string][]).map(
              ([b, label]) => (
                <button
                  key={b}
                  onClick={() => setBasis(b)}
                  className={`px-3 py-2 text-sm ${basis === b ? "bg-[#231714] text-white" : "bg-white text-[#231714]/80 hover:bg-gray-50"}`}
                >
                  {label}
                </button>
              ),
            )}
          </div>
        </div>
      </div>

      {mode === "season" && (
        <p className="text-xs text-[#231714]/70 mb-4">
          シーズン別はゲーム参加費のみが対象です（施設予約はシーズンに属しません）。
        </p>
      )}

      {error && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm font-bold border bg-[#fdece8] border-[#f4c9bd] text-[#d8533a]">
          {error}
        </div>
      )}

      {message && (
        <div className={`mb-4 rounded-xl px-4 py-3 text-sm font-bold border ${
          message.ok
            ? "bg-[#eef6f0] border-[#cfe6d8] text-[#2f7d57]"
            : "bg-[#fdece8] border-[#f4c9bd] text-[#d8533a]"
        }`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="p-10 flex justify-center">
          <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Square では課金が成立しているのに席/枠を渡せていないもの＝放置すると返金漏れ。 */}
          {summary.refundNeededAmount > 0 && (
            <div className="mb-4 rounded-xl px-4 py-3 text-sm border bg-[#fdece8] border-[#f4c9bd] text-[#b4291f]">
              <span className="font-bold">要返金 {yen(summary.refundNeededAmount)}</span>
              ：Square で課金が成立しているのに席・枠を渡せていない決済があります（下表の「要返金」バッジ）。
              Square 管理画面で返金してください。
            </div>
          )}

          {/* ── サマリー ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {[
              { label: "入金済", value: yen(summary.receivedAmount), sub: `${summary.count}件中の入金分` },
              { label: "未入金", value: yen(summary.unpaidAmount), sub: summary.expiredAmount > 0 ? `失効 ${yen(summary.expiredAmount)} は含まず` : "回収待ち" },
              { label: "返金対応待ち", value: yen(summary.refundPendingAmount), sub: "入金済の内数" },
              { label: "返金済", value: yen(summary.refundedAmount), sub: "手元に残らない金額" },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-xl border border-[#231714]/10 p-4">
                <p className="text-xs text-[#231714]/70">{c.label}</p>
                <p className="text-xl font-bold text-[#231714] mt-1">{c.value}</p>
                <p className="text-[11px] text-[#231714]/60 mt-1">{c.sub}</p>
              </div>
            ))}
          </div>

          {/* ── 種別内訳 ── */}
          {summary.bySource.length > 0 && (
            <div className="bg-white rounded-xl border border-[#231714]/10 p-4 mb-4">
              <h3 className="text-sm font-bold text-[#231714] mb-2">種別ごとの内訳</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[#231714]/70 border-b border-[#231714]/10">
                      <th className="py-2 pr-3 font-medium">種別</th>
                      <th className="py-2 pr-3 font-medium text-right">件数</th>
                      <th className="py-2 pr-3 font-medium text-right">入金済</th>
                      <th className="py-2 pr-3 font-medium text-right">未入金</th>
                      <th className="py-2 pr-3 font-medium text-right">返金済</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.bySource.map(({ source: s, totals }) => (
                      <tr key={s} className="border-b border-[#231714]/5">
                        <td className="py-2 pr-3">{BILLING_SOURCE_LABEL[s]}</td>
                        <td className="py-2 pr-3 text-right">{totals.count}</td>
                        <td className="py-2 pr-3 text-right font-medium">{yen(totals.receivedAmount)}</td>
                        <td className="py-2 pr-3 text-right">{yen(totals.unpaidAmount)}</td>
                        <td className="py-2 pr-3 text-right">{yen(totals.refundedAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── 明細 ── */}
          <div className="bg-white rounded-xl border border-[#231714]/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[#231714]">
                明細 <span className="font-normal text-[#231714]/60">{data?.range.label}（{records.length}件）</span>
              </h3>
              <button
                onClick={downloadCsv}
                disabled={records.length === 0}
                className="px-3 py-2 text-sm border border-[#231714]/10 rounded-lg text-[#231714]/80 hover:bg-gray-50 disabled:opacity-40"
              >
                CSVダウンロード
              </button>
            </div>

            {records.length === 0 ? (
              <p className="text-sm text-[#231714]/70 py-6 text-center">対象の請求はありません。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[#231714]/70 border-b border-[#231714]/10">
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">計上日</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">種別</th>
                      <th className="py-2 pr-3 font-medium">内容</th>
                      <th className="py-2 pr-3 font-medium">利用者</th>
                      <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">金額</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">状態</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">入金日時</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">Square 注文ID</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">返金対応</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id} className="border-b border-[#231714]/5 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">{billingDate(r, basis)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{BILLING_SOURCE_LABEL[r.source]}</td>
                        <td className="py-2 pr-3">
                          {r.itemName}
                          {r.seasonName && <span className="block text-xs text-[#231714]/60">{r.seasonName}</span>}
                          {r.useDate && basis === "paid" && (
                            <span className="block text-xs text-[#231714]/60">利用/開催 {r.useDate}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">{r.displayName}</td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap font-medium">{yen(r.amount)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <span
                            className="inline-block px-2 py-0.5 rounded-full text-xs font-bold"
                            style={{ color: STATUS_STYLE[r.status].color, background: STATUS_STYLE[r.status].bg }}
                          >
                            {BILLING_STATUS_LABEL[r.status]}
                          </span>
                          {r.refundNeeded && (
                            <span className="ml-1 inline-block px-2 py-0.5 rounded-full text-xs font-bold text-[#b4291f] bg-[#fdece8]">
                              要返金
                            </span>
                          )}
                          {r.note && <span className="block text-[11px] text-[#231714]/60 max-w-[220px]">{r.note}</span>}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-[#231714]/80">{fmtDateTime(r.paidAt)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {r.orderId ? (
                            <button
                              onClick={() => navigator.clipboard?.writeText(r.orderId as string)}
                              title="クリックでコピー"
                              className="font-mono text-xs text-[#231714]/70 hover:text-[#231714] underline decoration-dotted"
                            >
                              {r.orderId.slice(0, 10)}…
                            </button>
                          ) : (
                            <span className="text-[#231714]/40">-</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {/* 予約: 返金の記録先が他に無いのでここで記録する（Square の返金は手動）。 */}
                          {r.source === "reservation" && r.status === "refundRequested" && (
                            <button
                              onClick={() => markReservationRefunded(r)}
                              disabled={busy === r.id}
                              className="px-2.5 py-1.5 text-xs border border-[#231714]/15 rounded-lg text-[#231714]/80 hover:bg-gray-50 disabled:opacity-40"
                            >
                              {busy === r.id ? "処理中..." : "返金済にする"}
                            </button>
                          )}
                          {/* ゲーム参加費: 返金の実体は「参加費・返金」タブ。二重の入口を作らず誘導する。 */}
                          {r.source !== "reservation" && r.status === "refundRequested" && r.seasonId && (
                            <a
                              href={`/admin/games/seasons/${r.seasonId}/refunds`}
                              className="px-2.5 py-1.5 text-xs border border-[#231714]/15 rounded-lg text-[#231714]/80 hover:bg-gray-50 inline-block"
                            >
                              返金タブへ
                            </a>
                          )}
                          {r.refundNeeded && r.status === "unpaid" && r.seasonId && (
                            <a
                              href={`/admin/games/seasons/${r.seasonId}/refunds`}
                              className="px-2.5 py-1.5 text-xs border border-[#f4c9bd] bg-[#fdece8] rounded-lg text-[#b4291f] hover:opacity-80 inline-block"
                            >
                              返金タブへ
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-xs text-[#231714]/60 mt-4 leading-relaxed">
            ※ 「入金済」は Square で課金が確認できた記録です。課金済みなのに未入金のまま残った参加費は
            管理 → ゲーム → シーズン → 「参加費・返金」タブから Square 照合のうえ復旧できます。<br />
            ※ ゲーム参加費の「返金対応待ち／返金済」は「参加費・返金」タブと同じ記録です（このページは表示のみ）。<br />
            ※ <strong>Square の返金操作そのものはアプリからは行いません。</strong>
            Square 管理画面で返金してから、この画面（予約）または「参加費・返金」タブ（ゲーム）で記録してください。<br />
            ※ Googleカレンダーに直接入れた予定は課金対象外のため、この一覧には出ません（仕様）。
          </p>
        </>
      )}
    </div>
  );
}
