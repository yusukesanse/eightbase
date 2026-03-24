"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // すでにログイン済みならダッシュボードへ
    const stored = sessionStorage.getItem("admin_token");
    if (stored) {
      fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${stored}` },
      }).then((res) => {
        if (res.ok) router.replace("/admin");
      });
    }
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });

      if (res.ok) {
        sessionStorage.setItem("admin_token", token.trim());
        router.replace("/admin");
      } else {
        setError("トークンが正しくありません");
      }
    } catch {
      setError("接続エラーが発生しました。もう一度お試しください。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
        {/* ロゴ */}
        <div className="mb-7 text-center">
          <div className="w-12 h-12 bg-gray-900 rounded-xl flex items-center justify-center mx-auto mb-3">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="2" y="3" width="18" height="16" rx="3" stroke="white" strokeWidth="1.5"/>
              <path d="M7 2v2M15 2v2M2 9h18" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M7 13h8M7 16h5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="text-lg font-bold text-gray-900">管理者ログイン</h1>
          <p className="text-xs text-gray-400 mt-1">EIGHT CANAL BASE 管理ダッシュボード</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              管理者トークン
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ADMIN_API_TOKEN を入力"
              required
              autoComplete="current-password"
              className="w-full px-3.5 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gray-800 focus:ring-1 focus:ring-gray-800 transition-colors"
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
            className="w-full py-3 rounded-xl text-sm font-semibold bg-gray-900 text-white disabled:opacity-50 transition-opacity"
          >
            {loading ? "確認中..." : "ログイン"}
          </button>
        </form>
      </div>
    </div>
  );
}
