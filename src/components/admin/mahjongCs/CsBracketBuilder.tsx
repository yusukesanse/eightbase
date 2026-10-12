"use client";

import { useCallback, useEffect, useState } from "react";
import type { MahjongCsEvent } from "@/types/mahjong";
import { Button, GlassCard } from "@/components/ui/eb";
import { validateBracket } from "@/lib/mahjongCsBracket";
import {
  fillEmptySeats, initialCanvasDraft, keepEntrants, placePlayer, removePlayer, setTierSeeds, toggleSeed, canvasToRounds, unplacedIds,
} from "@/lib/mahjongCsCanvas";
import type { CanvasDraft as Draft } from "@/lib/mahjongCsCanvas";
import type { PlayerChip as ChipValue } from "./useCsBracketDrag";
import { Chip, DropZone } from "./CsBracketPieces";
import CsBracketCanvas from "./CsBracketCanvas";
import { chipKey, useCsBracketDrag } from "./useCsBracketDrag";
import type { PickedChip } from "./useCsBracketDrag";

interface Props {
  event: MahjongCsEvent & { csEventId: string };
  onChanged: () => void | Promise<void>;
  onError: (message: string | null) => void;
}
// SSRではデスクトップとして描画し、マウント後に画面幅へ追従する。
export function useNarrowScreen() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return narrow;
}
// 大会の切り替え時だけキャンバスを作り直す。
export default function CsBracketBuilder(props: Props) {
  return <Builder key={props.event.csEventId} {...props} />;
}
// シードと席の編集および下書き保存と確定を管理する。
function Builder({ event, onChanged, onError }: Props) {
  const narrow = useNarrowScreen();
  const [{ draft, saved }, setDraftState] = useState(() => {
    const draft = initialCanvasDraft(event);
    return { draft, saved: JSON.stringify(draft) };
  });
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const serverDraft = JSON.stringify(initialCanvasDraft(event));
  const entrants = event.entrants ?? [];
  const ids = entrants.map((entrant) => entrant.lineUserId);
  const unplaced = unplacedIds(draft, ids);
  const seeds = entrants.filter((entrant) => draft.seedUserIds.includes(entrant.lineUserId));
  const converted = canvasToRounds(draft.tables);
  const errors = converted.errors.length ? converted.errors : validateBracket(converted.rounds, ids);
  const dirty = JSON.stringify(draft) !== saved;
  const hasTables = draft.tables.length > 0;
  const locked = busy || narrow;

  // 編集時には古いサーバー検証結果を消す。
  const update = useCallback((edit: (current: Draft) => Draft) => {
    if (locked) return;
    setDraftState(current => ({ ...current, draft: edit(current.draft) }));
    setServerErrors([]);
  }, [locked]);
  // 置き場に応じて配置、席の解除、シード追加を適用する。
  const apply = useCallback((picked: PickedChip, zone: string) => {
    update((current) => {
      if (zone === "seed") {
        return current.seedUserIds.includes(picked.chip.lineUserId)
          ? current : toggleSeed(current, picked.chip.lineUserId);
      }
      if (zone.startsWith("seat:")) return placePlayer(current, picked.chip.lineUserId, zone.slice(5));
      if (zone === "pool") return removePlayer(current, picked.chip.lineUserId);
      return current;
    });
  }, [update]);
  const drag = useCsBracketDrag(locked, apply);
  const clearSelection = drag.clear;
  const entrantIds = JSON.stringify(ids);
  useEffect(() => {
    // 未保存の編成は維持し、参加取り消しだけを反映する。
    setDraftState(current => ({
      draft: JSON.stringify(current.draft) === current.saved
        ? JSON.parse(serverDraft) as Draft
        : keepEntrants(current.draft, JSON.parse(entrantIds) as string[]),
      saved: serverDraft,
    }));
    setServerErrors([]);
    clearSelection();
  }, [serverDraft, entrantIds, clearSelection]);

  const labelFor = (chip: ChipValue) => entrants.find((entry) => entry.lineUserId === chip.lineUserId)?.displayName ?? chip.lineUserId;
  // 共通チップに選択状態とシード操作を渡す。
  const renderChip = (chip: ChipValue, from: string) => {
    const entrant = entrants.find((entry) => entry.lineUserId === chip.lineUserId);
    return (
      <Chip
        key={chipKey(chip)} picked={{ chip, from }} label={labelFor(chip)} tier={entrant?.tier}
        seed={draft.seedUserIds.includes(chip.lineUserId)}
        selected={!!drag.selected && chipKey(drag.selected.chip) === chipKey(chip)}
        dragging={!!drag.drag && chipKey(drag.drag.chip) === chipKey(chip)} locked={locked}
        onPointerDown={drag.onPointerDown} onSelect={drag.select}
        onUnseed={from.startsWith("seat:") ? undefined : () => update((current) => toggleSeed(current, chip.lineUserId))}
      />
    );
  };
  const isLit = (zone: string) => {
    const picked = drag.drag ?? drag.selected;
    return !!picked && !locked && (zone !== "pool" || picked.from.startsWith("seat:"))
      && (!drag.drag || drag.drag.zone === zone);
  };
  // 編集内容を送信し、競合や消失時には親画面へ再取得を依頼する。
  const save = async (action: "saveBracket" | "confirmBracket") => {
    if (locked || (action === "confirmBracket" && errors.length > 0)) return;
    setBusy(true);
    onError(null);
    setServerErrors([]);
    try {
      const response = await fetch(`/api/admin/mahjong/cs/${event.csEventId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, seedUserIds: draft.seedUserIds, canvas: { tables: draft.tables } }),
      });
      const data = await response.json();
      if (!response.ok) {
        onError(data.error ?? "保存に失敗しました");
        if (Array.isArray(data.errors)) {
          setServerErrors(data.errors.filter((error: unknown) => typeof error === "string"));
        }
        if (response.status === 404 || response.status === 409) await onChanged();
      } else {
        setDraftState(current => ({ ...current, saved: JSON.stringify(draft) }));
        await onChanged();
      }
    } catch {
      onError("保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="min-w-0 max-w-full space-y-4 text-[#231714]">
      {narrow && <p className="text-sm">編集はパソコンでしてください</p>}
      <div className={`grid min-w-0 gap-4 ${narrow ? "grid-cols-1" : "grid-cols-[240px_minmax(0,1fr)]"}`}>
        {!narrow && <div className="min-w-0 space-y-3">
          <GlassCard padding="md" className="space-y-3 bg-white">
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
          <h2 className="text-sm font-bold">参加者プール</h2>
          <DropZone
            zone="pool" label="参加者プールに戻す" locked={locked} lit={isLit("pool")}
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
            zone="seed" label="ここに落とすとシードに追加" locked={locked} lit={isLit("seed")}
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
            variant="secondary" className="!h-auto min-h-14 !whitespace-normal !text-xs"
            disabled={busy || !hasTables}
            onClick={() => update((current) => fillEmptySeats(current, ids))}
          >未配置の人を空席に入れる</Button>
          {!hasTables && <p className="text-xs">先に卓を追加してください</p>}
        </div>}
        <CsBracketCanvas draft={draft} entrantsById={new Map(entrants.map(entry => [entry.lineUserId, entry]))}
          editable={!narrow} onChange={next => update(() => next)}
          renderPlayer={(id, tableId) => renderChip({ kind: "player", lineUserId: id }, `seat:${tableId}`)}
          onZoneClick={drag.onZoneClick} />
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
        {!narrow && <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="ghost" className="!text-sm" disabled={busy} onClick={() => save("saveBracket")}>
            下書き保存
          </Button>
          <Button className="!text-sm" disabled={busy || errors.length > 0} onClick={() => save("confirmBracket")}>
            この組み合わせで確定
          </Button>
        </div>}
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
