"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown エディタ（編集/プレビュー切替）。利用規約・シーズンのルール/約款で共用。 */
export function TermsEditor({
  value,
  onChange,
  label = "利用規約の内容",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-gray-600">{label}</label>
        <div className="flex border border-[#231714]/15 rounded-md overflow-hidden">
          <button
            type="button"
            onClick={() => setTab("edit")}
            className={`px-3 py-1 text-[11px] font-medium transition-colors ${
              tab === "edit"
                ? "bg-[#231714] text-white"
                : "text-[#231714]/65 hover:bg-[#231714]/5"
            }`}
          >
            編集
          </button>
          <button
            type="button"
            onClick={() => setTab("preview")}
            className={`px-3 py-1 text-[11px] font-medium transition-colors ${
              tab === "preview"
                ? "bg-[#231714] text-white"
                : "text-[#231714]/65 hover:bg-[#231714]/5"
            }`}
          >
            プレビュー
          </button>
        </div>
      </div>

      {tab === "edit" ? (
        <>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={"# 利用規約\n\n## 第1条（目的）\n\n本規定は..."}
            rows={10}
            className="w-full px-3 py-2 border border-[#231714]/20 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#231714] focus:border-transparent resize-y"
          />
          <p className="text-[10px] text-[#231714]/60 mt-1">
            Markdown記法が使えます: <code className="bg-gray-100 px-1 rounded">**太字**</code> <code className="bg-gray-100 px-1 rounded">## 見出し</code> <code className="bg-gray-100 px-1 rounded">1. 番号リスト</code> <code className="bg-gray-100 px-1 rounded">| 表 |</code>
            <br />
            太字が効かないときは前後に半角スペースを入れてください（<code className="bg-gray-100 px-1 rounded">は**待機（抜け番）**と</code> のように全角記号に挟まれると強調になりません）。
          </p>
        </>
      ) : (
        <div className="border border-[#231714]/20 rounded-lg px-4 py-3 min-h-[200px] max-h-[300px] overflow-y-auto bg-gray-50">
          {value ? (
            <div className="prose prose-sm max-w-none text-[#231714]/80
              prose-headings:text-[#231714] prose-headings:font-bold prose-headings:mt-3 prose-headings:mb-1.5
              prose-h1:text-base prose-h2:text-sm prose-h3:text-sm
              prose-p:my-1 prose-p:leading-relaxed prose-p:text-sm
              prose-li:my-0.5 prose-li:text-sm
              prose-strong:text-[#231714]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-[#231714]/55 text-center py-8">
              プレビューする内容がありません
            </p>
          )}
        </div>
      )}
    </div>
  );
}
