"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { openExternalUrl } from "@/lib/liff";
import { kanaIncludes } from "@/lib/kana";
import { BottomSheet } from "@/components/ui/Sheet";
import {
  Avatar,
  LineGlyph,
  GlobeIcon,
  XGlyph,
  InstagramGlyph,
  FacebookGlyph,
  SheetButton,
} from "@/components/ui/LineContact";
import { GlassCard, PageBg, PageHeading, StatusPill, inputClass } from "@/components/ui/eb";

interface SocialLinks {
  instagram?: string;
  x?: string;
  facebook?: string;
  other?: string;
}

interface MemberItem {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  catchphrase: string;
  skills: string[];
  companyName: string;
  jobTitle: string;
  bio: string;
  companyUrl: string;
  socialLinks: SocialLinks;
  lineUrl: string;
}

const EMPTY_MEMBERS: MemberItem[] = [];

function stripUrl(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
function ensureUrl(url: string) {
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}
function snsHref(kind: "x" | "instagram" | "facebook" | "other", value: string) {
  const v = value.trim();
  if (/^https?:\/\//.test(v)) return v;
  const handle = v.replace(/^@/, "");
  if (kind === "x") return `https://x.com/${handle}`;
  if (kind === "instagram") return `https://instagram.com/${handle}`;
  if (kind === "facebook") return `https://facebook.com/${handle}`;
  return ensureUrl(v);
}

export default function MembersPage() {
  const router = useRouter();

  const { data } = useStaleWhileRevalidate<MemberItem[]>("members:list", async () => {
    const res = await fetch("/api/members", { credentials: "include", cache: "no-store" });
    if (!res.ok) {
      if (res.status === 401) router.replace("/login");
      throw new Error("failed to load members");
    }
    return res.json();
  });
  const members = data ?? EMPTY_MEMBERS;

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("すべて");

  // 詳細シート対象
  const [open, setOpen] = useState<MemberItem | null>(null);

  // スキルチップ（出現頻度順）
  const skillChips = useMemo(() => {
    const counts = new Map<string, number>();
    members.forEach((m) => m.skills.forEach((s) => counts.set(s, (counts.get(s) || 0) + 1)));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([s]) => s);
  }, [members]);

  const list = useMemo(() => {
    return members.filter((m) => {
      const matchQ =
        !q.trim() ||
        kanaIncludes(m.displayName, q) ||
        kanaIncludes(m.companyName, q) ||
        kanaIncludes(m.jobTitle, q) ||
        kanaIncludes(m.catchphrase, q) ||
        m.skills.some((s) => kanaIncludes(s, q));
      const matchF = filter === "すべて" || m.skills.includes(filter);
      return matchQ && matchF;
    });
  }, [members, q, filter]);

  function openMember(m: MemberItem) {
    setOpen(m);
  }
  function closeAll() {
    setOpen(null);
  }

  return (
    <PageBg>
      {/* ヘッダー + 検索 */}
      <div className="px-5 pt-[52px]">
        <PageHeading title="MEMBERS" subtitle="メンバー一覧" />
        <p className="mt-2 text-[13px] text-[color:var(--eb-ink-muted)]">{members.length}人のメンバー</p>
        <div className="relative mt-3">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--eb-ink-muted)]">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="名前・スキル・会社名で検索…"
            className={clsx("pl-10", inputClass)}
          />
        </div>
      </div>

      {/* スキルチップ */}
      <div className="flex gap-2 overflow-x-auto px-5 py-3.5">
        {["すべて", ...skillChips].map((f) => {
          const selected = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "shrink-0 flex h-10 items-center rounded-full px-4 text-[13px] font-bold transition-colors",
                selected ? "text-white" : "border bg-white/60 text-[color:var(--eb-ink)]"
              )}
              style={selected ? { background: "var(--eb-green)" } : { borderColor: "var(--eb-line)" }}
            >
              {f}
            </button>
          );
        })}
      </div>

      {/* メンバーカード */}
      <div className="px-5 pb-6 flex flex-col gap-3">
        {list.map((m) => (
          <MemberCard key={m.lineUserId} m={m} onOpen={() => openMember(m)} />
        ))}
        {list.length === 0 && (
          <GlassCard>
            <p className="py-2 text-center text-[15px] text-[color:var(--eb-ink-muted)]">該当者なし</p>
          </GlassCard>
        )}
      </div>

      {/* 詳細シート */}
      <BottomSheet
        open={!!open}
        title={open?.displayName ?? ""}
        onClose={closeAll}
        footer={
          <>
            <SheetButton variant="secondary" onClick={closeAll}>閉じる</SheetButton>
            <SheetButton
              line
              disabled={!open?.lineUrl}
              onClick={() => open?.lineUrl && openExternalUrl(open.lineUrl)}
            >
              LINEで連絡
            </SheetButton>
          </>
        }
      >
        {open && (
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center gap-3.5">
              <Avatar src={open.pictureUrl} name={open.displayName} size="lg" />
              <div className="min-w-0">
                {open.companyName && <div className="font-bold text-[#1c1f21]">{open.companyName}</div>}
                {open.jobTitle && <div className="text-[13px] text-[#45484d]">{open.jobTitle}</div>}
              </div>
            </div>

            {(open.bio || open.catchphrase) && (
              <div className="text-[14px] text-[#40434a] leading-[1.7] whitespace-pre-wrap">
                {open.bio || open.catchphrase}
              </div>
            )}

            {open.skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {open.skills.map((t) => (
                  <span key={t} className="px-2.5 py-1 text-[11px] rounded-full bg-[#eef4f5] text-[#3c4f54]">
                    {t}
                  </span>
                ))}
              </div>
            )}

            <MemberLinks companyUrl={open.companyUrl} sns={open.socialLinks} />

            {!open.lineUrl && (
              <p className="text-[12px] text-[#3f4247] leading-relaxed">
                この方はLINE連絡先（友だち追加URL）を未登録のため、「LINEで連絡」はご利用いただけません。
              </p>
            )}
          </div>
        )}
      </BottomSheet>
    </PageBg>
  );
}

