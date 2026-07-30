import type { FacilityType } from "@/types";

/** 施設フォームの型・定数（管理カレンダー画面）。page / サブコンポーネントで共用。 */

export interface FacilityForm {
  name: string;
  calendarId: string;
  type: FacilityType;
  capacity: string;
  openTime: string;
  closeTime: string;
  availableDays: number[];
  // 予約時間制御
  minDuration: string;       // 分（空文字=未設定）
  fixedDuration: boolean;
  prepTime: string;          // 分（空文字=未設定）
  minAdvanceDays: string;    // 利用日の何日前までに予約が必要か（空文字/0=制限なし＝当日も予約可）
  // 利用規約
  requireTerms: boolean;
  termsContent: string;
  // 決済（requirePayment=ON で決済額＋Square認証情報を設定）
  requirePayment: boolean;
  paymentAmount: string;       // 円・税込（空文字=未設定）
  // Square認証情報（超機密）: 空文字=変更しない。送信後はサーバー側で暗号化保存され、再表示されない
  squareAccessToken: string;
  squareLocationId: string;
  squareEnvironment: "production" | "sandbox";
  clearSquareCredentials: boolean; // true=登録済みのSquare認証情報を削除
  // 解錠（SwitchBot）
  switchBotDeviceId: string; // 空文字=未設定（あれば解錠パスコード発行）
  // 同伴者（サウナ等・1人での利用を禁止する施設）
  requireCompanions: boolean;
  minPartySize: string;      // 最低合計人数（予約者含む）。空文字=既定の2
}

export const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export const EMPTY_FORM: FacilityForm = {
  name: "",
  calendarId: "",
  type: "meeting_room",
  capacity: "",
  openTime: "09:00",
  closeTime: "18:00",
  availableDays: [1, 2, 3, 4, 5],
  minDuration: "",
  fixedDuration: false,
  prepTime: "",
  minAdvanceDays: "",
  requireTerms: false,
  termsContent: "",
  requirePayment: false,
  paymentAmount: "",
  squareAccessToken: "",
  squareLocationId: "",
  squareEnvironment: "production",
  clearSquareCredentials: false,
  switchBotDeviceId: "",
  requireCompanions: false,
  minPartySize: "",
};
