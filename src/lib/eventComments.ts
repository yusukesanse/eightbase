/**
 * イベントコメントの共通ロジック（純関数・サーバー用）。E-2。
 * データモデル: events/{eventId}/comments/{commentId} サブコレクション。
 * - 閲覧=会員（requireMember, ゲスト除外）／投稿=会員かつプロフィール完了（requireMemberProfileComplete）。
 * - 本文はプレーンテキスト（表示は React が自動エスケープ＝XSS安全）。HTML は許可しない。
 */

export const COMMENT_MAX_LENGTH = 500;
/** 連投対策: 同一ユーザーが同一イベントに連続投稿できる最短間隔（ミリ秒）。 */
export const COMMENT_COOLDOWN_MS = 3000;

export interface EventComment {
  commentId: string;
  eventId: string;
  authorId: string;
  authorName: string;
  authorPictureUrl: string;
  body: string;
  createdAt: string;
}

/** 本文の検証（空文字・空白のみ・文字数上限）。前後空白は除去して返す。 */
export function validateCommentBody(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "本文が不正です" };
  const value = raw.trim();
  if (value.length === 0) return { ok: false, error: "コメントを入力してください" };
  if (value.length > COMMENT_MAX_LENGTH) {
    return { ok: false, error: `コメントは${COMMENT_MAX_LENGTH}文字以内で入力してください` };
  }
  return { ok: true, value };
}

/** 連投判定: 直近投稿からの経過が COOLDOWN 未満なら true（拒否対象）。 */
export function isTooSoon(lastCreatedAtIso: string | null, nowMs: number): boolean {
  if (!lastCreatedAtIso) return false;
  const last = new Date(lastCreatedAtIso).getTime();
  if (Number.isNaN(last)) return false;
  return nowMs - last < COMMENT_COOLDOWN_MS;
}
