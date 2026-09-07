"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GlassCard, SegmentedTabs } from "@/components/ui/eb";

/**
 * ルール/約款タブ（閲覧のみ・同意フローは持たない）。
 * 内容は管理画面のシーズン設定で Markdown として登録する（シーズンは種目別なので
 * 「種目ごと × シーズンごと」になる）。未登録の項目は切替に出さない。
 */

type Doc = "rules" | "terms";
const DOC_LABEL: Record<Doc, string> = { rules: "ルール", terms: "約款" };

export function MahjongRulesTab() {
  const [rules, setRules] = useState("");
  const [terms, setTerms] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<Doc>("rules");

  useEffect(() => {
    let alive = true;
    fetch("/api/games/rules?gameCategory=mahjong", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.error) { setError(d.error); return; }
        setRules(d.rules ?? "");
        setTerms(d.terms ?? "");
        // ルールが未登録なら約款を先に開く（空の画面を見せない）
        if (!d.rules && d.terms) setDoc("terms");
      })
      .catch(() => alive && setError("読み込みに失敗しました"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 rounded-full animate-spin border-2 border-t-transparent" style={{ borderColor: "rgba(35,147,94,.3)", borderTopColor: "transparent" }} />
      </div>
    );
  }
  if (error) {
    return <div className="py-10 text-center text-[15px] text-[color:var(--eb-coral-text)]">{error}</div>;
  }

  const available: Doc[] = ([] as Doc[]).concat(rules ? ["rules"] : [], terms ? ["terms"] : []);

  if (available.length === 0) {
    return (
      <div className="py-16 text-center text-[15px] text-[color:var(--eb-ink-muted)]">
        ルール・約款はまだ登録されていません。
      </div>
    );
  }

  const body = doc === "rules" ? rules : terms;

  return (
    <div className="flex flex-col gap-3">
      {/* 2つとも登録されているときだけ切替を出す */}
      {available.length > 1 && (
        <SegmentedTabs
          size="md"
          value={doc}
          onChange={(d) => setDoc(d as Doc)}
          items={available.map((d) => ({ id: d, label: DOC_LABEL[d] }))}
        />
      )}

      {/* 表はスマホ幅で溢れるので、本文ではなく表だけを横スクロールさせる。 */}
      <GlassCard>
        <article
          className="prose prose-sm max-w-none text-[15px] text-[color:var(--eb-ink)]
            prose-headings:text-[color:var(--eb-ink)] prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2
            prose-h1:text-[20px] prose-h2:text-[18px] prose-h3:text-[16px]
            prose-p:my-1.5 prose-p:leading-[1.7] prose-p:text-[15px]
            prose-li:my-1 prose-li:text-[15px] prose-li:leading-[1.7]
            prose-strong:text-[color:var(--eb-ink)]
            prose-a:text-[color:var(--eb-green-text)]
            prose-table:text-[13px] prose-th:px-2 prose-td:px-2"
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              table: ({ children }) => (
                <div className="overflow-x-auto rounded-xl" style={{ background: "var(--eb-tint)" }}>
                  <table className="rounded-xl">{children}</table>
                </div>
              ),
            }}
          >
            {body}
          </ReactMarkdown>
        </article>
      </GlassCard>
    </div>
  );
}
