"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Facility } from "@/types";
import { getLineProfile } from "@/lib/liff";
import { readReservationDraft, clearReservationDraft } from "@/lib/reservationDraft";
import { Button, GlassCard, PageBg, PageHeading } from "@/components/ui/eb";

import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

type Step = "confirm" | "loading" | "done" | "error";

function ConfirmContent() {
  const router = useRouter();
  const params = useSearchParams();
  const facilityId  = params.get("facilityId") ?? "";
  const date        = params.get("date") ?? "";
  const startTime   = params.get("startTime") ?? "";
  const endTime     = params.get("endTime") ?? "";
  const termsAgreed = params.get("termsAgreed") === "true";

  const [facility, setFacility] = useState<Facility | null>(null);
  const dateLabel = dayjs(date).format("M月D日（ddd）");

  // 同伴者は URL ではなく sessionStorage で受け渡す（lineUserId を履歴に残さない）。
  // 予約内容が一致する下書きだけを拾うので、別予約の残骸は混ざらない。
  const companions = useMemo(
    () => readReservationDraft({ facilityId, date, startTime, endTime })?.companions ?? [],
    [facilityId, date, startTime, endTime]
  );
  // リロードや直リンクで下書きが消えると同伴者を復元できない。黙って1人で確定させない。
  const companionsLost = facility?.requireCompanions === true && companions.length === 0;

  const [step, setStep] = useState<Step>("confirm");
  const [displayName, setDisplayName] = useState<string>("");
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [profileLoaded, setProfileLoaded] = useState(false);

  // 施設情報を取得
  useEffect(() => {
    if (!facilityId) return;
    fetch("/api/facilities")
      .then((r) => r.json())
      .then((data) => {
        const found = (data.facilities as Facility[])?.find((f) => f.id === facilityId);
        setFacility(found ?? null);
      })
      .catch(() => {});
  }, [facilityId]);

  useEffect(() => {
    // LINE プロフィールは表示名取得のみ使用（認証はセッションCookieで行う）
    getLineProfile()
      .then((p) => {
        setDisplayName(p.displayName);
      })
      .catch(() => {
        // LIFF 環境外では表示名を空のままにする（サーバー側でFirestoreから取得）
        setDisplayName("");
      })
      .finally(() => setProfileLoaded(true));
  }, []);

  async function handleReserve() {
    setStep("loading");

    try {
      // ── 予約を作成（決済なし） ──
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          facilityId, date, startTime, endTime, displayName, termsAgreed,
          ...(companions.length
            ? { companionIds: companions.map((c) => c.lineUserId) }
            : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.message ?? "予約に失敗しました。もう一度お試しください。");
        setStep("error");
        return;
      }

      clearReservationDraft();
      setReservationId(data.reservationId);
      setStep("done");
    } catch {
      setErrorMsg("通信エラーが発生しました。");
      setStep("error");
    }
  }

  if (step === "loading") {
    return (
      <PageBg className="flex min-h-screen flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--eb-line)] border-t-[color:var(--eb-green)]" />
        <p className="text-[15px] text-[color:var(--eb-ink-muted)]">予約処理中...</p>
      </PageBg>
    );
  }

  if (step === "done") {
    return (
      <PageBg>
        <div className="px-5 pt-8">
          <div className="flex flex-col items-center gap-2 pb-2 pt-4 text-center">
            <div
              className="flex items-center justify-center rounded-full"
              style={{ width: 64, height: 64, background: "rgba(35,147,94,.14)" }}
            >
              <svg width="28" height="28" viewBox="0 0 26 26" fill="none">
                <path d="M4 13l6 6L22 7" stroke="var(--eb-green-text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="text-[22px] font-bold text-[color:var(--eb-ink)]">予約が完了しました</h1>
            <p className="text-[13px] text-[color:var(--eb-ink-muted)]">
              {facility?.name} — {dateLabel} {startTime}〜{endTime}
            </p>
          </div>
        </div>

        <div className="space-y-3 px-5 pt-4">
          {/* 通知済みバッジ */}
          <div className="flex items-center gap-2 rounded-2xl px-4 py-3" style={{ background: "rgba(35,147,94,.14)" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
              <path d="M8 2C5.24 2 3 4.02 3 6.5c0 1.7.97 3.18 2.4 4.02L4.5 13l2.5-1.2c.33.07.66.1 1 .1 2.76 0 5-2.02 5-4.5S10.76 2 8 2z" fill="var(--eb-green)" />
            </svg>
            <p className="text-[13px] text-[color:var(--eb-green-text)]">LINE にて予約完了通知を送信しました</p>
          </div>

          {/* 予約詳細 */}
          <GlassCard padding="md">
            <div className="space-y-2.5">
              <DetailRow label="施設" value={facility?.name ?? ""} />
              <DetailRow label="日付" value={dateLabel} />
              <DetailRow label="時間" value={`${startTime} 〜 ${endTime}`} />
              <DetailRow label="予約者" value={displayName} />
            </div>
          </GlassCard>

          {/* アクションボタン */}
          <Button variant="secondary" onClick={() => router.push("/my-reservations")}>
            マイ予約を見る
          </Button>
          <Button variant="ghost" onClick={() => router.push("/reservation")}>
            戻る
          </Button>
        </div>
      </PageBg>
    );
  }

  if (step === "error") {
    return (
      <PageBg>
        <div className="space-y-3 px-5 pt-8">
          <PageHeading title="RESERVE" subtitle="予約エラー" />
          <GlassCard tone="coral">
            <p className="mb-1 text-[15px] font-bold text-[color:var(--eb-coral-text)]">予約できませんでした</p>
            <p className="text-[13px] text-[color:var(--eb-coral-text)]">{errorMsg}</p>
          </GlassCard>
          <Button variant="ghost" onClick={() => router.back()}>
            戻って選び直す
          </Button>
        </div>
      </PageBg>
    );
  }

  // confirm ステップ
  return (
    <PageBg>
      <div className="px-5 pt-8">
        <PageHeading title="RESERVE" subtitle="予約内容の確認" />
      </div>

      <div className="space-y-3 px-5 pt-6">
        <GlassCard>
          <p className="mb-3 text-[13px] font-bold text-[color:var(--eb-ink-muted)]">予約内容</p>
          <div className="space-y-2.5">
            <DetailRow label="施設" value={facility?.name ?? ""} />
            <DetailRow label="日付" value={dateLabel} />
            <DetailRow label="時間" value={`${startTime} 〜 ${endTime}`} />
            <DetailRow label="予約者" value={displayName || "読み込み中..."} />
            {companions.length > 0 && (
              <>
                <DetailRow
                  label="一緒に入る人"
                  value={companions.map((c) => c.displayName).join("、")}
                />
                <DetailRow label="合計人数" value={`${1 + companions.length}名`} />
              </>
            )}
            {termsAgreed && <DetailRow label="利用規約" value="同意済み ✓" />}
          </div>
        </GlassCard>

        {companionsLost && (
          <GlassCard tone="gold" padding="md">
            <p className="text-[13px]" style={{ color: "var(--eb-gold-text)" }}>
              一緒に入る人の選択が失われました。前の画面で選び直してください。
            </p>
          </GlassCard>
        )}

        <p className="text-center text-[13px] text-[color:var(--eb-ink-muted)]">
          予約確定後はLINEにて通知が届きます
        </p>

        <Button
          variant="primary"
          onClick={handleReserve}
          disabled={!profileLoaded || companionsLost}
        >
          予約を確定する
        </Button>
        <Button variant="ghost" onClick={() => router.back()}>
          戻る
        </Button>
      </div>
    </PageBg>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-[13px] text-[color:var(--eb-ink-muted)]">読み込み中...</div>}>
      <ConfirmContent />
    </Suspense>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-[color:var(--eb-ink-muted)]">{label}</span>
      <span className="text-[15px] font-bold text-[color:var(--eb-ink)]">{value}</span>
    </div>
  );
}
