import type { UserRole } from "@/lib/roles";

/** 管理ユーザー画面の共有型（page / 各モーダル / 詳細パネルで共用） */

export interface SocialLinksData {
  instagram?: string;
  x?: string;
  facebook?: string;
  other?: string;
}

export interface UserProfile {
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  email?: string;
  phone: string;
  birthday: string;
  gender: string;
  companyName?: string;
  jobTitle?: string;
  industry?: string;
  occupation?: string; // 旧データ（後方互換）
  purpose: string;
  postalCode: string;
  prefecture: string;
  city: string;
  address: string;
  building: string;
  addressType: string;
  companyUrl?: string;
  bio?: string;
  lineUrl?: string;
  socialLinks?: SocialLinksData;
}

/** users.memberProfile（スキル・キャッチコピー等。LINE連携ユーザーのみ） */
export interface MemberProfileData {
  skills?: string[];
  catchphrase?: string;
  companyName?: string;
  jobTitle?: string;
  industry?: string;
  companyUrl?: string;
  bio?: string;
  socialLinks?: SocialLinksData;
  lineUrl?: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  tenantName: string;
  lineUserId: string | null;
  active: boolean;
  role: UserRole;
  profileComplete: boolean;
  profile: UserProfile | null;
  memberProfile: MemberProfileData | null;
  pictureUrl: string | null;
  lineDisplayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  profileUpdatedAt: string | null;
  invitationId: string | null;
  inviteStatus: "pending" | "linked" | "expired" | null;
}
