"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { DayTabPlaceholder } from "@/components/games/DayTabPlaceholder";
import { todayJst, fmtChips } from "@/components/poker/pokerShared";
import { pokerNum, PokerDayStyle, ChipRim } from "@/components/poker/pokerDayTheme";
import { PokerTimer } from "@/components/poker/PokerTimer";
import { CenterModal } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/eb";

/**
 * ポーカー 当日タブ（1試合＝30分・チップ入力は1回・ディーラーも参加）。
 * ①ディーラー選び（自分の名前だけ押せる）→ ②開始待ち → 30分タイマー → ③全員がチップ入力 →
 * ④ディーラーが確認して「次の試合へ」か「リーグ戦を終了」→ ⑤①に合計つきで戻る／⑥本日終了。
 * 画面の切り替えはサーバーの phase だけで決める（30分たつと GET が reporting を返し、全員が入力に変わる）。
 * 見た目はフェルトと金（pokerDayTheme）。対象日は当日。
 */

interface PlayerDto {
  lineUserId?: string;
  displayName: string;
  isMe: boolean;
  reported: boolean;
  chips?: number | null;
}
interface CurrentGame {
  gameIndex: number;
  status: "ready" | "playing" | "reporting";
  dealerName: string | null;
  iAmDealer: boolean;
  iAmPlayer: boolean;
  startedAt: string | null;
  durationMin: number;
  players: PlayerDto[];
  reportedCount: number;
  total: number;
  myReported: boolean;
  myChips: number | null;
  maxChips: number;
}
interface ResultDto {
  displayName: string;
  pictureUrl?: string;
  isMe: boolean;
  totalChips: number;
  rank: number;
  games: { gameIndex: number; chips: number }[];
}
interface DayDto {
  started: boolean;
  finished: boolean;
  phase: "dealerSelect" | "ready" | "playing" | "reporting" | "finished";
  eventDate: string;
  minParticipants: number;
  paidCount: number; // 支払い済み（＝進行に参加できる人数）
  entryCount: number; // 名簿の人数（未払い含む）
  iAmPaid: boolean;
  iAmParticipant: boolean;
  participants: { displayName: string; pictureUrl?: string; isMe: boolean; paid: boolean }[];
  gamesPlayed: number;
  currentGame: CurrentGame | null;
  results?: ResultDto[];
  iCanFinishDay?: boolean;
}

async function postDay(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/poker/day/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: data.error };
}

/** 各画面が共有する「送って、失敗なら理由を出し、成功なら読み直す」。 */
interface Ctx {
  eventDate: string;
  send: (path: string, body: Record<string, unknown>, fallback: string) => Promise<boolean>;
}

const FINISH_QUESTION = "本日のリーグ戦を終了します。宜しいですか？";
const FINISH_SUB = "終了すると、今日はもう試合を追加できません。";

