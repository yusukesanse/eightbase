"use client";

import { useEffect, useState, useCallback } from "react";
import { GAME_CATEGORIES } from "@/types";
import type { ScoreboardGameId, Season } from "@/types";

/* ───────── 型 ───────── */

interface GameItem {
  gameId: string;
  title: string;
  category: string;
  startAt: string;
  status: string;
  participantCount: number;
  scoreRegistered?: boolean;
}

interface Participant {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  joinedAt: string;
}

interface ScoreItem {
  scoreId: string;
  gameId: string;
  gameCategory: ScoreboardGameId;
  lineUserId: string;
  totalScore: number;
  details: Record<string, unknown>;
  createdAt: string;
}

/* ───────── 定数 ───────── */

const GAME_LABELS: Record<ScoreboardGameId, string> = {
  mahjong: "麻雀",
  poker: "ポーカー",
  billiards: "ビリヤード",
  darts: "ダーツ",
};

/* ───────── メインコンポーネント ───────── */

export default function ScoresPage() {
  // ゲーム一覧
  const [games, setGames] = useState<GameItem[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);

  // 選択状態
  const [selectedGame, setSelectedGame] = useState<GameItem | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [existingScores, setExistingScores] = useState<ScoreItem[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // スコア入力モーダル
  const [scoreModal, setScoreModal] = useState(false);
  const [scoreTarget, setScoreTarget] = useState<Participant | null>(null);
  const [editingScore, setEditingScore] = useState<ScoreItem | null>(null);
  const [saving, setSaving] = useState(false);

  // 削除確認
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  /* ───────── データ取得 ───────── */

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/games", { credentials: "same-origin" }).then((r) => r.json()),
      fetch("/api/admin/scoreboard/seasons", { credentials: "same-origin" }).then((r) => r.json()),
    ]).then(([gData, sData]) => {
      // completed/awaiting_results のゲームを対象
      const eligible = (gData.games ?? []).filter(
        (g: GameItem) => g.status === "completed" || g.status === "awaiting_results"
      );
      setGames(eligible);
      setSeasons(sData.seasons ?? []);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loadGameDetail = useCallback(async (game: GameItem) => {
    setSelectedGame(game);
    setLoadingDetail(true);
    try {
      const [pRes, sRes] = await Promise.all([
        fetch(`/api/admin/games/${game.gameId}/participants`, { credentials: "same-origin" }),
        fetch(`/api/admin/scoreboard/scores?gameId=${game.gameId}`, { credentials: "same-origin" }),
      ]);
      const pData = await pRes.json();
      const sData = await sRes.json();
      setParticipants(pData.participants ?? []);
      setExistingScores(sData.scores ?? []);
    } catch {
      setParticipants([]);
      setExistingScores([]);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  /* ───────── アクティブシーズン ───────── */

  const activeSeason = seasons.find((s) => s.active);

  /* ───────── スコア登録/編集 ───────── */

  function openScoreForm(participant: Participant, existing?: ScoreItem) {
    setScoreTarget(participant);
    setEditingScore(existing ?? null);
    setScoreModal(true);
  }

  function getScoreForUser(userId: string): ScoreItem | undefined {
    return existingScores.find((s) => s.lineUserId === userId);
  }

  /* ───────── 削除 ───────── */

  async function handleDeleteScore(scoreId: string) {
    try {
      const res = await fetch(`/api/admin/scoreboard/scores/${scoreId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setDeleteTarget(null);
      if (selectedGame) await loadGameDetail(selectedGame);
    } catch (e) {
      alert(`削除に失敗しました: ${e}`);
    }
  }

  /* ───────── UI ───────── */

  const getCategoryLabel = (cat: string) =>
    GAME_CATEGORIES.find((c) => c.id === cat)?.label ?? cat;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-[#231714]">スコア入力</h2>
        <p className="text-sm text-[#231714]/40 mt-1">完了済みゲームのスコアを登録</p>
      </div>

      {!activeSeason && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-sm text-amber-700">
          有効なシーズンがありません。先にシーズン管理からシーズンを作成してください。
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex gap-6">
          {/* 左: ゲーム一覧 */}
          <div className="w-80 shrink-0">
            <p className="text-xs font-medium text-[#231714]/60 mb-2">ゲーム選択</p>
            {games.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#231714]/10 p-6 text-center text-sm text-[#231714]/40">
                対象ゲームがありません
              </div>
            ) : (
              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {games.map((g) => (
                  <button
                    key={g.gameId}
                    onClick={() => loadGameDetail(g)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      selectedGame?.gameId === g.gameId
                        ? "border-[#231714] bg-[#231714]/5 shadow-sm"
                        : "border-[#231714]/10 bg-white hover:border-[#231714]/30"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-1.5 py-0.5 rounded bg-[#A5C1C8]/15 text-[9px] font-medium text-[#231714]/70">
                        {getCategoryLabel(g.category)}
                      </span>
                      {g.scoreRegistered && (
                        <span className="px-1.5 py-0.5 rounded bg-green-100 text-[9px] font-bold text-green-700">
                          登録済
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-[#231714] truncate">{g.title}</p>
                    <p className="text-[10px] text-[#231714]/40 mt-0.5">
                      {g.startAt ? new Date(g.startAt).toLocaleDateString("ja-JP") : "—"} · {g.participantCount}名参加
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 右: 参加者一覧 + スコア */}
          <div className="flex-1 min-w-0">
            {!selectedGame ? (
              <div className="bg-white rounded-xl border border-[#231714]/10 p-10 text-center text-sm text-[#231714]/40">
                左からゲームを選択してください
              </div>
            ) : loadingDetail ? (
              <div className="flex items-center justify-center h-48">
                <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
              </div>
            ) : (
              <div>
                <div className="bg-white rounded-xl border border-[#231714]/10 p-4 mb-4">
                  <h3 className="text-base font-semibold text-[#231714]">{selectedGame.title}</h3>
                  <p className="text-xs text-[#231714]/40 mt-0.5">
                    {getCategoryLabel(selectedGame.category)} · {participants.length}名参加
                    {activeSeason && ` · シーズン: ${activeSeason.name}`}
                  </p>
                </div>

                {participants.length === 0 ? (
                  <div className="bg-white rounded-xl border border-[#231714]/10 p-8 text-center text-sm text-[#231714]/40">
                    参加者がいません
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-[#231714]/10 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-[#231714]/5">
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-[#231714]/60">参加者</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-[#231714]/60">スコア</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-[#231714]/60">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {participants.map((p) => {
                          const score = getScoreForUser(p.lineUserId);
                          return (
                            <tr key={p.lineUserId} className="border-b border-[#231714]/5 hover:bg-[#231714]/[0.02]">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  {p.pictureUrl ? (
                                    <img src={p.pictureUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                                  ) : (
                                    <div className="w-7 h-7 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center text-[10px] font-bold text-[#A5C1C8]">
                                      {p.displayName.charAt(0)}
                                    </div>
                                  )}
                                  <span className="text-sm text-[#231714] truncate">{p.displayName}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {score ? (
                                  <span className="text-sm font-bold text-[#231714]">{score.totalScore}</span>
                                ) : (
                                  <span className="text-xs text-[#231714]/30">未登録</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {score ? (
                                  <div className="flex gap-2 justify-end">
                                    <button
                                      onClick={() => openScoreForm(p, score)}
                                      className="text-xs text-[#A5C1C8] hover:underline"
                                      disabled={!activeSeason}
                                    >
                                      編集
                                    </button>
                                    <button
                                      onClick={() => setDeleteTarget(score.scoreId)}
                                      className="text-xs text-red-500 hover:underline"
                                    >
                                      削除
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => openScoreForm(p)}
                                    className="px-3 py-1 text-xs bg-[#231714] text-white rounded-lg hover:bg-[#231714]/80 disabled:opacity-50"
                                    disabled={!activeSeason}
                                  >
                                    スコア入力
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 削除確認 */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-[#231714] mb-2">削除の確認</h3>
            <p className="text-sm text-[#231714]/60 mb-5">このスコアを削除しますか？</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm border border-[#231714]/10 rounded-lg hover:bg-gray-50">キャンセル</button>
              <button onClick={() => handleDeleteScore(deleteTarget)} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">削除する</button>
            </div>
          </div>
        </div>
      )}

      {/* スコア入力モーダル */}
      {scoreModal && scoreTarget && selectedGame && activeSeason && (
        <ScoreFormModal
          game={selectedGame}
          participant={scoreTarget}
          season={activeSeason}
          existingScore={editingScore}
          onClose={() => setScoreModal(false)}
          onSaved={() => {
            setScoreModal(false);
            if (selectedGame) loadGameDetail(selectedGame);
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   種目別スコア入力モーダル
   ═══════════════════════════════════════════════════════════════ */

interface ScoreFormModalProps {
  game: GameItem;
  participant: Participant;
  season: Season;
  existingScore: ScoreItem | null;
  onClose: () => void;
  onSaved: () => void;
}

function ScoreFormModal({ game, participant, season, existingScore, onClose, onSaved }: ScoreFormModalProps) {
  const gameCategory = game.category as ScoreboardGameId;
  const [saving, setSaving] = useState(false);

  // 種目共通: totalScore
  const [totalScore, setTotalScore] = useState(existingScore?.totalScore ?? 0);

  // 麻雀
  const [mahjongRounds, setMahjongRounds] = useState<{ rank: number; score: number }[]>(
    (existingScore?.details as any)?.rounds ?? [{ rank: 1, score: 0 }]
  );

  // ポーカー
  const [pokerRank, setPokerRank] = useState((existingScore?.details as any)?.tournamentRank ?? 1);
  const [pokerChips, setPokerChips] = useState((existingScore?.details as any)?.chipCount ?? 0);
  const [pokerBounty, setPokerBounty] = useState((existingScore?.details as any)?.bountyCount ?? 0);

  // ビリヤード
  const [billiardsMatches, setBilliardsMatches] = useState<{ result: string; points: number }[]>(
    (existingScore?.details as any)?.matches ?? [{ result: "win", points: 0 }]
  );

  // ダーツ
  const [dartsRank, setDartsRank] = useState((existingScore?.details as any)?.rank ?? 1);
  const [dartsPoints, setDartsPoints] = useState((existingScore?.details as any)?.points ?? 0);
  const [dartsGameType, setDartsGameType] = useState((existingScore?.details as any)?.gameType ?? "");

  /* ───────── 自動計算 ───────── */

  useEffect(() => {
    switch (gameCategory) {
      case "mahjong":
        setTotalScore(mahjongRounds.reduce((sum, r) => sum + r.score, 0));
        break;
      case "poker":
        setTotalScore(pokerChips + pokerBounty * 100);
        break;
      case "billiards":
        setTotalScore(billiardsMatches.reduce((sum, m) => sum + m.points, 0));
        break;
      case "darts":
        setTotalScore(dartsPoints);
        break;
    }
  }, [gameCategory, mahjongRounds, pokerChips, pokerBounty, billiardsMatches, dartsPoints]);

  /* ───────── 保存 ───────── */

  async function handleSave() {
    setSaving(true);
    try {
      let details: Record<string, unknown> = {};
      switch (gameCategory) {
        case "mahjong":
          details = { rounds: mahjongRounds };
          break;
        case "poker":
          details = { tournamentRank: pokerRank, chipCount: pokerChips, bountyCount: pokerBounty };
          break;
        case "billiards":
          details = { matches: billiardsMatches };
          break;
        case "darts":
          details = { rank: dartsRank, points: dartsPoints, gameType: dartsGameType || undefined };
          break;
      }

      if (existingScore) {
        // 更新
        const res = await fetch(`/api/admin/scoreboard/scores/${existingScore.scoreId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ totalScore, details }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
      } else {
        // 新規
        const res = await fetch("/api/admin/scoreboard/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            gameId: game.gameId,
            gameCategory,
            lineUserId: participant.lineUserId,
            seasonId: season.seasonId,
            totalScore,
            details,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
      }

      onSaved();
    } catch (e) {
      alert(`保存に失敗しました: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full border border-[#231714]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#231714]";
  const labelClass = "block text-xs font-medium text-[#231714]/60 mb-1";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8">
        <div className="px-6 py-5 border-b border-[#231714]/5">
          <h3 className="text-base font-semibold text-[#231714]">
            {existingScore ? "スコア編集" : "スコア入力"}
          </h3>
          <p className="text-xs text-[#231714]/40 mt-0.5">
            {participant.displayName} · {GAME_LABELS[gameCategory]}
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* 種目別フォーム */}
          {gameCategory === "mahjong" && (
            <MahjongForm rounds={mahjongRounds} setRounds={setMahjongRounds} inputClass={inputClass} labelClass={labelClass} />
          )}
          {gameCategory === "poker" && (
            <PokerForm
              rank={pokerRank} setRank={setPokerRank}
              chips={pokerChips} setChips={setPokerChips}
              bounty={pokerBounty} setBounty={setPokerBounty}
              inputClass={inputClass} labelClass={labelClass}
            />
          )}
          {gameCategory === "billiards" && (
            <BilliardsForm matches={billiardsMatches} setMatches={setBilliardsMatches} inputClass={inputClass} labelClass={labelClass} />
          )}
          {gameCategory === "darts" && (
            <DartsForm
              rank={dartsRank} setRank={setDartsRank}
              points={dartsPoints} setPoints={setDartsPoints}
              gameType={dartsGameType} setGameType={setDartsGameType}
              inputClass={inputClass} labelClass={labelClass}
            />
          )}

          {/* 合計スコア表示 */}
          <div className="bg-[#231714]/5 rounded-xl p-4 text-center">
            <p className="text-xs text-[#231714]/50 mb-1">合計スコア</p>
            <p className="text-2xl font-bold text-[#231714]">{totalScore}</p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-[#231714]/10 rounded-lg hover:bg-gray-50">
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-[#231714] text-white rounded-lg hover:bg-[#231714]/80 disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   種目別フォーム
   ═══════════════════════════════════════════════════════════════ */

/* ─── 麻雀 ─── */
function MahjongForm({
  rounds, setRounds, inputClass, labelClass,
}: {
  rounds: { rank: number; score: number }[];
  setRounds: (r: { rank: number; score: number }[]) => void;
  inputClass: string;
  labelClass: string;
}) {
  return (
    <div>
      <label className={labelClass}>半荘ごとの結果</label>
      <div className="space-y-2">
        {rounds.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-[#231714]/40 w-12 shrink-0">{i + 1}半荘</span>
            <select
              value={r.rank}
              onChange={(e) => {
                const next = [...rounds];
                next[i] = { ...next[i], rank: Number(e.target.value) };
                setRounds(next);
              }}
              className={`${inputClass} w-20 bg-white`}
            >
              {[1, 2, 3, 4].map((v) => <option key={v} value={v}>{v}着</option>)}
            </select>
            <input
              type="number"
              placeholder="スコア"
              value={r.score || ""}
              onChange={(e) => {
                const next = [...rounds];
                next[i] = { ...next[i], score: Number(e.target.value) };
                setRounds(next);
              }}
              className={`${inputClass} flex-1`}
            />
            {rounds.length > 1 && (
              <button
                onClick={() => setRounds(rounds.filter((_, j) => j !== i))}
                className="text-xs text-red-500 hover:underline shrink-0"
              >
                削除
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={() => setRounds([...rounds, { rank: 1, score: 0 }])}
        className="mt-2 text-xs text-[#A5C1C8] hover:underline"
      >
        ＋ 半荘を追加
      </button>
    </div>
  );
}

/* ─── ポーカー ─── */
function PokerForm({
  rank, setRank, chips, setChips, bounty, setBounty, inputClass, labelClass,
}: {
  rank: number; setRank: (v: number) => void;
  chips: number; setChips: (v: number) => void;
  bounty: number; setBounty: (v: number) => void;
  inputClass: string; labelClass: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>トーナメント順位</label>
        <input type="number" min="1" value={rank || ""} onChange={(e) => setRank(Number(e.target.value))} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>チップ数</label>
        <input type="number" value={chips || ""} onChange={(e) => setChips(Number(e.target.value))} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>バウンティ数（任意）</label>
        <input type="number" min="0" value={bounty || ""} onChange={(e) => setBounty(Number(e.target.value))} className={inputClass} />
      </div>
    </div>
  );
}

/* ─── ビリヤード ─── */
function BilliardsForm({
  matches, setMatches, inputClass, labelClass,
}: {
  matches: { result: string; points: number }[];
  setMatches: (m: { result: string; points: number }[]) => void;
  inputClass: string; labelClass: string;
}) {
  return (
    <div>
      <label className={labelClass}>試合ごとの結果</label>
      <div className="space-y-2">
        {matches.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-[#231714]/40 w-12 shrink-0">第{i + 1}試合</span>
            <select
              value={m.result}
              onChange={(e) => {
                const next = [...matches];
                next[i] = { ...next[i], result: e.target.value };
                setMatches(next);
              }}
              className={`${inputClass} w-20 bg-white`}
            >
              <option value="win">勝ち</option>
              <option value="lose">負け</option>
              <option value="draw">引分</option>
            </select>
            <input
              type="number"
              placeholder="ポイント"
              value={m.points || ""}
              onChange={(e) => {
                const next = [...matches];
                next[i] = { ...next[i], points: Number(e.target.value) };
                setMatches(next);
              }}
              className={`${inputClass} flex-1`}
            />
            {matches.length > 1 && (
              <button
                onClick={() => setMatches(matches.filter((_, j) => j !== i))}
                className="text-xs text-red-500 hover:underline shrink-0"
              >
                削除
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={() => setMatches([...matches, { result: "win", points: 0 }])}
        className="mt-2 text-xs text-[#A5C1C8] hover:underline"
      >
        ＋ 試合を追加
      </button>
    </div>
  );
}

/* ─── ダーツ ─── */
function DartsForm({
  rank, setRank, points, setPoints, gameType, setGameType, inputClass, labelClass,
}: {
  rank: number; setRank: (v: number) => void;
  points: number; setPoints: (v: number) => void;
  gameType: string; setGameType: (v: string) => void;
  inputClass: string; labelClass: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>ゲームタイプ（任意）</label>
        <input type="text" value={gameType} onChange={(e) => setGameType(e.target.value)} className={inputClass} placeholder="501, クリケットなど" />
      </div>
      <div>
        <label className={labelClass}>順位</label>
        <input type="number" min="1" value={rank || ""} onChange={(e) => setRank(Number(e.target.value))} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>ポイント</label>
        <input type="number" value={points || ""} onChange={(e) => setPoints(Number(e.target.value))} className={inputClass} />
      </div>
    </div>
  );
}
