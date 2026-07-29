/**
 * 予約フローの下書き（同伴者の選択）を画面間で受け渡すための一時保存。
 *
 * なぜ URL クエリではないか:
 * LINE の userId は33文字あり、数名分を載せるだけで URL が肥大する。加えて lineUserId は
 * 個人識別子なので、ブラウザ履歴・アクセスログ・Referer に残る場所に置きたくない。
 *
 * ⚠️ これは「表示の高速化キャッシュ」(swrCache) ではない。TTL も stale-while-revalidate も無く、
 * 予約の最終判定は必ずサーバーが行う。ここに入るのは確定前のユーザー入力だけ。
 * swr: プレフィックスを使わないので clearAllCache() では消えない
 * → ユーザー切替時に消すため AuthGuard から clearReservationDraft() を明示的に呼ぶこと。
 */

const KEY = "reservation:draft";

export interface ReservationDraftCompanion {
  lineUserId: string;
  displayName: string;
}

export interface ReservationDraft {
  facilityId: string;
  date: string;
  startTime: string;
  endTime: string;
  termsAgreed: boolean;
  companions: ReservationDraftCompanion[];
}

type DraftMatch = Pick<ReservationDraft, "facilityId" | "date" | "startTime" | "endTime">;

export function saveReservationDraft(draft: ReservationDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    /* プライベートブラウズ等で書けなくても予約自体は続行できる */
  }
}

/**
 * 保存済みの下書きを返す。URL の予約内容と一致しないものは null
 * （別の予約を作りかけた残骸を、今の予約に紛れ込ませない）。
 */
export function readReservationDraft(match: DraftMatch): ReservationDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as ReservationDraft;
    if (
      draft.facilityId !== match.facilityId ||
      draft.date !== match.date ||
      draft.startTime !== match.startTime ||
      draft.endTime !== match.endTime
    ) {
      return null;
    }
    if (!Array.isArray(draft.companions)) return null;
    return draft;
  } catch {
    return null;
  }
}

export function clearReservationDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
