/**
 * ワンタイムパスコードの生成・ハッシュ・検証
 *
 * パスコード形式: EB-XXXXXX（例: EB-A3X9K2）
 * 文字種: A-Z(I,O除く) + 2-9 = 32種、6文字 → 約10億通り
 * ハッシュ: SHA-256（ランダム生成のため bcrypt 不要）
 */

import crypto from "crypto";

const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePasscode(): string {
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return `EB-${code.slice(0, 3)}${code.slice(3)}`;
}

export function hashPasscode(passcode: string): string {
  const normalized = passcode.trim().toUpperCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
