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
  requireTerms: false,
  termsContent: "",
  requirePayment: false,
  paymentAmount: "",
  squareAccessToken: "",
  squareLocationId: "",
  squareEnvironment: "production",
  clearSquareCredentials: false,
  switchBotDeviceId: "",
};
