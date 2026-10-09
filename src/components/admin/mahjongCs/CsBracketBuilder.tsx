"use client";

import { useCallback, useState } from "react";
import type { CSSProperties } from "react";
import type { MahjongCsEvent } from "@/types/mahjong";
import { Button, GlassCard, SegmentedTabs } from "@/components/ui/eb";
import { ticketLabel, unplacedEntrantIds, validateBracket } from "@/lib/mahjongCsBracket";
import {
  clearSeat, fillEmptySeats, initialDraft, placeChip, setTierSeeds, toggleSeed,
} from "@/lib/mahjongCsBracketEdit";
import type { Chip as ChipValue, Draft } from "@/lib/mahjongCsBracketEdit";
import { Chip, DropZone } from "./CsBracketPieces";
import CsBracketRounds from "./CsBracketRounds";
import { chipKey, useCsBracketDrag } from "./useCsBracketDrag";
import type { PickedChip } from "./useCsBracketDrag";

interface Props {
  event: MahjongCsEvent & { csEventId: string };
  onChanged: () => void;
  onError: (message: string | null) => void;
}
// 管理画面でも共通部品の色を明示する。
const palette = {
  "--eb-green": "#34835a", "--eb-green-text": "#24603f", "--eb-ink": "#231714",
  "--eb-line": "#dedbd6", "--eb-tint": "#f0f5ee", "--eb-coral": "#c85142",
} as CSSProperties;

