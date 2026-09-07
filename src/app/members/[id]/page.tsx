"use client";

import { useState, useEffect, useLayoutEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { readCache, writeCache } from "@/lib/swrCache";
import { Avatar } from "@/components/ui/LineContact";
import { Button, GlassCard, PageBg, StatusPill } from "@/components/ui/eb";

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
      <PageBg className="flex items-center justify-center">
        <div
          className="h-10 w-10 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "var(--eb-green)", borderTopColor: "transparent" }}
        />
      </PageBg>
    );
  }

  if (notFound || !member) {
    return (
      <PageBg>
        <div className="px-5 pt-[52px]">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center -ml-2"
            aria-label="戻る"
          >
            <BackIcon />
          </button>
        </div>
        <div className="flex flex-col items-center justify-center gap-4 px-5 py-20 text-center">
          <p className="text-[15px] text-[color:var(--eb-ink-muted)]">メンバーが見つかりません</p>
          <Button variant="secondary" fullWidth={false} className="px-6" onClick={() => router.push("/members")}>
            メンバー一覧へ戻る
          </Button>
        </div>
      </PageBg>
    );
  }

  return (
    <PageBg>
      <div className="px-5 pt-[52px]">
        <button
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center -ml-2"
          aria-label="戻る"
        >
          <BackIcon />
        </button>
      </div>

      <div className="px-5 pt-4 flex flex-col gap-4">
        {/* プロフィール */}
        <GlassCard>
          <div className="flex flex-col items-center text-center">
            <Avatar src={member.pictureUrl} name={member.displayName} size={64} />
            <h1 className="mt-3 text-[22px] font-bold text-[color:var(--eb-ink)]">{member.displayName}</h1>
            {member.catchphrase && (
              <p className="mt-1 text-[14px] text-[color:var(--eb-ink-muted)]">{member.catchphrase}</p>
            )}
          </div>
        </GlassCard>

        {/* 統計 */}
        <div className="grid grid-cols-2 gap-3">
          <GlassCard padding="md">
            <div className="text-center">
              <p className="text-[24px] font-bold text-[color:var(--eb-ink)]">{member.skills.length}</p>
              <p className="mt-0.5 text-[12px] text-[color:var(--eb-ink-muted)]">スキル</p>
            </div>
          </GlassCard>
          <GlassCard padding="md">
            <div className="text-center">
              <p className="text-[24px] font-bold text-[color:var(--eb-ink)]">{member.postCount}</p>
              <p className="mt-0.5 text-[12px] text-[color:var(--eb-ink-muted)]">投稿</p>
            </div>
          </GlassCard>
        </div>

        {/* スキル */}
        {member.skills.length > 0 && (
          <GlassCard>
            <h3 className="mb-3 text-[13px] font-bold text-[color:var(--eb-ink-muted)]">スキル</h3>
            <div className="flex flex-wrap gap-1.5">
              {member.skills.map((skill) => (
                <StatusPill key={skill} tone="muted">
                  {skill}
                </StatusPill>
              ))}
            </div>
          </GlassCard>
        )}
      </div>
    </PageBg>
  );
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M13 4l-6 6 6 6" stroke="var(--eb-ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
