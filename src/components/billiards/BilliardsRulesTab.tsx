"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BILLIARDS_ACCENT } from "@/components/billiards/billiardsShared";

/** ビリヤード ルール/約款タブ（閲覧のみ）。/api/games/rules?gameCategory=billiards の Markdown を表示。 */
type Doc = "rules" | "terms";
const DOC_LABEL: Record<Doc, string> = { rules: "ルール", terms: "約款" };

export function BilliardsRulesTab() {
  const [rules, setRules] = useState("");
  const [terms, setTerms] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<Doc>("rules");

  useEffect(() => {
    let alive = true;
    fetch("/api/games/rules?gameCategory=billiards", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.error) { setError(d.error); return; }
        setRules(d.rules ?? "");
        setTerms(d.terms ?? "");
        if (!d.rules && d.terms) setDoc("terms");
      })
      .catch(() => alive && setError("読み込みに失敗しました"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>;
  if (error) return <div className="py-10 text-center text-sm text-[#d8533a]">{error}</div>;

  const available: Doc[] = ([] as Doc[]).concat(rules ? ["rules"] : [], terms ? ["terms"] : []);
  if (available.length === 0) return <div className="py-16 text-center text-sm text-[#231714]/80">ルール・約款はまだ登録されていません。</div>;
  const body = doc === "rules" ? rules : terms;

  return (
    <div className="flex flex-col gap-3">
      {available.length > 1 && (
        <div className="flex gap-1 bg-[#231714]/5 rounded-xl p-1">
          {available.map((d) => (
            <button key={d} onClick={() => setDoc(d)} className={`flex-1 py-2 rounded-lg text-xs font-bold text-center transition-all ${doc === d ? "bg-white shadow-sm" : "text-[#231714]/80"}`} style={doc === d ? { color: BILLIARDS_ACCENT } : undefined}>
              {DOC_LABEL[d]}
            </button>
          ))}
        </div>
      )}
      <article
        className="bg-white rounded-2xl p-5 prose prose-sm max-w-none text-[#231714]/90
          prose-headings:text-[#231714] prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2
          prose-h1:text-base prose-h2:text-[15px] prose-h3:text-sm
          prose-p:my-1.5 prose-p:leading-relaxed prose-p:text-[13.5px]
          prose-li:my-1 prose-li:text-[13.5px] prose-strong:text-[#231714] prose-a:text-[#1172a5]
          prose-table:text-[12.5px] prose-th:px-2 prose-td:px-2"
        style={{ boxShadow: "0 1px 2px rgba(35,23,20,.06)" }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div> }}>
          {body}
        </ReactMarkdown>
      </article>
    </div>
  );
}
