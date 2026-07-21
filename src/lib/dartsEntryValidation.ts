/**
 * ダーツ エントリー系 API 共通の入力バリデーション・IDヘルパー・開催日ユーティリティ。
 *
 * ★ 麻雀と違い「有効な開催日」は暗黙の曜日ルールではなく `dartsSchedule` コレクション（管理登録）が正。
 *   ここには曜日の純関数（隔週木曜の生成・木曜判定）だけを置き、開催日の実在確認は lib/dartsSchedule で行う。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * YYYY-MM-DD 形式で、かつ**実在する日付**か（UTC基準・TZ非依存）。
 * 正規表現だけだと 2026-99-99 / 2026-02-31 を許してしまうため、UTCでパースして
 * 「再フォーマットが入力と一致する」ことまで確認する（ロールオーバー・NaN を弾く）。
 */
export function isValidDartsDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(t)) return false;
  // UTC で再フォーマットして入力と一致するか（2026-02-31→3/3 のような繰り上がりを検出）。
  return new Date(t).toISOString().slice(0, 10) === value;
}

/** Firestore のドキュメントIDとして安全な文字列か。 */
export function isValidDocId(value: unknown): value is string {
  return typeof value === "string" && DOC_ID_RE.test(value);
}

/**
 * オブジェクト/Firestoreマップの**キーとして危険**な値か（プロトタイプ汚染・特殊プロパティ）。
 * `reports[key] = …` のような外部由来キーの書き込み前に必ず弾く。
 */
export function isDangerousObjectKey(value: string): boolean {
  return value === "__proto__" || value === "prototype" || value === "constructor";
}

/**
 * teamId として安全か（reports のマップキー＝Firestoreフィールド名になる）。
 * 英数・ハイフン・アンダースコアのみ／1〜128文字／危険キーでないこと。
 */
export function isSafeTeamId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    DOC_ID_RE.test(value) &&
    !isDangerousObjectKey(value)
  );
}

/** ダーツ エントリーIDの決定的フォーマット。 */
export function buildDartsEntryId(seasonId: string, eventDate: string, lineUserId: string): string {
  return `${seasonId}_${eventDate}_${lineUserId}`;
}

/** スケジュール docId の決定的フォーマット（開催日の実在確認を O(1) にする）。 */
export function buildDartsScheduleId(seasonId: string, date: string): string {
  return `${seasonId}_${date}`;
}

/** YYYY-MM-DD を UTC正午基準で木曜(=4)か判定してTZズレを防ぐ（本番 TZ=UTC 対策）。 */
export function isThursdayDate(dateStr: string): boolean {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay() === 4;
}

/**
 * 起点日から隔週（14日ごと）の木曜を count 個生成する（管理画面の一括登録用）。
 * 起点が木曜でない場合は、起点以降の最初の木曜に丸めてから隔週で刻む。
 * @returns YYYY-MM-DD の配列（昇順）
 */
export function generateBiweeklyThursdays(startDate: string, count: number): string[] {
  const base = new Date(`${startDate}T12:00:00Z`);
  // 起点以降の最初の木曜へ（UTC正午基準）。
  const shift = (4 - base.getUTCDay() + 7) % 7;
  base.setUTCDate(base.getUTCDate() + shift);
  const out: string[] = [];
  for (let i = 0; i < Math.max(0, count); i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i * 14);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
