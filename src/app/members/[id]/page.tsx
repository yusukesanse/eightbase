"use client";

import { useState, useEffect, useLayoutEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { readCache, writeCache } from "@/lib/swrCache";

interface MemberDetail {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  catchphrase: string;
  skills: string[];
  postCount: number;
}

// メンバー一覧キャッシュの要素（プレフィル用に必要な分だけ）
interface ListMember {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  catchphrase: string;
  skills: string[];
}

// キャッシュ即表示を paint 前に反映してスピナーのちらつきを防ぐ。SSR では useEffect。
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export default function MemberDetailPage() {
  const router = useRouter();
  const params = useParams();
  const memberId = params.id as string;

  const [member, setMember] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // 1) まず前回データを即表示（個別キャッシュ→無ければ一覧キャッシュから部分プレフィル）。
  useIsomorphicLayoutEffect(() => {
    const cachedDetail = readCache<MemberDetail>(`members:${memberId}`);
    if (cachedDetail) {
      setMember(cachedDetail.data);
      setLoading(false);
      return;
    }
    const cachedList = readCache<ListMember[]>("members:list");
    const found = cachedList?.data.find((m) => m.lineUserId === memberId);
    if (found) {
      // postCount は個別取得で補完する
      setMember({
        lineUserId: found.lineUserId,
        displayName: found.displayName,
        pictureUrl: found.pictureUrl,
        catchphrase: found.catchphrase,
        skills: found.skills,
        postCount: 0,
      });
      setLoading(false);
    }
  }, [memberId]);

  // 2) 一覧キャッシュだけに依存せず、常に個別データを取得して最新化する。
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/members/${memberId}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.status === 404) {
          if (alive) setNotFound(true);
          return;
        }
        if (!res.ok) return;
        const data: MemberDetail = await res.json();
        if (!alive) return;
        setMember(data);
        writeCache(`members:${memberId}`, data);
      } catch {
        // ネットワークエラー時はプレフィル済みの表示を維持
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [memberId, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !member) {
    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        <header className="bg-white pt-12 pb-4 px-5 flex items-center gap-3 border-b border-gray-100">
          <button onClick={() => router.back()} className="p-1">
            <BackIcon />
          </button>
          <h1 className="text-[15px] font-medium text-[#231714]">メンバー</h1>
        </header>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm text-gray-700">メンバーが見つかりません</p>
          <button
            onClick={() => router.push("/members")}
            className="mt-4 text-[13px] text-[#4f757e]"
          >
            メンバー一覧へ戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* ヘッダー */}
      <div className="bg-[#A5C1C8] px-5 pt-12 pb-8">
        <button
          onClick={() => router.back()}
          className="p-1 mb-4 rounded-lg hover:bg-white/10 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M13 4l-6 6 6 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="flex flex-col items-center text-center">
          {member.pictureUrl ? (
            <img
              src={member.pictureUrl}
              alt=""
              className="w-20 h-20 rounded-full border-3 border-white object-cover mb-3"
            />
          ) : (
            <div className="w-20 h-20 rounded-full border-3 border-white bg-white/30 flex items-center justify-center mb-3">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M16 5a6 6 0 016 6v0a6 6 0 01-12 0v0a6 6 0 016-6z" stroke="white" strokeWidth="1.5" />
                <path d="M5 28c0-6 4.5-11 11-11s11 5 11 11" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          )}
          <h2 className="text-[18px] font-medium text-[#231714]">
            {member.displayName}
          </h2>
          {member.catchphrase && (
            <p className="text-[12px] text-[#231714]/80 mt-1">
              {member.catchphrase}
            </p>
          )}
        </div>
      </div>

      {/* 統計 */}
      <div className="bg-white border-b border-gray-100 flex">
        <div className="flex-1 text-center py-3">
          <p className="text-[20px] font-medium text-[#231714]">
            {member.skills.length}
          </p>
          <p className="text-[10px] text-[#231714]/80 mt-0.5">スキル</p>
        </div>
        <div className="flex-1 text-center py-3 border-l border-gray-100">
          <p className="text-[20px] font-medium text-[#231714]">
            {member.postCount}
          </p>
          <p className="text-[10px] text-[#231714]/80 mt-0.5">投稿</p>
        </div>
      </div>

      {/* スキル */}
      {member.skills.length > 0 && (
        <div className="bg-white mt-3 px-5 py-4">
          <h3 className="text-[12px] text-[#231714]/80 mb-3">スキル</h3>
          <div className="flex flex-wrap gap-2">
            {member.skills.map((skill) => (
              <span
                key={skill}
                className="px-3 py-1.5 text-[11px] rounded-full bg-[#A5C1C8]/10 text-[#4f757e] border border-[#A5C1C8]/20"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M13 4l-6 6 6 6" stroke="#231714" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
