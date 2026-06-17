"use client";

/**
 * /invite/[token] — ワンタイム招待URLのランディングページ
 *
 * どこからでも開ける（ブラウザ、メール、Slack等）。
 * 「LINEで登録する」ボタンを押すと LIFF URL に遷移し、
 * LINEアプリ内でアカウント連携が完了する。
 */

import { useParams } from "next/navigation";

export default function InviteLandingPage() {
  const params = useParams();
  const token = params.token as string;

  // LIFF URL を構築: エンドポイントURL に ?invite=<token> を付与
  // LIFF の Endpoint URL が https://customer-domain.com に設定されている前提
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID_PROD
    || process.env.NEXT_PUBLIC_LIFF_ID_REVIEW
    || process.env.NEXT_PUBLIC_LIFF_ID
    || "";
  const liffUrl = liffId
    ? `https://liff.line.me/${liffId}?invite=${encodeURIComponent(token)}`
    : "";

  return (
    <div className="min-h-screen bg-[#FAF7F2] flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        {/* ロゴ */}
        <div className="w-16 h-16 rounded-2xl bg-[#231714] flex items-center justify-center mx-auto mb-5">
          <div className="grid grid-cols-2 gap-0.5">
            <div className="w-3 h-3 rounded-sm bg-white/90" />
            <div className="w-3 h-3 rounded-sm bg-white/50" />
            <div className="w-3 h-3 rounded-sm bg-white/50" />
            <div className="w-3 h-3 rounded-sm bg-white/30" />
          </div>
        </div>

        <h1 className="text-xl font-bold text-[#231714]">EIGHT BASE UNGA</h1>
        <p className="text-sm text-[#231714]/50 mt-2">
          シェアオフィスへご招待いただきました
        </p>

        <div className="mt-8 space-y-3">
          {liffUrl ? (
            <a
              href={liffUrl}
              className="block w-full py-3.5 text-sm font-bold text-white rounded-xl transition-colors text-center"
              style={{ backgroundColor: "#06C755" }}
            >
              LINEで登録する
            </a>
          ) : (
            <p className="text-xs text-red-500">
              LIFF ID が設定されていません。管理者にお問い合わせください。
            </p>
          )}
        </div>

        <div className="mt-6 bg-white rounded-xl border border-[#231714]/10 p-4 text-left">
          <h2 className="text-xs font-semibold text-[#231714]/70 mb-2">登録の流れ</h2>
          <ol className="text-xs text-[#231714]/50 space-y-1.5">
            <li className="flex gap-2">
              <span className="w-5 h-5 rounded-full bg-[#231714]/5 flex items-center justify-center text-[10px] font-bold text-[#231714]/60 shrink-0">1</span>
              <span>上のボタンをタップしてLINEを開く</span>
            </li>
            <li className="flex gap-2">
              <span className="w-5 h-5 rounded-full bg-[#231714]/5 flex items-center justify-center text-[10px] font-bold text-[#231714]/60 shrink-0">2</span>
              <span>LINEアカウントでログイン</span>
            </li>
            <li className="flex gap-2">
              <span className="w-5 h-5 rounded-full bg-[#231714]/5 flex items-center justify-center text-[10px] font-bold text-[#231714]/60 shrink-0">3</span>
              <span>プロフィール情報を入力して完了</span>
            </li>
          </ol>
        </div>

        <p className="mt-6 text-[10px] text-[#231714]/30">
          この招待URLの有効期限は7日間です
        </p>
      </div>
    </div>
  );
}
