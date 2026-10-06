"use client";

import { useEffect, useState } from "react";
import { BottomSheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/LineContact";
import type { UserSummary } from "@/lib/userSummaries";

export function LikersSheet({ open, onClose, fetchUrl, title = "いいねした人" }: {
  open: boolean;
  onClose: () => void;
  fetchUrl: string;
  title?: string;
}) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) {
      setUsers([]);
      setError(false);
      setLoading(true);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(false);
    setUsers([]);
    (async () => {
      try {
        const res = await fetch(fetchUrl, { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error("Failed to load likers");
        const data = await res.json();
        if (!cancelled) setUsers(Array.isArray(data?.users) ? data.users : []);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [open, fetchUrl]);

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="text-[15px] text-[color:var(--eb-ink)]" aria-live="polite">
        {loading ? <p className="py-6 text-center">読み込み中…</p>
          : error ? <p role="alert" className="py-6 text-center text-[color:var(--eb-coral-text)]">読み込めませんでした。閉じてもう一度お試しください。</p>
          : users.length === 0 ? <p className="py-6 text-center text-[color:var(--eb-ink-muted)]">表示できる人はいません</p>
          : <ul className="flex flex-col gap-3">
            {users.map((user, index) => (
              <li key={index} className="flex min-h-14 items-center gap-3">
                <Avatar src={user.pictureUrl} name={user.name} size="md" />
                <span className="min-w-0 break-words">{user.name}</span>
              </li>
            ))}
          </ul>}
      </div>
    </BottomSheet>
  );
}
