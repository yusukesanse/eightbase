"use client";

import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { DARTS_ACCENT, todayJst, CheckIcon } from "@/components/darts/dartsShared";
import { DartsGmPanel } from "@/components/darts/DartsGmPanel";
import { DARTS_EVENT_ORDER, DARTS_EVENT_LABEL, type DartsEventKind, type DartsZeroOneOut } from "@/types/darts";

/**
 * ダーツ 卓確認/申告タブ（利用者・麻雀 ReportTab の読み替え）。
 * 当日は3種目を順に進める。参加者は「いま受付中の種目」を自己申告する。GM にはこの上に GM パネルが出る。
 * 対象日は当日（todayJst）。demo は開催日を当日に設定して検証する。
 */

interface EventStateDto {
  kind: DartsEventKind;
  status: "pending" | "reporting" | "confirmed";
  reportedCount: number;
  total: number;
  myReported: boolean;
  results: { displayName: string; isMe: boolean; value: number | null; rank: number | null; points: number; teamId?: string }[] | null;
}
interface DayDto {
  started: boolean;
  finished: boolean;
  isGameMaster: boolean;
  participants: { displayName: string; pictureUrl?: string; isMe: boolean }[];
  events: EventStateDto[] | null;
  zeroOneVariant: { start: number; out: DartsZeroOneOut } | null;
  cricketTeams: { teamId: string; members: { displayName: string; isMe: boolean }[]; isMine: boolean }[];
}

const OUT_LABEL: Record<DartsZeroOneOut, string> = { single: "シングルアウト", double: "ダブルアウト", master: "マスターアウト" };

