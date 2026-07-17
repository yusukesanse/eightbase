"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { openExternalUrl } from "@/lib/liff";
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

// カバー画像が無いメンバー用のブランド系グラデ（本番は LINE プロフィールカバー）
const BANNERS = [
  "linear-gradient(120deg, #a5c1c7 0%, #7fa0a6 100%)",
  "linear-gradient(120deg, #c4d7db 0%, #8fb0b6 100%)",
  "linear-gradient(120deg, #b9c7cc 0%, #5f7a80 100%)",
  "linear-gradient(120deg, #d3dee0 0%, #a5c1c7 100%)",
];

/* ── ひらがな↔カタカナ対応の部分一致 ── */
function toKatakana(s: string) {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}
function toHiragana(s: string) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
function kanaIncludes(target: string, query: string) {
  const t = (target || "").toLowerCase();
  const q = query.toLowerCase();
  return t.includes(q) || t.includes(toKatakana(q)) || t.includes(toHiragana(q));
}

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
    <div className="min-h-screen pb-20" style={{ background: "#f3f5f6" }}>
      {/* ヘッダー + 検索 */}
      <div className="px-5 pt-12">
        <h1 className="text-[18px] font-bold text-[#1c1f21]">メンバー</h1>
        <p className="text-[12px] text-[#6d6f74] mt-0.5">{members.length}人のメンバー</p>
        <div className="relative mt-3">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6e73]">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="名前・スキル・会社名で検索…"
            className="w-full pl-9 pr-4 py-2.5 text-[14px] bg-white rounded-xl border border-[#eceff1] focus:outline-none focus:border-[#a5c1c7] transition-colors"
          />
        </div>
      </div>

      {/* スキルチップ */}
      <div className="flex gap-2 overflow-x-auto px-5 py-3.5">
        {["すべて", ...skillChips].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 px-3.5 py-1.5 text-[12px] font-medium rounded-full border transition-colors ${
              filter === f
                ? "bg-[#4f757e] text-white border-[#a5c1c7]"
                : "bg-white text-[#6d6f74] border-[#eceff1]"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* メンバーカード */}
      <div className="px-5 pb-6 flex flex-col gap-3.5">
        {list.map((m, i) => (
          <MemberCard key={m.lineUserId} m={m} banner={BANNERS[i % BANNERS.length]} onOpen={() => openMember(m)} />
        ))}
        {list.length === 0 && (
          <div className="bg-white rounded-[18px] py-7 text-center text-[14px] text-[#6b6e73] shadow-sm">該当者なし</div>
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
                {open.jobTitle && <div className="text-[13px] text-[#6d6f74]">{open.jobTitle}</div>}
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
                  <span key={t} className="px-2.5 py-1 text-[11px] rounded-full bg-[#eef4f5] text-[#5f7a80]">
                    {t}
                  </span>
                ))}
              </div>
            )}

            <MemberLinks companyUrl={open.companyUrl} sns={open.socialLinks} />

            {!open.lineUrl && (
              <p className="text-[12px] text-[#6b6e73] leading-relaxed">
                この方はLINE連絡先（友だち追加URL）を未登録のため、「LINEで連絡」はご利用いただけません。
              </p>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

/* ── メンバーカード（プロフィールカバー型） ── */
function MemberCard({ m, banner, onOpen }: { m: MemberItem; banner: string; onOpen: () => void }) {
  const more = Math.max(0, m.skills.length - 3);
  const roleCompany = [m.jobTitle, m.companyName].filter(Boolean).join(" ・ ");
  return (
    <button
      onClick={onOpen}
      className="relative w-full text-left bg-white rounded-[18px] overflow-hidden active:scale-[0.99] transition-transform"
      style={{ boxShadow: "0 1px 3px rgba(28,31,33,.05), 0 6px 16px rgba(28,31,33,.05)" }}
    >
      {/* カバー */}
      <div className="relative h-[92px]" style={{ background: banner }}>
        <span
          className="absolute right-2.5 bottom-2 inline-flex items-center gap-1 h-[22px] pl-1.5 pr-2 rounded-full"
          style={{ background: "rgba(255,255,255,.92)" }}
        >
          <LineGlyph size={12} />
          <span className="text-[10.5px] font-bold text-[#6d6f74]">LINE</span>
        </span>
      </div>

      {/* アバター（カバーに重なる） */}
      <div className="absolute left-4" style={{ top: 50 }}>
        <Avatar src={m.pictureUrl} name={m.displayName} size={72} style={{ boxShadow: "0 0 0 4px #ffffff" }} />
      </div>

      {/* テキスト */}
      <div style={{ padding: "40px 16px 16px" }}>
        <div className="text-[18px] font-bold text-[#1c1f21] leading-[1.3]">{m.displayName}</div>
        {roleCompany && (
          <div className="text-[14px] text-[#6d6f74] mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">{roleCompany}</div>
        )}
        {m.skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {m.skills.slice(0, 3).map((t) => (
              <span key={t} className="px-2.5 py-1 text-[11px] rounded-full bg-[#f6f8f9] text-[#6d6f74]">
                {t}
              </span>
            ))}
            {more > 0 && <span className="px-2.5 py-1 text-[11px] rounded-full bg-[#eef4f5] text-[#5f7a80]">+{more}</span>}
          </div>
        )}
      </div>
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
      <p className="text-[12px] font-bold text-[#6b6e73] mb-2" style={{ letterSpacing: "0.04em" }}>リンク</p>

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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b6e73" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
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
