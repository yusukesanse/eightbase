"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { MemberProfile } from "@/types";
import { clearAuthCache } from "@/components/AuthGuard";

interface UserData {
  displayName: string;
  lineDisplayName: string;
  pictureUrl: string;
  catchphrase: string;
  skills: string[];
  postCount: number;
  reservationCount: number;
}

export default function MyPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/mypage", { credentials: "include" });
        if (!res.ok) {
          router.replace("/login");
          return;
        }
        const data = await res.json();
        setUser(data);
      } catch {
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-20">
      {/* ヘッダー */}
      <div className="bg-[#A5C1C8] px-5 pt-12 pb-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-[15px] font-medium text-white">マイページ</h1>
          <button
            onClick={() => router.push("/profile")}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M8.5 4a2 2 0 012-2h0a2 2 0 012 2v0a2 2 0 01-2 2h0a2 2 0 01-2-2zM3 17a7 7 0 0114 0" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M15 7l1.5 1.5M16.5 8.5L12 13H10v-2l4.5-4.5 2 2z" stroke="white" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-4">
          {user.pictureUrl ? (
            <img
              src={user.pictureUrl}
              alt=""
              className="w-16 h-16 rounded-full border-3 border-white object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full border-3 border-white bg-white/30 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M14 4a5 5 0 015 5v0a5 5 0 01-10 0v0a5 5 0 015-5z" stroke="white" strokeWidth="1.5" />
                <path d="M4 24c0-5.523 4.477-10 10-10s10 4.477 10 10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[17px] font-medium text-[#231714] truncate">
              {user.displayName || user.lineDisplayName}
            </p>
            {user.catchphrase ? (
              <p className="text-[12px] text-[#231714]/60 mt-1 truncate">{user.catchphrase}</p>
            ) : (
              <p className="text-[12px] text-white/50 mt-1">キャッチコピーを設定しましょう</p>
            )}
          </div>
        </div>
      </div>

      {/* 統計 */}
      <div className="bg-white border-b border-gray-100 flex">
        <div className="flex-1 text-center py-3">
          <p className="text-[20px] font-medium text-[#231714]">{user.skills.length}</p>
          <p className="text-[10px] text-[#231714]/40 mt-0.5">スキル</p>
        </div>
        <div className="flex-1 text-center py-3 border-x border-gray-100">
          <p className="text-[20px] font-medium text-[#231714]">{user.postCount}</p>
          <p className="text-[10px] text-[#231714]/40 mt-0.5">投稿</p>
        </div>
        <div className="flex-1 text-center py-3">
          <p className="text-[20px] font-medium text-[#231714]">{user.reservationCount}</p>
          <p className="text-[10px] text-[#231714]/40 mt-0.5">予約</p>
        </div>
      </div>

      {/* スキルタグ */}
      {user.skills.length > 0 && (
        <div className="bg-white px-5 py-3 border-b border-gray-100">
          <div className="flex flex-wrap gap-2">
            {user.skills.map((skill) => (
              <span
                key={skill}
                className="px-3 py-1 text-[11px] rounded-full bg-[#A5C1C8] text-white"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* メニュー */}
      <div className="mt-3">
        <MenuItem
          icon={<UserEditIcon />}
          label="プロフィール編集"
          onClick={() => router.push("/profile")}
        />
        <MenuItem
          icon={<BriefcaseIcon />}
          label="スキル・サービス設定"
          onClick={() => router.push("/mypage/skills")}
        />
        <MenuItem
          icon={<HistoryIcon />}
          label="予約履歴"
          onClick={() => router.push("/my-reservations")}
        />
        <MenuItem
          icon={<LogoutIcon />}
          label="ログアウト"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
            clearAuthCache();
            router.replace("/");
          }}
          danger
        />
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-5 py-4 bg-white border-b border-gray-50 hover:bg-gray-50 transition-colors text-left"
    >
      <span className={danger ? "text-red-400" : "text-[#A5C1C8]"}>{icon}</span>
      <span className={`flex-1 text-[13px] ${danger ? "text-red-500" : "text-[#231714]"}`}>{label}</span>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M5 3l4 4-4 4" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

function UserEditIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 3a3.5 3.5 0 013.5 3.5v0A3.5 3.5 0 0110 10v0a3.5 3.5 0 01-3.5-3.5v0A3.5 3.5 0 0110 3z" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M3 17c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}
function BriefcaseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="6" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M7 6V4.5A1.5 1.5 0 018.5 3h3A1.5 1.5 0 0113 4.5V6" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M10 6v4l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M7 17H4a1 1 0 01-1-1V4a1 1 0 011-1h3M13 14l4-4-4-4M17 10H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
