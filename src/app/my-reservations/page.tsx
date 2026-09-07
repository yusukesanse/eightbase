"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { MyReservationItem } from "@/types";
import { Button, GlassCard, PageBg, PageHeading, StatusPill } from "@/components/ui/eb";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

export default function MyReservationsPage() {
  const [reservations, setReservations] = useState<MyReservationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [cancelErrorMsg, setCancelErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Cookie は自動送信されるため、ヘッダー追加不要
    fetch("/api/reservations", { credentials: "include" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setReservations(data.reservations ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[my-reservations] fetch error:", err);
          setError("予約の取得に失敗しました。ページを再読み込みしてください。");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** キャンセル確認モーダルを開く（実際の取消は confirmCancel で行う）。 */
  function requestCancel(reservationId: string) {
    setCancelErrorMsg(null);
    setConfirmTarget(reservationId);
  }

  async function confirmCancel(reservationId: string) {
    setCancellingId(reservationId);
    setCancelErrorMsg(null);
    try {
      const res = await fetch(`/api/reservations/${reservationId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) {
        setCancelErrorMsg(data.message ?? "キャンセルに失敗しました。");
        return;
      }

      setReservations((prev) =>
        prev.filter((r) => r.reservationId !== reservationId)
      );
      setConfirmTarget(null);
    } catch {
      setCancelErrorMsg("通信エラーが発生しました。");
    } finally {
      setCancellingId(null);
    }
  }

  const today = dayjs().format("YYYY-MM-DD");
  const upcoming = reservations.filter((r) => r.date >= today);
  const past = reservations.filter((r) => r.date < today);

  const confirmTargetReservation = reservations.find((r) => r.reservationId === confirmTarget) ?? null;

  return (
    <PageBg>
      <div className="px-5 pt-8">
        <PageHeading
          title="MY RESERVATIONS"
          subtitle="予約の確認・キャンセル"
          right={
            <Link
              href="/reservation"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-white/60 px-3 text-[13px] max-[360px]:text-[12px] font-bold text-[color:var(--eb-ink)]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0">
                <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              施設予約
            </Link>
          }
        />
      </div>

      <div className="space-y-3 px-5 pt-6">
        {loading ? (
          <GlassCard className="py-10 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--eb-line)] border-t-[color:var(--eb-green)]" />
            <p className="mt-2 text-[15px] text-[color:var(--eb-ink-muted)]">読み込み中...</p>
          </GlassCard>
        ) : error ? (
          <GlassCard tone="coral" className="py-8 text-center">
            <div
              className="mx-auto mb-3 flex items-center justify-center rounded-full"
              style={{ width: 48, height: 48, background: "rgba(217,72,58,.14)" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="var(--eb-coral-text)" strokeWidth="1.5" />
                <path d="M12 8v4M12 16h.01" stroke="var(--eb-coral-text)" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-[15px] text-[color:var(--eb-coral-text)]">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 text-[13px] font-bold text-[color:var(--eb-green-text)] underline"
            >
              再読み込み
            </button>
          </GlassCard>
        ) : upcoming.length === 0 && past.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {upcoming.length > 0 && (
              <>
                <p className="text-[13px] font-bold text-[color:var(--eb-ink-muted)]">今後の予約</p>
                {upcoming.map((r) => (
                  <ReservationCard
                    key={r.reservationId}
                    reservation={r}
                    onRequestCancel={requestCancel}
                    cancelling={cancellingId === r.reservationId}
                  />
                ))}
              </>
            )}

            {upcoming.length === 0 && (
              <GlassCard padding="md" className="text-center">
                <p className="text-[13px] text-[color:var(--eb-ink-muted)]">今後の予約はありません</p>
              </GlassCard>
            )}

            {past.length > 0 && (
              <>
                <p className="pt-1 text-[13px] font-bold text-[color:var(--eb-ink-muted)]">過去の予約</p>
                {past.map((r) => (
                  <ReservationCard
                    key={r.reservationId}
                    reservation={r}
                    onRequestCancel={requestCancel}
                    cancelling={false}
                    isPast
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {confirmTargetReservation && (
        <CancelConfirmModal
          reservation={confirmTargetReservation}
          busy={cancellingId === confirmTargetReservation.reservationId}
          errorMsg={cancelErrorMsg}
          onConfirm={() => confirmCancel(confirmTargetReservation.reservationId)}
          onClose={() => {
            setConfirmTarget(null);
            setCancelErrorMsg(null);
          }}
        />
      )}
    </PageBg>
  );
}

function ReservationCard({
  reservation: r,
  onRequestCancel,
  cancelling,
  isPast = false,
}: {
  reservation: MyReservationItem;
  onRequestCancel: (id: string) => void;
  cancelling: boolean;
  isPast?: boolean;
}) {
  const dateLabel = dayjs(r.date).format("M月D日（ddd）");

  // キャンセル期限（終了時刻まで可能）。同伴者は自分の予約ではないのでキャンセルできない
  // （サーバー側も本人確認で 403 を返す。ここはボタンを出さないだけ）。
  const endDt = dayjs(`${r.date}T${r.endTime}:00`);
  const canCancel = !isPast && !r.isCompanion && dayjs().isBefore(endDt);
  const companionNames = (r.companions ?? []).map((c) => c.displayName).join("、");

  // 決済待ちの仮押さえ。**確定予約と混ぜて見せない**。
  // これを表示しないと「決済せず離脱した仮押さえ」が見えないまま枠を握り続け、
  // 利用者は「取り消したのに時間が選べない」状態になる。
  const isPending = r.status === "pending_payment";
  const pendingMinutesLeft = r.pendingExpiresAt
    ? Math.max(0, Math.ceil(dayjs(r.pendingExpiresAt).diff(dayjs(), "minute", true)))
    : null;

  // トレーラー等（決済済み）: 解錠コードと取消ラベルを出し分け
  const isTrailer = !!(r.switchBotPasscode || r.paymentTransactionId);
  const showPasscode = !isPast && !!r.switchBotPasscode;
  // 発行失敗(failed)／SwitchBot未連携(manual) は「管理者連絡待ち」を表示。
  const passcodePending =
    !isPast &&
    !r.switchBotPasscode &&
    (r.switchBotStatus === "failed" || r.switchBotStatus === "manual");

  // ステータス表示: 決済待ち=gold／過去=muted／それ以外(確定)=green。
  const statusTone = isPending ? "gold" : isPast ? "muted" : "green";
  const statusLabel = isPending ? "決済待ち" : isPast ? "終了" : "予約確定";

  return (
    <GlassCard padding="md" className={isPast ? "opacity-60" : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[20px] font-bold text-[color:var(--eb-ink)]">{dateLabel}</p>
          <p className="mt-0.5 text-[15px] font-bold text-[color:var(--eb-ink)]">
            {r.facilityName}
            {r.isCompanion && (
              <span
                className="ml-2 align-middle rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={{ background: "var(--eb-tint)", color: "var(--eb-ink-muted)" }}
              >
                同伴
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[13px] text-[color:var(--eb-ink-muted)]">
            {r.startTime}〜{r.endTime}
          </p>
        </div>
        <StatusPill tone={statusTone} className="shrink-0">
          {statusLabel}
        </StatusPill>
      </div>

      {isPending && (
        <p className="mt-2 text-[13px]" style={{ color: "var(--eb-gold-text)" }}>
          お支払いが未完了です。
          {pendingMinutesLeft !== null && `あと約${pendingMinutesLeft}分で自動的に解放されます。`}
          すぐに枠を空けたいときは「仮押さえを取消」を押してください。
        </p>
      )}
      {r.isCompanion ? (
        r.organizerName && (
          <p className="mt-1 truncate text-[13px] text-[color:var(--eb-ink-muted)]">予約者: {r.organizerName}</p>
        )
      ) : (
        companionNames && (
          <p className="mt-1 truncate text-[13px] text-[color:var(--eb-ink-muted)]">
            一緒に入る人: {companionNames}
          </p>
        )
      )}

      {showPasscode && (
        <div className="mt-3 rounded-2xl px-4 py-3 text-center" style={{ background: "var(--eb-tint)" }}>
          <div className="text-[12px] font-bold text-[color:var(--eb-green-text)]">解錠コード</div>
          <div className="text-[26px] font-black tabular-nums tracking-[0.15em] text-[color:var(--eb-ink)]">
            {r.switchBotPasscode}
          </div>
          <div className="text-[12px] text-[color:var(--eb-ink-muted)]">
            {r.startTime}〜{r.endTime} のみ有効
          </div>
        </div>
      )}
      {passcodePending && (
        <div className="mt-3 rounded-2xl px-4 py-3 text-center" style={{ background: "rgba(217,169,58,.14)" }}>
          <p className="text-[13px]" style={{ color: "var(--eb-gold-text)" }}>
            解錠コードは準備が整い次第、管理者からご連絡します。お急ぎの場合は管理者へお問い合わせください。
          </p>
        </div>
      )}

      {canCancel && (
        <div className="mt-3">
          <Button variant="danger" loading={cancelling} onClick={() => onRequestCancel(r.reservationId)}>
            {isPending ? "仮押さえを取消" : isTrailer ? "予約取消（返金）" : "キャンセル"}
          </Button>
        </div>
      )}
    </GlassCard>
  );
}

/** キャンセル確認モーダル（文言は従来どおり・見た目のみ刷新）。 */
function CancelConfirmModal({
  reservation: r,
  busy,
  errorMsg,
  onConfirm,
  onClose,
}: {
  reservation: MyReservationItem;
  busy: boolean;
  errorMsg: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="safe-area-pb w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <GlassCard>
          <h3 className="text-[17px] font-bold text-[color:var(--eb-ink)]">予約のキャンセル</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
            {r.facilityName}（{dayjs(r.date).format("M月D日（ddd）")} {r.startTime}〜{r.endTime}）の
            この予約をキャンセルしますか？
          </p>
          {errorMsg && (
            <p className="mt-2 text-[13px]" style={{ color: "var(--eb-coral-text)" }}>{errorMsg}</p>
          )}
          <div className="mt-5 flex flex-col gap-2">
            <Button variant="danger" loading={busy} onClick={onConfirm}>
              キャンセルする
            </Button>
            <Button variant="ghost" onClick={onClose}>
              やめる
            </Button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <GlassCard className="py-12 text-center">
      <div
        className="mx-auto mb-3 flex items-center justify-center rounded-full"
        style={{ width: 56, height: 56, background: "var(--eb-tint)" }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4" width="18" height="17" rx="3" stroke="var(--eb-ink-muted)" strokeWidth="1.5" />
          <path d="M8 3v2M16 3v2M3 9h18" stroke="var(--eb-ink-muted)" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M8 13h4M8 17h6" stroke="var(--eb-ink-muted)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-[15px] text-[color:var(--eb-ink)]">予約はありません</p>
      <p className="mt-1 text-[13px] text-[color:var(--eb-ink-muted)]">施設予約から予約を作成できます</p>
      <Link
        href="/reservation"
        className="mt-4 inline-flex h-11 items-center rounded-xl border border-[color:var(--eb-green)] px-4 text-[13px] font-bold text-[color:var(--eb-green-text)]"
      >
        施設を予約する
      </Link>
    </GlassCard>
  );
}
