"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getLineUserId } from "@/lib/liff";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lineUserId, setLineUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    // すでに認証済みならリダイレクト
    getLineUserId()
      .then(async (id) => {
        setLineUserId(id);
        const res = await fetch("/api/auth/check", {
          headers: { "x-line-user-id": id },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.authorized) {
            router.replace("/reservation");
            return;
          }
        }
        setCheckingAuth(false);
      })
      .catch(() => {
        // LIFF 外のアクセスや未ログインの場合はそのままログイン画面を表示
        setCheckingAuth(false);
      });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, lineUserId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "ログインに失敗しました");
        return;
      }

      router.replace("/reservation");
    } catch {
      setError("通信エラーが発生しました。もう一度お試しください");
    } finally {
      setLoading(false);
    }
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ヘッダー */}
      <div className="bg-[#06C755] px-5 pt-12 pb-8 text-white">
        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center mb-3">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect x="2" y="3" width="18" height="16" rx="3" stroke="white" strokeWidth="1.5"/>
            <path d="M7 2v2M15 2v2M2 9h18" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M7 13h8M7 16h5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
        <h1 className="text-xl font-bold tracking-wide">EIGHT CANAL BASE</h1>
        <p className="text-sm text-green-100 mt-1">シェアオフィス 施設予約システム</p>
      </div>

      <div className="flex-1 px-4 pt-6 pb-8">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-800 mb-1">ログイン</h2>
          <p className="text-xs text-gray-400 mb-5 leading-relaxed">
            管理者から発行されたメールアドレスとパスワードを入力してください。
            一度ログインすると、次回以降は自動的にログインされます。
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                メールアドレス
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
                required
                autoComplete="email"
                className="w-full px-3.5 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-[#06C755] focus:ring-1 focus:ring-[#06C755] transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                パスワード
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="パスワードを入力"
                required
                autoComplete="current-password"
                className="w-full px-3.5 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-[#06C755] focus:ring-1 focus:ring-[#06C755] transition-colors"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                <p className="text-xs text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl text-sm font-semibold bg-[#06C755] text-white disabled:opacity-50 transition-opacity mt-2"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ログイン中...
                </span>
              ) : (
                "ログイン"
              )}
            </button>
          </form>
        </div>

        <p className="text-[11px] text-gray-400 text-center mt-5 leading-relaxed">
          ログインできない場合は管理者にお問い合わせください
        </p>
      </div>
    </div>
  );
}
