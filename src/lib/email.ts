import { Resend } from "resend";

const FROM_ADDRESS = `EIGHT BASE <${process.env.RESEND_FROM_ADDRESS ?? "noreply@eightbase.net"}>`;

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY environment variable is not set");
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendPasscodeEmail(
  to: string,
  displayName: string,
  passcode: string
): Promise<void> {
  const resend = getResend();

  const safeName = escapeHtml(displayName);
  const safePasscode = escapeHtml(passcode);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: "【EIGHT BASE】ワンタイムパスワードのお知らせ",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-size: 20px; color: #231714; margin: 0;">EIGHT BASE</h1>
        </div>

        <p style="font-size: 14px; color: #231714; line-height: 1.6;">
          ${safeName} 様
        </p>
        <p style="font-size: 14px; color: #231714; line-height: 1.6;">
          EIGHT BASE へようこそ。<br />
          LINEミニアプリのログイン画面で、以下のワンタイムパスワードを入力してください。
        </p>

        <div style="background: #f5f5f5; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
          <p style="font-size: 12px; color: #231714; opacity: 0.5; margin: 0 0 8px;">ワンタイムパスワード</p>
          <p style="font-size: 28px; font-weight: bold; font-family: monospace; letter-spacing: 0.15em; color: #231714; margin: 0;">
            ${safePasscode}
          </p>
        </div>

        <p style="font-size: 12px; color: #231714; opacity: 0.5; line-height: 1.6;">
          ※ このパスワードの有効期限は7日間です。<br />
          ※ 初回のアカウント連携にのみ使用します。<br />
          ※ 心当たりがない場合は、このメールを無視してください。
        </p>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 32px 0 16px;" />
        <p style="font-size: 11px; color: #231714; opacity: 0.3; text-align: center;">
          EIGHT BASE — エイトデザイン株式会社
        </p>
      </div>
    `,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}

/**
 * ゲスト招待メール: ワンタイムURL（LIFF URL）を本文のボタンで送る。
 * URLを踏むとLINEミニアプリの /guest が開き、その場でゲスト登録される（1URL=1回）。
 */
export async function sendGuestInviteEmail(
  to: string,
  displayName: string,
  url: string,
  expiryDays = 2
): Promise<void> {
  const resend = getResend();

  const safeName = escapeHtml(displayName);
  const safeUrl = escapeHtml(url);
  const safeExpiry = escapeHtml(String(expiryDays));

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: "【EIGHT BASE】麻雀リーグ ゲスト参加のご案内",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-size: 20px; color: #231714; margin: 0;">EIGHT BASE</h1>
        </div>

        <p style="font-size: 14px; color: #231714; line-height: 1.6;">
          ${safeName} 様
        </p>
        <p style="font-size: 14px; color: #231714; line-height: 1.6;">
          麻雀リーグへのゲスト参加にご招待します。<br />
          下のボタンを <strong>LINE アプリで</strong> 開くと、麻雀リーグのゲーム画面に参加できます。
        </p>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${safeUrl}" style="display: inline-block; background: #2f7d57; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: bold; padding: 14px 28px; border-radius: 12px;">
            麻雀リーグに参加する
          </a>
        </div>

        <p style="font-size: 12px; color: #231714; opacity: 0.6; line-height: 1.6; word-break: break-all;">
          ボタンが開けない場合は、次のURLをLINEで開いてください：<br />
          ${safeUrl}
        </p>

        <p style="font-size: 12px; color: #231714; opacity: 0.5; line-height: 1.6;">
          ※ このリンクの有効期限は${safeExpiry}日間です。<br />
          ※ <strong>最初に開いた1名のみ</strong>参加登録されます（1回限り）。<br />
          ※ 心当たりがない場合は、このメールを無視してください。
        </p>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 32px 0 16px;" />
        <p style="font-size: 11px; color: #231714; opacity: 0.3; text-align: center;">
          EIGHT BASE — エイトデザイン株式会社
        </p>
      </div>
    `,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}

/**
 * エイト社員（staff）向けの URL 招待メール。
 * ゲスト用（麻雀リーグ参加）とは文言を分ける: 社員は会員同等の全機能が使え、登録後にプロフィール登録へ進む。
 * URL first-clicker 方式・1回限りである点はゲストと同じ。
 */
export async function sendStaffInviteEmail(
  to: string,
  displayName: string,
  url: string,
  expiryDays = 2
): Promise<void> {
  const resend = getResend();

  const safeName = escapeHtml(displayName);
  const safeUrl = escapeHtml(url);
  const safeExpiry = escapeHtml(String(expiryDays));

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: "【EIGHT BASE】ご利用のご案内（エイトデザイン社員）",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-size: 20px; color: #231714; margin: 0;">EIGHT BASE</h1>
        </div>

        <p style="font-size: 14px; color: #231714; line-height: 1.6;">
          ${safeName} 様
        </p>
        <p style="font-size: 14px; color: #231714; line-height: 1.6;">
          EIGHT BASE へご招待します。<br />
          下のボタンを <strong>LINE アプリで</strong> 開くと登録が始まります。かんたんなプロフィールをご入力いただくと、施設予約・掲示板・メンバー一覧など全機能をご利用いただけます。
        </p>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${safeUrl}" style="display: inline-block; background: #231714; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: bold; padding: 14px 28px; border-radius: 12px;">
            EIGHT BASE を始める
          </a>
        </div>

        <p style="font-size: 12px; color: #231714; opacity: 0.6; line-height: 1.6; word-break: break-all;">
          ボタンが開けない場合は、次のURLをLINEで開いてください：<br />
          ${safeUrl}
        </p>

        <p style="font-size: 12px; color: #231714; opacity: 0.5; line-height: 1.6;">
          ※ このリンクの有効期限は${safeExpiry}日間です。<br />
          ※ <strong>最初に開いた1名のみ</strong>登録されます（1回限り）。<br />
          ※ 心当たりがない場合は、このメールを無視してください。
        </p>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 32px 0 16px;" />
        <p style="font-size: 11px; color: #231714; opacity: 0.3; text-align: center;">
          EIGHT BASE — エイトデザイン株式会社
        </p>
      </div>
    `,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
