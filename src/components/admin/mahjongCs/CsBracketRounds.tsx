"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button, GlassCard } from "@/components/ui/eb";
import {
  addRound, addTable, availableTickets, removeRound, removeTable, renameRound, setAdvanceCount,
} from "@/lib/mahjongCsBracketEdit";
import type { Chip, Draft } from "@/lib/mahjongCsBracketEdit";
import { DropZone } from "./CsBracketPieces";

// ラウンドごとの編集列を内部スクロール領域に表示する。
export default function CsBracketRounds({ draft, defaultAdvance, locked, update, renderChip, onZoneClick, isLit }: {
  draft: Draft;
  defaultAdvance: 1 | 2 | 3;
  locked: boolean;
  update: (edit: (previous: Draft) => Draft) => void;
  renderChip: (chip: Chip, from: string) => ReactNode;
  onZoneClick: (zone: string) => void;
  isLit: (zone: string) => boolean;
}) {
  const [confirmRound, setConfirmRound] = useState<number | null>(null);
  const previousLabel = useRef("");
  return (
    <div className="min-w-0 max-w-full overflow-x-auto pb-3" aria-label="ラウンド編成">
      <div className="flex items-start gap-3">
        {draft.rounds.map((round, ri) => (
          <div key={ri} className="w-[210px] shrink-0 space-y-3">
            <GlassCard padding="md" className="space-y-3">
              {draft.rounds.length >= 2 && ri === draft.rounds.length - 1 && (
                <p className="text-xs font-bold">決勝</p>
              )}
              <label className="block text-xs">
                ラウンド名
                <input
                  aria-label={`ラウンド${ri + 1}の名前`}
                  className="mt-1 w-full min-w-0 rounded-lg border p-2 text-sm"
                  value={round.label}
                  disabled={locked}
                  onFocus={() => { previousLabel.current = round.label; }}
                  onChange={(event) => update((current) => renameRound(current, ri, event.target.value))}
                  onBlur={(event) => {
                    if (!event.target.value.trim()) {
                      const label = previousLabel.current;
                      update((current) => renameRound(current, ri, label));
                    }
                  }}
                />
              </label>
              <p className="text-xs">勝ち抜け人数</p>
              <div className="flex items-center justify-between gap-1">
                <Button
                  variant="ghost" fullWidth={false} className="!h-10 !px-3"
                  aria-label={`${round.label}の勝ち抜け人数を減らす`}
                  disabled={locked || round.advanceCount <= 1}
                  onClick={() => update((current) => setAdvanceCount(current, ri, round.advanceCount - 1))}
                >−</Button>
                <span className="text-sm">{round.advanceCount}名</span>
                <Button
                  variant="ghost" fullWidth={false} className="!h-10 !px-3"
                  aria-label={`${round.label}の勝ち抜け人数を増やす`}
                  disabled={locked || round.advanceCount >= 3}
                  onClick={() => update((current) => setAdvanceCount(current, ri, round.advanceCount + 1))}
                >＋</Button>
              </div>
              <Button
                variant="ghost" className="!h-10 !text-xs" disabled={locked}
                aria-label={`${round.label}を削除`}
                onClick={() => {
                  if (round.matches.some((match) => match.seats?.some(Boolean))) setConfirmRound(ri);
                  else {
                    update((current) => removeRound(current, ri));
                    setConfirmRound(null);
                  }
                }}
              >ラウンドを削除</Button>
              {confirmRound === ri && (
                <div className="space-y-2 text-xs" role="alert">
                  <p>配置済みの席があります。このラウンドを削除しますか？</p>
                  <Button
                    variant="danger" className="!h-10 !text-xs" disabled={locked}
                    onClick={() => {
                      update((current) => removeRound(current, ri));
                      setConfirmRound(null);
                    }}
                  >削除する</Button>
                  <Button
                    variant="ghost" className="!h-10 !text-xs" disabled={locked}
                    onClick={() => setConfirmRound(null)}
                  >キャンセル</Button>
                </div>
              )}
            </GlassCard>
            {round.matches.map((match) => (
              <GlassCard key={match.matchId} padding="md" className="space-y-2">
                <h3 className="text-sm font-bold break-all">{match.label}</h3>
                {[0, 1, 2, 3].map((index) => {
                  const zone = `seat:${match.matchId}:${index}`;
                  const seat = match.seats?.[index];
                  return (
                    <DropZone
                      key={zone} zone={zone} label={`${match.label} ${index + 1}席目`}
                      locked={locked} lit={isLit(zone)} onZoneClick={onZoneClick}
                    >
                      {seat ? renderChip(seat, zone) : <span className="text-xs">空席</span>}
                    </DropZone>
                  );
                })}
                <Button
                  variant="ghost" className="!h-10 !text-xs" disabled={locked}
                  aria-label={`${match.label}を削除`}
                  onClick={() => update((current) => removeTable(current, ri, match.matchId))}
                >卓を削除</Button>
              </GlassCard>
            ))}
            <Button
              variant="secondary" className="!text-sm" disabled={locked}
              onClick={() => {
                const id = crypto.randomUUID();
                update((current) => addTable(current, ri, id));
              }}
            >卓を追加</Button>
            {ri < draft.rounds.length - 1 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold">勝ち抜けの札</h3>
                <p className="text-xs">次のラウンドの席へ置けます</p>
                {availableTickets(draft, ri + 1).map((chip) => renderChip(chip, "pool"))}
              </div>
            )}
          </div>
        ))}
        <div className="w-[210px] shrink-0">
          <Button
            variant="secondary" className="!text-sm" disabled={locked}
            onClick={() => update((current) => addRound(
              current, `ラウンド${current.rounds.length + 1}`, defaultAdvance,
            ))}
          >ラウンドを追加</Button>
        </div>
      </div>
    </div>
  );
}
