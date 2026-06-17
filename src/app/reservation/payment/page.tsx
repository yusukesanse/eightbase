"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/ui/TopBar";
import type { Facility } from "@/types";
import Script from "next/script";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

function PaymentContent() {
  const router = useRouter();
  const params = useSearchParams();
  const facilityId = params.get("facilityId") ?? "";
  const date = params.get("date") ?? "";
  const startTime = params.get("startTime") ?? "";
  const endTime = params.get("endTime") ?? "";
  const amount = Number(params.get("amount") ?? "0");
  const termsAgreed = params.get("termsAgreed") === "true";

  const [facility, setFacility] = useState<Facility | null>(null);
  const [squareConfig, setSquareConfig] = useState<{
    applicationId: string;
    locationId: string;
    environment: string;
  } | null>(null);

  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const [tokenizing, setTokenizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cardRef = useRef<unknown>(null);
  const paymentsRef = useRef<unknown>(null);
  const dateLabel = dayjs(date).format("M月D日（ddd）");

  // 施設情報取得
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

  // Square 設定取得
  useEffect(() => {
    fetch("/api/payments/config")
      .then((r) => r.json())
      .then((data) => {
        if (data.applicationId) setSquareConfig(data);
        else setError("決済システムの設定が完了していません");
      })
      .catch(() => setError("決済設定の取得に失敗しました"));
  }, []);

  // Square Web Payments SDK 初期化
  useEffect(() => {
    if (!sdkLoaded || !squareConfig) return;

    async function initSquare() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Square = (window as any).Square;
        if (!Square) {
          setError("決済SDKの読み込みに失敗しました");
          return;
        }

        const payments = Square.payments(
          squareConfig!.applicationId,
          squareConfig!.locationId
        );
        paymentsRef.current = payments;

        const card = await payments.card();
        await card.attach("#card-container");
        cardRef.current = card;
        setCardReady(true);
      } catch (e) {
        console.error("[payment] SDK init error:", e);
        setError("カード入力フォームの初期化に失敗しました");
      }
    }

    initSquare();
    return () => {
      const card = cardRef.current as { destroy?: () => Promise<void> | void } | null;
      if (card?.destroy) {
        void card.destroy();
      }
      cardRef.current = null;
      setCardReady(false);
    };
  }, [sdkLoaded, squareConfig]);

  // カード情報からトークンを取得して確認画面へ遷移
  async function handleTokenize() {
    if (!cardRef.current) return;
    setTokenizing(true);
    setError(null);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (cardRef.current as any).tokenize();
      if (result.status === "OK" && result.token) {
        sessionStorage.setItem("squareSourceId", result.token);
        const confirmParams = new URLSearchParams({
          facilityId,
          date,
          startTime,
          endTime,
          amount: String(amount),
        });
        if (termsAgreed) confirmParams.set("termsAgreed", "true");
        router.push(`/reservation/confirm?${confirmParams.toString()}`);
      } else {
        setError("カード情報を正しく入力してください");
      }
    } catch (e) {
      console.error("[payment] Tokenize error:", e);
      setError("カード情報の処理に失敗しました");
    } finally {
      setTokenizing(false);
    }
  }

  const squareSdkUrl = squareConfig?.environment === "production"
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-40">
      <TopBar title="お支払い" subtitle="カード情報の入力" />

      {/* Square SDK 読み込み */}
      {squareConfig && (
        <Script
          src={squareSdkUrl}
          onLoad={() => setSdkLoaded(true)}
          onError={() => setError("決済SDKの読み込みに失敗しました")}
        />
      )}

      <div className="flex-1 p-4 space-y-4">
        {/* 予約サマリー */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
          <p className="text-xs font-bold text-[#231714]/40">予約内容</p>
          <div className="flex justify-between text-sm">
            <span className="text-[#231714]/50">施設</span>
            <span className="font-medium text-[#231714]">{facility?.name ?? ""}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#231714]/50">日時</span>
            <span className="font-medium text-[#231714]">{dateLabel} {startTime}〜{endTime}</span>
          </div>
          <div className="flex justify-between text-sm border-t border-gray-100 pt-2 mt-2">
            <span className="text-[#231714]/50">お支払い金額</span>
            <span className="text-lg font-bold text-[#231714]">¥{amount.toLocaleString()}</span>
          </div>
        </div>

        {/* カード入力フォーム */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-xs font-bold text-[#231714]/40 mb-3">カード情報</p>

          {!cardReady && !error && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
              <span className="ml-2 text-xs text-[#231714]/40">読み込み中...</span>
            </div>
          )}

          <div
            id="card-container"
            className={clsx(
              "min-h-[90px] rounded-lg",
              !cardReady && "opacity-0 h-0 overflow-hidden"
            )}
          />

          {cardReady && (
            <p className="text-[10px] text-[#231714]/30 mt-2">
              カード情報はSquareが安全に処理します。当サービスにカード番号は保存されません。
            </p>
          )}
        </div>

        {/* エラー */}
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* サンドボックス表示 */}
        {squareConfig?.environment === "sandbox" && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
            <p className="text-xs text-amber-700">
              テスト環境です。テスト用カード番号: 4111 1111 1111 1111
            </p>
          </div>
        )}
      </div>

      {/* フッター */}
      <div className="fixed left-0 right-0 bg-white/90 backdrop-blur-lg border-t border-gray-100 px-5 py-3 safe-area-pb" style={{ bottom: "var(--bottom-nav-height)" }}>
        <button
          onClick={handleTokenize}
          disabled={!cardReady || tokenizing}
          className={clsx(
            "w-full py-3.5 rounded-2xl text-sm font-bold transition-all",
            cardReady && !tokenizing
              ? "bg-[#231714] text-white active:scale-[0.98]"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
          )}
        >
          {tokenizing ? "処理中..." : `¥${amount.toLocaleString()} を支払う`}
        </button>
        <button
          onClick={() => router.back()}
          className="w-full py-2.5 mt-1 rounded-xl text-xs text-[#231714]/40"
        >
          戻る
        </button>
      </div>
    </div>
  );
}

export default function PaymentPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-sm text-gray-400">読み込み中...</div>}>
      <PaymentContent />
    </Suspense>
  );
}
