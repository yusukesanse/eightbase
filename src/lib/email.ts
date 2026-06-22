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
