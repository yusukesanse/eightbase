"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
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

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  upcoming: { label: "募集中", color: "bg-blue-100 text-blue-700" },
  ongoing: { label: "開催中", color: "bg-green-100 text-green-700" },
  awaiting_results: { label: "結果待ち", color: "bg-amber-100 text-amber-700" },
  completed: { label: "完了", color: "bg-gray-100 text-gray-500" },
};

type SortKey = "date_desc" | "date_asc" | "category" | "status";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "date_desc", label: "開催日（新しい順）" },
  { value: "date_asc", label: "開催日（古い順）" },
  { value: "category", label: "種目別" },
  { value: "status", label: "ステータス別" },
];

const STATUS_ORDER: Record<string, number> = {
  ongoing: 0,
  awaiting_results: 1,
  upcoming: 2,
  completed: 3,
};

const CATEGORY_ORDER: Record<string, number> = {
  mahjong: 0,
  poker: 1,
  billiards: 2,
  darts: 3,
};

/* ───────── メインコンポーネント ───────── */

export default function SeasonScoresPage() {
  const { seasonId } = useParams<{ seasonId: string }>();

  // シーズン情報
  const [season, setSeason] = useState<Season | null>(null);

  // ゲーム一覧
  const [games, setGames] = useState<GameItem[]>([]);
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

  // 削除確認
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // 検索・ソート
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date_desc");

  /* ───────── フィルタ & ソート ───────── */

  const filteredGames = useMemo(() => {
    let result = [...games];

    // 検索フィルタ
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((g) => {
        const catLabel = GAME_CATEGORIES.find((c) => c.id === g.category)?.label ?? g.category;
        return (
          g.title.toLowerCase().includes(q) ||
          catLabel.toLowerCase().includes(q)
        );
      });
    }

    // ソート
    result.sort((a, b) => {
      switch (sortKey) {
        case "date_desc":
          return (b.startAt ?? "").localeCompare(a.startAt ?? "");
        case "date_asc":
          return (a.startAt ?? "").localeCompare(b.startAt ?? "");
        case "category": {
          const ca = CATEGORY_ORDER[a.category] ?? 99;
          const cb = CATEGORY_ORDER[b.category] ?? 99;
          if (ca !== cb) return ca - cb;
          return (b.startAt ?? "").localeCompare(a.startAt ?? "");
        }
        case "status": {
          const sa = STATUS_ORDER[a.status] ?? 99;
          const sb = STATUS_ORDER[b.status] ?? 99;
          if (sa !== sb) return sa - sb;
          return (b.startAt ?? "").localeCompare(a.startAt ?? "");
        }
        default:
          return 0;
      }
    });

    return result;
  }, [games, searchQuery, sortKey]);

  /* ───────── データ取得 ───────── */

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/scoreboard/seasons", { credentials: "same-origin" }).then((r) => r.json()),
      fetch("/api/admin/games", { credentials: "same-origin" }).then((r) => r.json()),
    ])
      .then(([sData, gData]) => {
        // シーズン情報を取得
        const found = (sData.seasons ?? []).find((s: Season) => s.seasonId === seasonId);
        if (found) {
          setSeason(found);

          // シーズン期間内のゲームをフィルタ（全ステータス対象）
          const allGames: GameItem[] = gData.games ?? [];
          const filtered = allGames.filter((g) => {
            if (!g.startAt) return false;
            const gameDate = g.startAt.slice(0, 10); // YYYY-MM-DD
            return gameDate >= found.startDate && gameDate <= found.endDate;
          });
          setGames(filtered);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [seasonId]);

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

  /* ───────── ヘルパー ───────── */

  const getCategoryLabel = (cat: string) =>
    GAME_CATEGORIES.find((c) => c.id === cat)?.label ?? cat;

  const getStatusBadge = (status: string) =>
    STATUS_BADGES[status] ?? { label: status, color: "bg-gray-100 text-gray-500" };

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-[#231714]">スコア入力</h2>
        <p className="text-sm text-[#231714]/40 mt-1">
          {season
            ? `${season.name}（${season.startDate} 〜 ${season.endDate}）のゲームスコアを登録`
            : "シーズン情報を読み込み中..."}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : !season ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-600">
          シーズンが見つかりませんでした
        </div>
      ) : (
        <div className="flex gap-6 items-stretch" style={{ minHeight: "70vh" }}>
          {/* 左: ゲーム一覧 */}
          <div className="w-80 shrink-0 flex flex-col">
            <p className="text-xs font-medium text-[#231714]/60 mb-2">
              ゲーム選択（{filteredGames.length}/{games.length}件）
            </p>

            {/* 検索 */}
            <div className="relative mb-2">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#231714]/30"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
              >
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ゲーム名・種目で検索..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-[#231714]/10 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#231714]/20 placeholder:text-[#231714]/25"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#231714]/30 hover:text-[#231714]/60"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>

            {/* ソート */}
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="w-full border border-[#231714]/10 rounded-lg px-3 py-1.5 text-xs text-[#231714]/70 bg-white focus:outline-none focus:ring-2 focus:ring-[#231714]/20 mb-3 appearance-none cursor-pointer"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3e%3cpath d='M1 1l4 4 4-4' stroke='%23231714' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round' opacity='.4'/%3e%3c/svg%3e\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center" }}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {games.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#231714]/10 p-6 text-center text-sm text-[#231714]/40 flex-1 flex items-center justify-center">
                このシーズン期間内のゲームがありません
              </div>
            ) : filteredGames.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#231714]/10 p-6 text-center text-sm text-[#231714]/40 flex-1 flex items-center justify-center">
                「{searchQuery}」に一致するゲームがありません
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto pr-1 flex-1">
                {filteredGames.map((g) => {
                  const badge = getStatusBadge(g.status);
                  return (
                    <button
                      key={g.gameId}
                      onClick={() => loadGameDetail(g)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${
                        selectedGame?.gameId === g.gameId
                          ? "border-[#231714] bg-[#231714]/5 shadow-sm"
                          : "border-[#231714]/10 bg-white hover:border-[#231714]/30"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-[#A5C1C8]/15 text-[9px] font-medium text-[#231714]/70">
                          {getCategoryLabel(g.category)}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${badge.color}`}
                        >
                          {badge.label}
                        </span>
                        {g.scoreRegistered && (
                          <span className="px-1.5 py-0.5 rounded bg-green-100 text-[9px] font-bold text-green-700">
                            登録済
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-[#231714] truncate">
                        {g.title}
                      </p>
                      <p className="text-[10px] text-[#231714]/40 mt-0.5">
                        {g.startAt
                          ? new Date(g.startAt).toLocaleDateString("ja-JP")
                          : "—"}{" "}
                        · {g.participantCount}名参加
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 右: 参加者一覧 + スコア */}
          <div className="flex-1 min-w-0 flex flex-col">
            {!selectedGame ? (
              <div className="bg-white rounded-xl border border-[#231714]/10 flex-1 flex items-center justify-center text-sm text-[#231714]/40">
                左からゲームを選択してください
              </div>
            ) : loadingDetail ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="flex flex-col flex-1">
                <div className="bg-white rounded-xl border border-[#231714]/10 p-4 mb-4">
                  <h3 className="text-base font-semibold text-[#231714]">
                    {selectedGame.title}
                  </h3>
                  <p className="text-xs text-[#231714]/40 mt-0.5">
                    {getCategoryLabel(selectedGame.category)} ·{" "}
                    {participants.length}名参加 · シーズン: {season.name}
                  </p>
                </div>

                {participants.length === 0 ? (
                  <div className="bg-white rounded-xl border border-[#231714]/10 flex-1 flex items-center justify-center text-sm text-[#231714]/40">
                    参加者がいません
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-[#231714]/10 overflow-hidden flex-1 flex flex-col">
                    <div className="overflow-y-auto flex-1">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 z-[1]">
                          <tr className="bg-gray-50 border-b border-[#231714]/5">
                            <th className="text-left px-4 py-2.5 text-xs font-medium text-[#231714]/60">
                              参加者
                            </th>
                            <th className="text-left px-4 py-2.5 text-xs font-medium text-[#231714]/60">
                              スコア
                            </th>
                            <th className="px-4 py-2.5 text-right text-xs font-medium text-[#231714]/60">
                              操作
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {participants.map((p) => {
                            const score = getScoreForUser(p.lineUserId);
                            return (
                              <tr
                                key={p.lineUserId}
                                className="border-b border-[#231714]/5 hover:bg-[#231714]/[0.02]"
                              >
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    {p.pictureUrl ? (
                                      <img
                                        src={p.pictureUrl}
                                        alt=""
                                        className="w-7 h-7 rounded-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-7 h-7 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center text-[10px] font-bold text-[#A5C1C8]">
                                        {p.displayName.charAt(0)}
                                      </div>
                                    )}
                                    <span className="text-sm text-[#231714] truncate">
                                      {p.displayName}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  {score ? (
                                    <span className="text-sm font-bold text-[#231714]">
                                      {score.totalScore}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-[#231714]/30">
                                      未登録
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  {score ? (
                                    <div className="flex gap-2 justify-end">
                                      <button
                                        onClick={() => openScoreForm(p, score)}
                                        className="text-xs text-[#A5C1C8] hover:underline"
                                      >
                                        編集
                                      </button>
                                      <button
                                        onClick={() =>
                                          setDeleteTarget(score.scoreId)
                                        }
                                        className="text-xs text-red-500 hover:underline"
                                      >
                                        削除
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => openScoreForm(p)}
                                      className="px-3 py-1 text-xs bg-[#231714] text-white rounded-lg hover:bg-[#231714]/80 disabled:opacity-50"
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
            <h3 className="text-base font-semibold text-[#231714] mb-2">
              削除の確認
            </h3>
            <p className="text-sm text-[#231714]/60 mb-5">
              このスコアを削除しますか？
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm border border-[#231714]/10 rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={() => handleDeleteScore(deleteTarget)}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* スコア入力モーダル */}
      {scoreModal && scoreTarget && selectedGame && season && (
        <ScoreFormModal
          game={selectedGame}
          participant={scoreTarget}
          season={season}
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

function ScoreFormModal({
  game,
  participant,
  season,
  existingScore,
  onClose,
  onSaved,
}: ScoreFormModalProps) {
  const gameCategory = game.category as ScoreboardGameId;
  const [saving, setSaving] = useState(false);

  // 種目共通: totalScore
  const [totalScore, setTotalScore] = useState(
    existingScore?.totalScore ?? 0
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const det = (existingScore?.details ?? {}) as Record<string, any>;

  // 麻雀
  const [mahjongRounds, setMahjongRounds] = useState<
    { rank: number; score: number }[]
  >(
    det.rounds
      ? (det.rounds as { rank: number; score: number }[])
      : [{ rank: 1, score: 0 }]
  );

  // ポーカー
  const [pokerRank, setPokerRank] = useState((det.tournamentRank as number) ?? 1);
  const [pokerChips, setPokerChips] = useState((det.chipCount as number) ?? 0);
  const [pokerBounty, setPokerBounty] = useState((det.bountyCount as number) ?? 0);

  // ビリヤード
  const [billiardsMatches, setBilliardsMatches] = useState<
    { result: string; points: number }[]
  >(
    det.matches
      ? (det.matches as { result: string; points: number }[])
      : [{ result: "win", points: 0 }]
  );

  // ダーツ
  const [dartsRank, setDartsRank] = useState((det.rank as number) ?? 1);
  const [dartsPoints, setDartsPoints] = useState((det.points as number) ?? 0);
  const [dartsGameType, setDartsGameType] = useState((det.gameType as string) ?? "");

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
  }, [
    gameCategory,
    mahjongRounds,
    pokerChips,
    pokerBounty,
    billiardsMatches,
    dartsPoints,
  ]);

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
          details = {
            tournamentRank: pokerRank,
            chipCount: pokerChips,
            bountyCount: pokerBounty,
          };
          break;
        case "billiards":
          details = { matches: billiardsMatches };
          break;
        case "darts":
          details = {
            rank: dartsRank,
            points: dartsPoints,
            gameType: dartsGameType || undefined,
          };
          break;
      }

      if (existingScore) {
        // 更新
        const res = await fetch(
          `/api/admin/scoreboard/scores/${existingScore.scoreId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ totalScore, details }),
          }
        );
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

  const inputClass =
    "w-full border border-[#231714]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#231714]";
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
            <MahjongForm
              rounds={mahjongRounds}
              setRounds={setMahjongRounds}
              inputClass={inputClass}
              labelClass={labelClass}
            />
          )}
          {gameCategory === "poker" && (
            <PokerForm
              rank={pokerRank}
              setRank={setPokerRank}
              chips={pokerChips}
              setChips={setPokerChips}
              bounty={pokerBounty}
              setBounty={setPokerBounty}
              inputClass={inputClass}
              labelClass={labelClass}
            />
          )}
          {gameCategory === "billiards" && (
            <BilliardsForm
              matches={billiardsMatches}
              setMatches={setBilliardsMatches}
              inputClass={inputClass}
              labelClass={labelClass}
            />
          )}
          {gameCategory === "darts" && (
            <DartsForm
              rank={dartsRank}
              setRank={setDartsRank}
              points={dartsPoints}
              setPoints={setDartsPoints}
              gameType={dartsGameType}
              setGameType={setDartsGameType}
              inputClass={inputClass}
              labelClass={labelClass}
            />
          )}

          {/* 合計スコア表示 */}
          <div className="bg-[#231714]/5 rounded-xl p-4 text-center">
            <p className="text-xs text-[#231714]/50 mb-1">合計スコア</p>
            <p className="text-2xl font-bold text-[#231714]">{totalScore}</p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-[#231714]/10 rounded-lg hover:bg-gray-50"
          >
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
  rounds,
  setRounds,
  inputClass,
  labelClass,
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
            <span className="text-xs text-[#231714]/40 w-12 shrink-0">
              {i + 1}半荘
            </span>
            <select
              value={r.rank}
              onChange={(e) => {
                const next = [...rounds];
                next[i] = { ...next[i], rank: Number(e.target.value) };
                setRounds(next);
              }}
              className={`${inputClass} w-20 bg-white`}
            >
              {[1, 2, 3, 4].map((v) => (
                <option key={v} value={v}>
                  {v}着
                </option>
              ))}
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
  rank,
  setRank,
  chips,
  setChips,
  bounty,
  setBounty,
  inputClass,
  labelClass,
}: {
  rank: number;
  setRank: (v: number) => void;
  chips: number;
  setChips: (v: number) => void;
  bounty: number;
  setBounty: (v: number) => void;
  inputClass: string;
  labelClass: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>トーナメント順位</label>
        <input
          type="number"
          min="1"
          value={rank || ""}
          onChange={(e) => setRank(Number(e.target.value))}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>チップ数</label>
        <input
          type="number"
          value={chips || ""}
          onChange={(e) => setChips(Number(e.target.value))}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>バウンティ数（任意）</label>
        <input
          type="number"
          min="0"
          value={bounty || ""}
          onChange={(e) => setBounty(Number(e.target.value))}
          className={inputClass}
        />
      </div>
    </div>
  );
}

/* ─── ビリヤード ─── */
function BilliardsForm({
  matches,
  setMatches,
  inputClass,
  labelClass,
}: {
  matches: { result: string; points: number }[];
  setMatches: (m: { result: string; points: number }[]) => void;
  inputClass: string;
  labelClass: string;
}) {
  return (
    <div>
      <label className={labelClass}>試合ごとの結果</label>
      <div className="space-y-2">
        {matches.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-[#231714]/40 w-12 shrink-0">
              第{i + 1}試合
            </span>
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
  rank,
  setRank,
  points,
  setPoints,
  gameType,
  setGameType,
  inputClass,
  labelClass,
}: {
  rank: number;
  setRank: (v: number) => void;
  points: number;
  setPoints: (v: number) => void;
  gameType: string;
  setGameType: (v: string) => void;
  inputClass: string;
  labelClass: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>ゲームタイプ（任意）</label>
        <input
          type="text"
          value={gameType}
          onChange={(e) => setGameType(e.target.value)}
          className={inputClass}
          placeholder="501, クリケットなど"
        />
      </div>
      <div>
        <label className={labelClass}>順位</label>
        <input
          type="number"
          min="1"
          value={rank || ""}
          onChange={(e) => setRank(Number(e.target.value))}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>ポイント</label>
        <input
          type="number"
          value={points || ""}
          onChange={(e) => setPoints(Number(e.target.value))}
          className={inputClass}
        />
      </div>
    </div>
  );
}
