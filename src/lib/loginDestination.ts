import { isGamesOnlyRole } from "./roles";
import { GAME_PAYMENT_RETURN_BASE, paymentReturnSearch } from "./gamePaymentReturn";

/** ゲストは会員用プロフィール登録を通さない。本番・開発で同じ振り分けを使う。 */
export function loginDestination(role: unknown, profileComplete: boolean, search = ""): string {
  const paymentSearch = paymentReturnSearch(search);
  if (isGamesOnlyRole(role) || (profileComplete && paymentSearch)) {
    return `${GAME_PAYMENT_RETURN_BASE}${paymentSearch}`;
  }
  return profileComplete ? "/reservation" : "/setup-profile";
}
