"use client";

import { useEffect, useState } from "react";
import type { MahjongCsEvent } from "@/types";

/**
 * CS > 麻雀 のトーナメント表（閲覧）
 */
export function MahjongCsView() {
  const [event, setEvent] = useState<MahjongCsEvent | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/mahjong/cs", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/mahjong/standings", { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([cs, st]) => {
        setEvent(cs.event ?? null);
        setCurrentUserId(st.currentUserId);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!event) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-sm text-[#231714]/40">
        チャンピオンシップはまだ開催されていません
      </div>
    );
  }

  const champion = event.championId
    ? event.entrants.find((e) => e.lineUserId === event.championId)
    : null;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <span className="text-sm font-bold text-[#231714]">{event.name}</span>
        <p className="text-[11px] text-[#231714]/40 mt-0.5">{event.eventDate}</p>
      </div>

      {champion && (
        <div className="bg-gradient-to-r from-yellow-50 to-white border border-yellow-200 rounded-2xl p-4 text-center">
          <div className="text-xs text-yellow-700 font-bold">優勝</div>
          <div className="text-lg font-bold text-[#231714] mt-1">{champion.displayName}</div>
        </div>
      )}

      {event.rounds.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-sm text-[#231714]/40">
          トーナメント表はまだ公開されていません
        </div>
      ) : (
        event.rounds.map((round, ri) => (
          <div key={ri}>
            <p className="text-xs font-bold text-[#231714]/40 mb-2 px-1">
              {round.label}（各卓 上位{round.advanceCount}名通過）
            </p>
            <div className="space-y-2">
              {round.matches.map((m) => (
                <div key={m.matchId} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-[#231714]">{m.label}</span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                        m.status === "completed"
                          ? "bg-[#B0E401]/20 text-[#231714]"
                          : "bg-orange-50 text-orange-600"
                      }`}
                    >
                      {m.status === "completed" ? "確定" : "対戦前"}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {[...m.players]
                      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                      .map((p) => (
                        <div
                          key={p.lineUserId}
                          className={`flex items-center justify-between text-sm rounded-lg px-2 py-1 ${
                            p.lineUserId === currentUserId ? "bg-[#A5C1C8]/10" : ""
                          }`}
                        >
                          <span className="text-[#231714]">
                            {p.displayName}
                            {p.lineUserId === currentUserId && (
                              <span className="ml-1 text-[11px] text-[#A5C1C8]">（自分）</span>
                            )}
                          </span>
                          <span className="text-xs text-[#231714]/50">
                            {p.rank !== null ? `${p.rank}位` : "—"}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