export function PokerGameTab({ onChanged }: { onChanged: () => void }) {
  const eventDate = todayJst();
  const [day, setDay] = useState<DayDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch(`/api/poker/day?eventDate=${eventDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else { setDay(d); setError(null); } })
      .catch(() => setError("読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [eventDate]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 8000);

  const send = useCallback<Ctx["send"]>(async (path, body, fallback) => {
    setError(null);
    const r = await postDay(path, { eventDate, ...body });
    if (!r.ok) { setError(r.error ?? fallback); return false; }
    await load();
    onChanged();
    return true;
  }, [eventDate, load, onChanged]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-[color:var(--eb-green)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  // 参加者以外（シーズン未作成・APIエラーで day が無い場合も含む）には出さない。
  if (!day || !day.iAmParticipant) return <DayTabPlaceholder />;

  const ctx: Ctx = { eventDate, send };
  const game = day.currentGame;
  return (
    <div className={`pk ${pokerNum.variable}`}>
      <PokerDayStyle />
      {error && <p className="pk-error" role="alert">{error}</p>}
      {/* key で画面が変わるたびにフェードし直す（試合が進んだ・phase が変わった）。 */}
      <div key={`${day.phase}-${game?.gameIndex ?? day.gamesPlayed}`} className="pk-stack pk-fade" style={{ gap: 16 }}>
        {day.phase === "finished" && <Finished day={day} />}
        {day.phase === "dealerSelect" && <DealerSelect day={day} ctx={ctx} />}
        {day.phase === "ready" && game && <Ready game={game} ctx={ctx} canFinish={!!day.iCanFinishDay} />}
        {day.phase === "playing" && game && <Playing game={game} ctx={ctx} onTimeUp={load} />}
        {day.phase === "reporting" && game && <Reporting game={game} ctx={ctx} />}
      </div>
    </div>
  );
}

/* ───────── 共通の小物 ───────── */

const AV_COLORS = ["#e6b84a", "#8fc6a8", "#e8a0a6", "#9fb6e6", "#d9c49a", "#c3a6e0"];
function Av({ name, index, src, size = 34 }: { name: string; index: number; src?: string; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  // eslint-disable-next-line @next/next/no-img-element
  if (src) return <img className="pk-av" src={src} alt="" style={style} />;
  return <span className="pk-av" aria-hidden="true" style={{ ...style, background: AV_COLORS[index % AV_COLORS.length] }}>{name.slice(0, 1)}</span>;
}

function Top({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pk-top">
      <span className="pk-game">{label}</span>
      <span className="pk-meta">{children}</span>
    </div>
  );
}

function Hero({ eyebrow, title, children, chip }: { eyebrow?: string; title: string; children?: React.ReactNode; chip?: React.ReactNode }) {
  return (
    <div className="pk-hero">
      {chip}
      {eyebrow && <span className="pk-eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

/** 「はい／いいえ」の確認。ブラウザの confirm は使わない。 */
function Confirm({ open, question, sub, busy, onYes, onNo }: { open: boolean; question: string; sub?: string; busy?: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <CenterModal open={open} onClose={onNo} dismissible={!busy}>
      <p className="text-[17px] font-bold leading-relaxed text-[color:var(--eb-ink)]">{question}</p>
      {sub && <p className="mt-1.5 text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">{sub}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Button variant="ghost" disabled={busy} onClick={onNo}>いいえ</Button>
        <Button variant="pay" loading={busy} onClick={onYes}>はい</Button>
      </div>
    </CenterModal>
  );
}

/** 確認をはさんで1回送る操作（ディーラーになる・ゲーム終了・本日終了）の開閉と送信中の状態。 */
function useConfirmedAction(run: () => Promise<boolean>) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const yes = async () => {
    setBusy(true);
    await run();
    setBusy(false);
    setOpen(false);
  };
  return { open, busy, ask: () => setOpen(true), yes, no: () => setOpen(false) };
}

function ResultRows({ results, detail }: { results: ResultDto[]; detail?: boolean }) {
  return (
    <div>
      {results.map((r, i) => (
        <div key={i} className={`pk-row${r.rank === 1 ? " top1" : ""}`}>
          <span className="pk-rank">{r.rank}</span>
          <Av name={r.displayName} index={i} src={r.pictureUrl} size={30} />
          <span className="pk-nm">
            {r.displayName}{r.isMe && <small>あなた</small>}
            {detail && r.games.length > 1 && <span className="pk-sub">{r.games.map((g) => fmtChips(g.chips)).join(" ＋ ")}</span>}
          </span>
          <span className="pk-val">{fmtChips(r.totalChips)}</span>
        </div>
      ))}
    </div>
  );
}

/* ───────── ①ディーラー選び（⑤「次の試合へ」を兼ねる） ───────── */
function DealerSelect({ day, ctx }: { day: DayDto; ctx: Ctx }) {
  const become = useConfirmedAction(() => ctx.send("dealer", {}, "ディーラー登録に失敗しました"));
  const finish = useConfirmedAction(() => ctx.send("confirm", { finishDay: true }, "終了に失敗しました"));
  const enoughPeople = day.paidCount >= day.minParticipants;
  const results = day.results ?? [];
  const unpaid = day.entryCount - day.paidCount;
  return (
    <>
      <Top label={`GAME ${day.gamesPlayed + 1}`}>本日 <b>{day.gamesPlayed}試合</b> 終了</Top>
      {day.gamesPlayed > 0 ? (
        <Hero eyebrow={`GAME ${day.gamesPlayed} CONFIRMED`} title={`GAME ${day.gamesPlayed} を確定しました`}>
          次の試合のディーラーをする人は、自分の名前を押してください。
        </Hero>
      ) : (
        <Hero eyebrow="CHOOSE DEALER" title="ディーラーを決めます">
          ディーラーをする人は、自分の名前を押してください。ディーラーもプレイして、チップ数を入力します。
        </Hero>
      )}

      {results.length > 0 && (
        <section className="pk-panel">
          <h3><span>ここまでの合計</span><span>{day.gamesPlayed}試合</span></h3>
          <ResultRows results={results} />
        </section>
      )}

      <section className="pk-panel">
        <h3><span>本日の参加者</span><span>{day.paidCount}名{unpaid > 0 ? ` ・ 未払い ${unpaid}名` : ""}</span></h3>
        <div className="pk-people">
          {day.participants.map((p, i) => {
            const av = <Av name={p.displayName} index={i} src={p.pictureUrl} />;
            // 押せるのは自分の名前だけ。未払いの人は自分でも押せない（ディーラーは支払い済みから選ぶ）。
            return p.isMe && p.paid ? (
              <button key={i} type="button" className="pk-person" disabled={!enoughPeople} onClick={become.ask}>
                {av}<span className="pk-nm">{p.displayName}<small>あなた ・ 押して選ぶ</small></span>
              </button>
            ) : (
              <div key={i} className="pk-person">
                {av}
                <span className="pk-nm">
                  {p.displayName}
                  {p.isMe ? <small>お支払い後にディーラーになれます</small> : !p.paid && <small>未払い</small>}
                </span>
              </div>
            );
          })}
        </div>
      </section>
      <p className="pk-note">
        {!enoughPeople
          ? `支払い済みが${day.minParticipants}名以上になると始められます（未払いの方はその場でお支払いください）。`
          : day.iAmPaid
            ? "押せるのは自分の名前だけです。"
            : "参加費が未払いです。「参加」タブからお支払いいただくと参加できます。"}
      </p>

      {day.iCanFinishDay && (
        <button type="button" className="pk-btn ghost" onClick={finish.ask}>本日のリーグ戦を終了する</button>
      )}

      <Confirm open={become.open} busy={become.busy} onYes={become.yes} onNo={become.no}
        question="ディーラーをします。宜しいですか？" sub="ディーラーもプレイして、チップ数を入力します。" />
      <Confirm open={finish.open} busy={finish.busy} onYes={finish.yes} onNo={finish.no} question={FINISH_QUESTION} sub={FINISH_SUB} />
    </>
  );
}

/* ───────── ②開始待ち ───────── */
function Ready({ game, ctx, canFinish }: { game: CurrentGame; ctx: Ctx; canFinish: boolean }) {
  const [busy, setBusy] = useState(false);
  const finish = useConfirmedAction(() => ctx.send("confirm", { finishDay: true }, "終了に失敗しました"));
  const start = async () => {
    setBusy(true);
    await ctx.send("start", {}, "開始に失敗しました");
    setBusy(false);
  };
  const chip = (
    <svg className="pk-mini-chip" viewBox="0 0 200 200" aria-hidden="true">
      <ChipRim />
      <circle cx="100" cy="100" r="70" fill="none" stroke="#e6b84a" strokeWidth="8" />
      <text x="100" y="112" textAnchor="middle" fontWeight="700" fontSize="40" fill="#e9efe9" style={{ fontFamily: "var(--pk-num)" }}>
        {String(game.durationMin).padStart(2, "0")}:00
      </text>
    </svg>
  );
  return (
    <>
      <Top label={`GAME ${game.gameIndex}`}>ディーラー <b>{game.dealerName}</b></Top>
      {game.iAmDealer ? (
        <>
          <Hero chip={chip} title="準備ができたら開始">全員の画面に{game.durationMin}分タイマーが出ます。</Hero>
          <button type="button" className="pk-btn go" disabled={busy} onClick={start}>
            {busy ? "…" : `ゲーム開始（${game.durationMin}分）`}
          </button>
        </>
      ) : (
        <Hero chip={chip} title="開始を待っています">{game.dealerName}さんの開始を待っています。</Hero>
      )}
      {/* 次の試合を始めずに終える（この試合か直前の試合のディーラーだけ。判定はサーバーの iCanFinishDay）。 */}
      {canFinish && <button type="button" className="pk-btn ghost" onClick={finish.ask}>本日のリーグ戦を終了する</button>}
      <Confirm open={finish.open} busy={finish.busy} onYes={finish.yes} onNo={finish.no} question={FINISH_QUESTION} sub={FINISH_SUB} />
    </>
  );
}

/* ───────── プレイ中（30分タイマー） ───────── */
function Playing({ game, ctx, onTimeUp }: { game: CurrentGame; ctx: Ctx; onTimeUp: () => void }) {
  const end = useConfirmedAction(() => ctx.send("end", {}, "終了に失敗しました"));
  return (
    <>
      <Top label={`GAME ${game.gameIndex}`}>ディーラー <b>{game.dealerName}</b></Top>
      <PokerTimer key={game.startedAt} startedAt={game.startedAt} durationMin={game.durationMin} onTimeUp={onTimeUp} />
      {game.iAmDealer ? (
        <div className="pk-stack">
          <button type="button" className="pk-btn light" onClick={end.ask}>ゲーム終了</button>
          <p className="pk-note">{game.durationMin}分たつと自動で入力画面に進みます。</p>
        </div>
      ) : (
        <p className="pk-note">誰かのチップが0になったら、ディーラーがゲームを終了します。</p>
      )}
      <Confirm open={end.open} busy={end.busy} onYes={end.yes} onNo={end.no}
        question="誰かのチップが0になりましたか？" sub="「はい」で全員の画面がチップ入力に変わります。" />
    </>
  );
}

/* ───────── ③チップ入力（全員）＋ ④確認・確定（ディーラーだけ下に出す） ───────── */

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"];

/** 数字ボタンつきのチップ入力。キーボードからも入れられる。 */
function ChipPad({ label, initial = "", max, onSubmit, onCancel }: { label: string; initial?: string; max: number; onSubmit: (chips: number) => Promise<boolean>; onCancel?: () => void }) {
  const id = useId(); // ディーラーは自分の分と代わりの分で2つ同時に出ることがある
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const clean = (raw: string) => raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 7);
  const over = Number(value) > max; // サーバーも同じ上限で弾く（400）。押す前に分かるようにする
  const press = (k: string) => setValue((v) => (k === "⌫" ? v.slice(0, -1) : clean(v + k)));
  const submit = async () => {
    setBusy(true);
    await onSubmit(Number(value));
    setBusy(false);
  };
  return (
    <>
      <section className="pk-panel pk-chips-in">
        <label htmlFor={id}>{label}</label>
        <div className="pk-field">
          <input
            id={id} type="text" inputMode="numeric" placeholder="0" aria-label="チップ数"
            value={value ? fmtChips(Number(value)) : ""} onChange={(e) => setValue(clean(e.target.value))}
          />
          <span className="pk-unit">枚</span>
        </div>
        {over
          ? <p className="pk-note" role="alert" style={{ color: "var(--pk-red)", fontWeight: 700 }}>{fmtChips(max)}枚までです</p>
          : <p className="pk-note">0〜{fmtChips(max)}</p>}
        <div className="pk-keys">
          {KEYS.map((k) => (
            <button key={k} type="button" aria-label={k === "⌫" ? "1文字消す" : k} onClick={() => press(k)}>{k}</button>
          ))}
        </div>
      </section>
      <button type="button" className="pk-btn go" disabled={!value || over || busy} onClick={submit}>{busy ? "…" : "入力する"}</button>
      {onCancel && <button type="button" className="pk-btn ghost" disabled={busy} onClick={onCancel}>やめる</button>}
    </>
  );
}

function Reporting({ game, ctx }: { game: CurrentGame; ctx: Ctx }) {
  const [editing, setEditing] = useState(false);
  const report = (chips: number, targetUserId?: string) =>
    ctx.send("report", { chips, ...(targetUserId ? { targetUserId } : {}) }, "入力に失敗しました");
  return (
    <>
      <Top label={`GAME ${game.gameIndex}`}>ディーラー <b>{game.dealerName}</b></Top>
      {game.iAmPlayer ? (
        <>
          <Hero eyebrow="SHOWDOWN" title="チップ数を入力">
            {game.durationMin}分たった時点（または誰かが0枚になった時点）の、自分のチップ数を入れてください。
          </Hero>
          {game.myReported && !editing ? (
            <>
              <section className="pk-panel pk-chips-in">
                <span className="pk-done">入力済み ・ {fmtChips(game.myChips ?? 0)} 枚</span>
                <p className="pk-note">入力済み・直せます（ディーラーが確定するまで）。</p>
              </section>
              <button type="button" className="pk-btn ghost" onClick={() => setEditing(true)}>入力し直す</button>
            </>
          ) : (
            <ChipPad
              label="あなたのチップ数" max={game.maxChips} initial={game.myReported ? String(game.myChips ?? "") : ""}
              onSubmit={async (chips) => { const ok = await report(chips); if (ok) setEditing(false); return ok; }}
              onCancel={editing ? () => setEditing(false) : undefined}
            />
          )}
        </>
      ) : (
        <Hero eyebrow="SHOWDOWN" title="チップ数の入力中">参加者の入力を待っています。</Hero>
      )}

      <section className="pk-panel">
        <h3><span>入力の状況</span><span>{game.reportedCount}/{game.total}人</span></h3>
        <div className="pk-meter"><i style={{ width: `${game.total > 0 ? (game.reportedCount / game.total) * 100 : 0}%` }} /></div>
      </section>

      {game.iAmDealer && <DealerReview game={game} ctx={ctx} report={report} />}
    </>
  );
}

function DealerReview({ game, ctx, report }: { game: CurrentGame; ctx: Ctx; report: (chips: number, targetUserId?: string) => Promise<boolean> }) {
  const [proxy, setProxy] = useState<PlayerDto | null>(null);
  const [confirming, setConfirming] = useState(false);
  const finish = useConfirmedAction(() => ctx.send("confirm", { finishDay: true }, "確定に失敗しました"));
  const all = game.total > 0 && game.reportedCount >= game.total;
  const next = async () => {
    setConfirming(true);
    await ctx.send("confirm", {}, "確定に失敗しました");
    setConfirming(false);
  };
  return (
    <>
      <Hero eyebrow="CHECK" title={all ? "全員そろいました" : "入力を待っています"}>
        {all ? "内容を確かめて、確定してください。" : "未入力の人の分は、あなたが代わりに入力できます。"}
      </Hero>
      <section className="pk-panel">
        <h3><span>この試合のチップ数</span><span>{game.reportedCount}/{game.total}人</span></h3>
        <div>
          {game.players.map((p, i) => (
            <div key={p.lineUserId ?? i} className="pk-row">
              <Av name={p.displayName} index={i} size={30} />
              <span className="pk-nm">{p.displayName}{p.isMe && <small>あなた</small>}</span>
              {p.reported ? (
                <span className="pk-val">{fmtChips(p.chips ?? 0)}</span>
              ) : (
                <>
                  <span className="pk-wait">未入力</span>
                  {!p.isMe && <button type="button" className="pk-proxy" onClick={() => setProxy(p)}>代わりに入力</button>}
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      {proxy ? (
        <ChipPad
          key={proxy.lineUserId} label={`${proxy.displayName}さんのチップ数（代わりに入力）`} max={game.maxChips}
          onSubmit={async (chips) => { const ok = await report(chips, proxy.lineUserId); if (ok) setProxy(null); return ok; }}
          onCancel={() => setProxy(null)}
        />
      ) : (
        <div className="pk-stack">
          <button type="button" className="pk-btn go" disabled={!all || confirming} onClick={next}>{confirming ? "…" : "確定して次の試合へ"}</button>
          <button type="button" className="pk-btn light" disabled={!all || confirming} onClick={finish.ask}>確定してリーグ戦を終了</button>
        </div>
      )}
      <Confirm open={finish.open} busy={finish.busy} onYes={finish.yes} onNo={finish.no} question={FINISH_QUESTION} sub={FINISH_SUB} />
    </>
  );
}

/* ───────── ⑥本日終了 ───────── */
function Finished({ day }: { day: DayDto }) {
  const results = day.results ?? [];
  const pod = (r: ResultDto | undefined, cls: "g" | "s" | "b") => {
    if (!r) return <div />;
    return (
      <div className={`pk-pod ${cls}`}>
        <Av name={r.displayName} index={results.indexOf(r)} src={r.pictureUrl} size={46} />
        <span className="pk-nm">{r.displayName}</span>
        <span className="pk-pts">{fmtChips(r.totalChips)}</span>
        <div className="pk-base">{r.rank}</div>
      </div>
    );
  };
  return (
    <>
      <Top label="本日の結果"><b>{day.gamesPlayed}試合</b> ・ {results.length}名</Top>
      <Hero eyebrow="GOOD GAME" title="本日のリーグ戦は終了しました" />
      {results.length > 0 && (
        <>
          <div className="pk-podium">{pod(results[1], "s")}{pod(results[0], "g")}{pod(results[2], "b")}</div>
          <section className="pk-panel">
            <h3><span>本日のチップ合計</span><span>{day.gamesPlayed === 2 ? "GAME 1 ＋ GAME 2" : day.gamesPlayed > 2 ? `GAME 1〜${day.gamesPlayed}` : "GAME 1"}</span></h3>
            <ResultRows results={results} detail />
          </section>
        </>
      )}
      <p className="pk-note">本日の対局はすべて終了しました。結果は「リーグ」タブに反映されます。</p>
    </>
  );
}
