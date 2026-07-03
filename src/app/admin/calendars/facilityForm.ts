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
  // 課金設定
  requirePayment: boolean;
  hourlyRate: string;        // 円/時間（空文字=未設定）
  // トレーラー等: 決済額（設定で「決済する」ボタン化）/ SwitchBot解錠
  paymentAmount: string;     // 円・税込（空文字=未設定）
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
  hourlyRate: "",
  paymentAmount: "",
  switchBotDeviceId: "",
};