// 大会または保存済み編成の更新時に編集状態を読み直す。
export default function CsBracketBuilder(props: Props) {
  return <Builder key={`${props.event.csEventId}:${JSON.stringify(props.event.bracket)}`} {...props} />;
}
// シード、席と札の編集および下書き保存と確定を管理する。
function Builder({ event, onChanged, onError }: Props) {
  const [defaultAdvance, setDefaultAdvance] = useState<1 | 2 | 3>(1);
  const [draft, setDraft] = useState(() => initialDraft(event, 1));
  const [saved, setSaved] = useState(() => JSON.stringify(event.bracket));
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const entrants = event.entrants ?? [];
  const ids = entrants.map((entrant) => entrant.lineUserId);
  const unplaced = unplacedEntrantIds(draft.rounds, ids);
  const seeds = entrants.filter((entrant) => draft.seedUserIds.includes(entrant.lineUserId));
  const errors = validateBracket(draft.rounds, ids);
  const dirty = JSON.stringify(draft) !== saved;

  // 編集時には古いサーバー検証結果を消す。
  const update = useCallback((edit: (current: Draft) => Draft) => {
    if (busy) return;
    setDraft(edit);
    setServerErrors([]);
  }, [busy]);
  // 置き場に応じて配置、席の解除、シード追加を適用する。
  const apply = useCallback((picked: PickedChip, zone: string) => {
    update((current) => {
      if (zone === "seed" && picked.chip.kind === "player") {
        return current.seedUserIds.includes(picked.chip.lineUserId)
          ? current : toggleSeed(current, picked.chip.lineUserId);
      }
      const target = /^seat:(.+):([0-3])$/.exec(zone);
      if (target) return placeChip(current, picked.chip, target[1], Number(target[2]));
      const source = /^seat:(.+):([0-3])$/.exec(picked.from);
      if (zone === "pool" && source) return clearSeat(current, source[1], Number(source[2]));
      return current;
    });
  }, [update]);
  const drag = useCsBracketDrag(busy, apply);

  // 人または札の表示名を作る。
  const labelFor = (chip: ChipValue) => chip.kind === "ticket"
    ? ticketLabel(draft.rounds, chip.fromMatchId, chip.place)
    : entrants.find((entrant) => entrant.lineUserId === chip.lineUserId)?.displayName ?? chip.lineUserId;
  // 共通チップに選択状態とシード操作を渡す。
  const renderChip = (chip: ChipValue, from: string) => {
    const entrant = chip.kind === "player" ? entrants.find((entry) => entry.lineUserId === chip.lineUserId) : null;
    return (
      <Chip
        key={chipKey(chip)} picked={{ chip, from }} label={labelFor(chip)} tier={entrant?.tier}
        seed={chip.kind === "player" && draft.seedUserIds.includes(chip.lineUserId)}
        selected={!!drag.selected && chipKey(drag.selected.chip) === chipKey(chip)}
        dragging={!!drag.drag && chipKey(drag.drag.chip) === chipKey(chip)} locked={busy}
        onPointerDown={drag.onPointerDown} onSelect={drag.select}
        onUnseed={chip.kind === "player" ? () => update((current) => toggleSeed(current, chip.lineUserId)) : undefined}
      />
    );
  };
  // 札の移動可能な次ラウンドだけを強調する。
  const isLit = (zone: string) => {
    const picked = drag.drag ?? drag.selected;
    if (!picked || busy || (drag.drag && drag.drag.zone !== zone)) return false;
    if (zone === "pool") return picked.from.startsWith("seat:");
    if (zone === "seed") return picked.chip.kind === "player";
    const target = /^seat:(.+):([0-3])$/.exec(zone);
    if (!target || picked.from === zone) return false;
    if (picked.chip.kind === "player") return true;
    const chip = picked.chip;
    const sourceIndex = draft.rounds.findIndex((round) => round.matches.some((m) => m.matchId === chip.fromMatchId));
    return sourceIndex >= 0 && chip.place <= draft.rounds[sourceIndex].advanceCount
      && !!draft.rounds[sourceIndex + 1]?.matches.some((match) => match.matchId === target[1]);
  };
  // 編集内容を送信し、競合や消失時には親画面へ再取得を依頼する。
  const save = async (action: "saveBracket" | "confirmBracket") => {
    if (busy || (action === "confirmBracket" && errors.length > 0)) return;
    setBusy(true);
    onError(null);
    setServerErrors([]);
    try {
      const response = await fetch(`/api/admin/mahjong/cs/${event.csEventId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...draft }),
      });
      const data = await response.json();
      if (!response.ok) {
        onError(data.error ?? "保存に失敗しました");
        if (Array.isArray(data.errors)) {
          setServerErrors(data.errors.filter((error: unknown) => typeof error === "string"));
        }
        if (response.status === 404 || response.status === 409) onChanged();
      } else {
        setSaved(JSON.stringify(draft));
        onChanged();
      }
    } catch {
      onError("保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="min-w-0 max-w-full space-y-4 text-[#231714]" style={palette}>
      <GlassCard padding="md" className="space-y-3 bg-white">
        <h2 className="text-sm font-bold">① 勝ち抜け人数とシード</h2>
        <p className="text-xs">新しいラウンドの勝ち抜け人数</p>
        <SegmentedTabs
          size="md" value={String(defaultAdvance)}
          items={[1, 2, 3].map((n) => ({ id: String(n), label: `${n}名`, disabled: busy }))}
          onChange={(value) => setDefaultAdvance(Number(value) as 1 | 2 | 3)}
        />
        <p className="text-xs">シードにまとめて追加</p>
        <div className="flex gap-4">
          {(["M1", "M2"] as const).map((tier) => {
            const members = entrants.filter((entrant) => entrant.tier === tier);
            return (
              <label key={tier} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox" disabled={busy || members.length === 0}
                  checked={members.length > 0 && members.every((entry) => draft.seedUserIds.includes(entry.lineUserId))}
                  onChange={(event) => update((current) => setTierSeeds(current, entrants, tier, event.target.checked))}
                />
                {tier}
              </label>
            );
          })}
        </div>
        <p className="text-xs">参加確定 {entrants.length}名 / うちシード {seeds.length}名</p>
      </GlassCard>
      <p className="text-xs">
        チップをドラッグ、またはタップで選択して置き場をタップしてください。
      </p>
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <h2 className="text-sm font-bold">参加者プール</h2>
          <DropZone
            zone="pool" label="参加者プールに戻す" locked={busy} lit={isLit("pool")}
            onZoneClick={drag.onZoneClick}
          >
            <p className="text-xs">未配置・ここに戻す</p>
            {entrants.filter((entry) => unplaced.includes(entry.lineUserId)
              && !draft.seedUserIds.includes(entry.lineUserId)).map((entry) => renderChip(
              { kind: "player", lineUserId: entry.lineUserId }, "pool",
            ))}
            {unplaced.length === 0 && <p className="text-xs">全員配置済み</p>}
          </DropZone>
          <DropZone
            zone="seed" label="ここに落とすとシードに追加" locked={busy} lit={isLit("seed")}
            onZoneClick={drag.onZoneClick}
          >
            <p className="text-xs">ここに落とすとシードに追加</p>
            {["M1", "M2", "その他"].map((tier) => (
              <div key={tier} className="space-y-2">
                <h3 className="text-xs font-bold">{tier}</h3>
                {seeds.filter((entry) => unplaced.includes(entry.lineUserId)
                  && (tier === "その他" ? entry.tier !== "M1" && entry.tier !== "M2" : entry.tier === tier))
                  .map((entry) => renderChip({ kind: "player", lineUserId: entry.lineUserId }, "seed"))}
              </div>
            ))}
          </DropZone>
          <Button
            variant="secondary" className="!h-auto min-h-14 !whitespace-normal !text-xs" disabled={busy}
            onClick={() => update((current) => fillEmptySeats(current, ids))}
          >未配置の人を予選の空席に順番に入れる</Button>
        </div>
        <CsBracketRounds
          draft={draft} defaultAdvance={defaultAdvance} locked={busy} update={update}
          renderChip={renderChip} onZoneClick={drag.onZoneClick} isLit={isLit}
        />
      </div>
      <footer className="sticky bottom-0 z-10 space-y-2 rounded-xl border bg-white p-3 shadow-lg">
        <p className="text-xs">
          シード {seeds.length}名（M1 {seeds.filter((entry) => entry.tier === "M1").length}・
          M2 {seeds.filter((entry) => entry.tier === "M2").length}） / 未配置 {unplaced.length}名
        </p>
        {dirty && <p className="text-xs text-amber-800">未保存の変更があります</p>}
        <div className="max-h-28 overflow-y-auto text-xs" aria-live="polite">
          {[...errors, ...serverErrors].map((error, index) => <p key={index} className="text-red-700">{error}</p>)}
          {errors.length === 0 && serverErrors.length === 0 && <p>この組み合わせで確定できます</p>}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="ghost" className="!text-sm" disabled={busy} onClick={() => save("saveBracket")}>
            下書き保存
          </Button>
          <Button className="!text-sm" disabled={busy || errors.length > 0} onClick={() => save("confirmBracket")}>
            この組み合わせで確定
          </Button>
        </div>
      </footer>
      {drag.drag && (
        <div
          ref={drag.ghostRef}
          className="pointer-events-none fixed left-0 top-0 z-50 max-w-52 rounded-xl border bg-white p-3 text-xs"
          style={{
            willChange: "transform",
            transform: `translate3d(${drag.point.current.x}px, ${drag.point.current.y}px, 0) translate(-50%, -50%)`,
          }}
        >{labelFor(drag.drag.chip)}</div>
      )}
    </section>
  );
}
