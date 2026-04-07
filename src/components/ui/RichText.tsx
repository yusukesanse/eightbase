"use client";

import React from "react";

/**
 * テキスト中の URL を自動検出してリンクにするコンポーネント。
 * 改行も保持する。
 */
export function RichText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;

  const parts = text.split(urlRegex);

  return (
    <p className={className}>
      {parts.map((part, i) => {
        if (urlRegex.test(part)) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline underline-offset-2 break-all"
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </a>
          );
        }
        // 改行を <br> に変換
        return part.split("\n").map((line, j, arr) => (
          <React.Fragment key={`${i}-${j}`}>
            {line}
            {j < arr.length - 1 && <br />}
          </React.Fragment>
        ));
      })}
    </p>
  );
}