/* ── メンバーカード ── */
function MemberCard({ m, onOpen }: { m: MemberItem; onOpen: () => void }) {
  const roleCompany = [m.jobTitle, m.companyName].filter(Boolean).join(" ・ ");
  return (
    <button onClick={onOpen} className="w-full text-left active:scale-[0.99] transition-transform">
      <GlassCard>
        <div className="flex items-center gap-3.5">
          <Avatar src={m.pictureUrl} name={m.displayName} size={48} />
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-bold text-[color:var(--eb-ink)] leading-[1.3] truncate">
              {m.displayName}
            </div>
            {roleCompany && (
              <div className="mt-0.5 text-[13px] text-[color:var(--eb-ink-muted)] truncate">{roleCompany}</div>
            )}
          </div>
          {m.lineUrl && <LineGlyph size={20} />}
        </div>
        {m.skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {m.skills.slice(0, 3).map((t) => (
              <StatusPill key={t} tone="muted">
                {t}
              </StatusPill>
            ))}
          </div>
        )}
      </GlassCard>
    </button>
  );
}

/* ── 詳細シート内のリンク欄（会社URL + SNS） ── */
function MemberLinks({ companyUrl, sns }: { companyUrl: string; sns: SocialLinks }) {
  const snsItems = (
    [
      { kind: "x" as const, value: sns.x, label: "X", Glyph: XGlyph },
      { kind: "instagram" as const, value: sns.instagram, label: "Instagram", Glyph: InstagramGlyph },
      { kind: "facebook" as const, value: sns.facebook, label: "Facebook", Glyph: FacebookGlyph },
    ] as const
  ).filter((s) => s.value && s.value.trim());

  if (!companyUrl && snsItems.length === 0) return null;

  return (
    <div className="border-t border-[#eceff1] pt-3.5">
      <p className="text-[12px] font-bold text-[#3f4247] mb-2" style={{ letterSpacing: "0.04em" }}>リンク</p>

      {companyUrl && (
        <a
          href={ensureUrl(companyUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 py-2"
        >
          <span className="text-[#7fa0a6] shrink-0">
            <GlobeIcon size={18} />
          </span>
          <span className="flex-1 min-w-0 text-[14px] text-[#3f7c98] truncate">{stripUrl(companyUrl)}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3f4247" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </a>
      )}

      {snsItems.length > 0 && (
        <div className="flex gap-2.5 mt-1.5">
          {snsItems.map(({ kind, value, label, Glyph }) => (
            <a
              key={kind}
              href={snsHref(kind, value!)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="w-10 h-10 rounded-full bg-[#f6f8f9] border border-[#eceff1] flex items-center justify-center text-[#40434a]"
            >
              <Glyph size={18} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