export function DartsReportTab({ onChanged }: { onChanged: () => void }) {
  const eventDate = todayJst();
  const [day, setDay] = useState<DayDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportKind, setReportKind] = useState<DartsEventKind | null>(null);

  const load = useCallback(() => {
    return fetch(`/api/darts/day?eventDate=${eventDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (!d.error) setDay(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [eventDate]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 12000);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const gmPanel = day?.isGameMaster ? <DartsGmPanel eventDate={eventDate} onChanged={() => { load(); onChanged(); }} /> : null;

  const events = day?.events ?? null;
  const activeEvent = events?.find((e) => e.status === "reporting") ?? null;
  const myTeam = day?.cricketTeams.find((t) => t.isMine) ?? null;

  // 参加者としての当日カード（GM でも参加者なら申告できる）。
  const body = (() => {
    if (!day || !day.started) {
      return <InfoCard text="ゲームマスターの「ゲーム開始」を待っています。" />;
    }
    if (day.finished) {
      return <InfoCard text="本日の対局はすべて終了しました。結果は「リーグ」タブに反映されます。おつかれさまでした。" />;
    }
    if (!events) return <InfoCard text="準備中です。" />;

    return (
      <div className="flex flex-col gap-4">
        <EventProgress events={events} />

        {!activeEvent ? (
          <InfoCard text="ゲームマスターの準備を待っています（種別選択・チーム編成）。" />
        ) : (
          (() => {
            const isCricket = activeEvent.kind === "cricket";
            // 自分がこの種目の申告者か（個人=参加者全員 / クリケット=自チームがある人）。
            const amParticipant = day.participants.some((p) => p.isMe);
            const canReport = isCricket ? !!myTeam : amParticipant;
            const mine = activeEvent.results?.find((r) => r.isMe) ?? null;
            const teamReported =
              isCricket && myTeam
                ? (activeEvent.results ?? []).some((r) => r.isMe && r.value != null)
                : mine?.value != null;
            return (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-extrabold text-[#231714]">
                    {DARTS_EVENT_LABEL[activeEvent.kind]}
                    {activeEvent.kind === "zeroOne" && day.zeroOneVariant && (
                      <span className="ml-1.5 text-[11px] font-bold text-[#3c4f54]">
                        {day.zeroOneVariant.start}／{OUT_LABEL[day.zeroOneVariant.out]}
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] font-bold text-[#3c4f54] tabular-nums">申告 {activeEvent.reportedCount}/{activeEvent.total}</span>
                </div>

                {isCricket && myTeam && (
                  <div className="rounded-xl bg-[#f7faf8] px-3 py-2">
                    <div className="text-[10px] font-extrabold text-[#3c4f54]">あなたのチーム</div>
                    <div className="text-[13px] font-bold text-[#1c1f21]">{myTeam.members.map((m) => m.displayName).join("・")}</div>
                  </div>
                )}

                {!canReport ? (
                  <InfoCard text={isCricket ? "あなたはこの種目のチームに含まれていません。" : "あなたは本日の参加者ではありません。"} />
                ) : teamReported ? (
                  <div className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-extrabold self-start" style={{ background: "#eef4dd", color: "#6f9023" }}>
                    <CheckIcon color="#6f9023" size={14} />申告済み
                    <button onClick={() => setReportKind(activeEvent.kind)} className="ml-2 text-[11px] font-bold text-[#231714]/70 underline underline-offset-2">修正</button>
                  </div>
                ) : (
                  <button onClick={() => setReportKind(activeEvent.kind)} className="w-full py-3 rounded-2xl text-[14px] font-extrabold text-white active:scale-[0.98] transition-transform inline-flex items-center justify-center gap-1.5" style={{ background: DARTS_ACCENT }}>
                    <CheckIcon size={17} />{isCricket ? "チームのスコアを申告する" : "スコアを申告する"}
                  </button>
                )}
              </div>
            );
          })()
        )}
      </div>
    );
  })();

  return (
    <div className="flex flex-col gap-4">
      {gmPanel}
      {body}
      {reportKind && day && (
        <ReportModal
          kind={reportKind}
          variant={day.zeroOneVariant}
          eventDate={eventDate}
          onClose={() => setReportKind(null)}
          onDone={() => { setReportKind(null); load().then(onChanged); }}
        />
      )}
    </div>
  );
}

function InfoCard({ text }: { text: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-sm text-[#231714]/80">{text}</div>
  );
}

function EventProgress({ events }: { events: EventStateDto[] }) {
  return (
    <div className="flex items-center gap-1.5">
      {DARTS_EVENT_ORDER.map((kind, i) => {
        const e = events.find((x) => x.kind === kind);
        const st = e?.status ?? "pending";
        return (
          <div key={kind} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full h-1.5 rounded-full" style={{ background: st === "confirmed" ? DARTS_ACCENT : st === "reporting" ? `color-mix(in srgb, ${DARTS_ACCENT} 45%, #fff)` : "#e4e7e9" }} />
            <span className="text-[10px] font-bold" style={{ color: st === "pending" ? "#9aa0a6" : "#3c4f54" }}>
              {i + 1}.{DARTS_EVENT_LABEL[kind]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ReportModal({
  kind, variant, eventDate, onClose, onDone,
}: {
  kind: DartsEventKind;
  variant: { start: number; out: DartsZeroOneOut } | null;
  eventDate: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const label =
    kind === "zeroOne" ? "最終残り点数" : kind === "countUp" ? "合計点" : "チームの最終ポイント";
  const hint =
    kind === "zeroOne"
      ? `0〜${variant?.start ?? 301} の整数（0＝上がり・少ないほど上位）`
      : kind === "countUp"
        ? "8ラウンドの合計点"
        : "15ラウンド終了時のチームポイント";

  async function submit() {
    setError(null);
    if (value === "") { setError("数値を入力してください"); return; }
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) { setError("0以上の整数で入力してください"); return; }
    if (kind === "zeroOne" && variant && n > variant.start) { setError(`残り点は元数（${variant.start}）以下です`); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/darts/day/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventDate, kind, value: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "申告に失敗しました");
      else onDone();
    } catch {
      setError("申告に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 pb-8 safe-area-pb" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-[#1c1f21]">{DARTS_EVENT_LABEL[kind]}の申告</h3>
        <p className="text-[11px] text-[#231714]/85 mt-1 mb-5">全員そろうと自動で確定します。</p>

        <label className="block text-[11px] font-extrabold text-[#3f4247] tracking-[0.04em] mb-2">{label}</label>
        <div className="flex items-baseline gap-2 pb-1.5" style={{ borderBottom: `2px solid ${value ? DARTS_ACCENT : "#e4e7e9"}` }}>
          <input
            type="text" inputMode="numeric" autoFocus value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="0"
            className="flex-1 w-full min-w-0 border-0 outline-none bg-transparent font-black text-[#1c1f21] tabular-nums"
            style={{ fontSize: "30px" }}
          />
          <span className="text-[14px] font-bold text-[#3f4247]">点</span>
        </div>
        <div className="text-[11px] text-[#3f4247] mt-1.5">{hint}</div>

        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

        <div className="mt-6 flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-[#40434a] bg-white rounded-2xl" style={{ boxShadow: "inset 0 0 0 1px #e4e7e9" }}>キャンセル</button>
          <button onClick={submit} disabled={busy} className="flex-1 py-3 text-sm font-extrabold text-white rounded-2xl active:scale-[0.98] disabled:opacity-50" style={{ background: DARTS_ACCENT }}>
            {busy ? "送信中..." : "申告する"}
          </button>
        </div>
      </div>
    </div>
  );
}
