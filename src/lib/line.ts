/**
 * LINE Messaging API — Push / Multicast Message
 * SDK を使わず fetch で直接呼び出す軽量実装
 */

const LINE_API_BASE = "https://api.line.me/v2/bot";

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "";

/**
 * Messaging API の uri action 用 URL を生成する。
 * 通常URL（Safari 等の外部ブラウザで開く）ではなく **LIFF URL** にして、
 * LINEミニアプリとして開かせる。
 *
 * LIFF ID は環境ごとの値を使う（本番=prod / demo=demo。各Vercelプロジェクトが
 * 自環境のLIFF IDを設定している）。万一 LIFF ID 未設定のときだけ通常URLへ
 * フォールバックし、リンク自体は壊さない。
 *
 * ⚠️ 通知ボタンには PORTAL_URL を直接入れず、必ずこの helper を経由すること
 *    （ブラウザで開いてしまうミスの再発防止）。
 */
function liffUrl(path: string): string {
  const liffId =
    process.env.NEXT_PUBLIC_LIFF_ID_PROD ||
    process.env.NEXT_PUBLIC_LIFF_ID ||
    process.env.NEXT_PUBLIC_LIFF_ID_REVIEW ||
    "";
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (!liffId) return `${PORTAL_URL}${clean}`;
  return `https://liff.line.me/${liffId}${clean}`;
}

async function pushMessage(userId: string, messages: object[]) {
  const res = await fetch(`${LINE_API_BASE}/message/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to: userId, messages }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`LINE push message failed: ${error}`);
  }
}

/**
 * マルチキャスト（最大500人同時送信）
 * 500人を超える場合は自動分割
 */
async function multicastMessage(userIds: string[], messages: object[]) {
  const BATCH_SIZE = 500;
  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const batch = userIds.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${LINE_API_BASE}/message/multicast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ to: batch, messages }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error(`LINE multicast failed (batch ${i / BATCH_SIZE + 1}):`, error);
    }
  }
}

// ─── 予約完了通知 ──────────────────────────────────────────────────────────────
export async function sendReservationConfirmed(
  lineUserId: string,
  {
    facilityName,
    date,
    startTime,
    endTime,
    displayName,
  }: {
    facilityName: string;
    date: string;        // YYYY-MM-DD
    startTime: string;   // HH:MM
    endTime: string;
    displayName: string;
  }
) {
  const dateLabel = formatDate(date);

  await pushMessage(lineUserId, [
    {
      type: "flex",
      altText: `【EIGHT BASE UNGA 予約完了】${facilityName} ${dateLabel} ${startTime}〜${endTime}`,
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: "#A5C1C8",
          paddingAll: "14px",
          contents: [
            {
              type: "text",
              text: "予約が完了しました",
              color: "#231714",
              weight: "bold",
              size: "md",
            },
          ],
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            labelValue("施設", facilityName),
            labelValue("日付", dateLabel),
            labelValue("時間", `${startTime} 〜 ${endTime}`),
            labelValue("予約者", displayName),
            {
              type: "separator",
              margin: "md",
            },
            {
              type: "text",
              text: "キャンセルはアプリの「マイ予約」から行えます。",
              color: "#888888",
              size: "xs",
              margin: "md",
              wrap: true,
            },
          ],
        },
        footer: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "button",
              action: {
                type: "uri",
                label: "マイ予約を確認",
                uri: liffUrl("/my-reservations"),
              },
              style: "primary",
              color: "#A5C1C8",
            },
          ],
        },
      },
    },
  ]);
}

// ─── トレーラー: 解錠コード通知 ──────────────────────────────────────────────
export async function sendTrailerPasscodeNotice(
  lineUserId: string,
  {
    facilityName,
    date,
    startTime,
    endTime,
    passcode,
  }: {
    facilityName: string;
    date: string;        // YYYY-MM-DD
    startTime: string;   // HH:MM
    endTime: string;
    passcode: string;
  }
) {
  const dateLabel = formatDate(date);
  await pushMessage(lineUserId, [
    {
      type: "text",
      text:
        `🔑 ${facilityName} 解錠コード\n\n` +
        `コード: ${passcode}\n` +
        `有効: ${dateLabel} ${startTime}〜${endTime}\n\n` +
        `※予約時間中のみ有効な使い捨てコードです。終了後は無効になります。`,
    },
  ]);
}

// ─── キャンセル完了通知 ────────────────────────────────────────────────────────
export async function sendReservationCancelled(
  lineUserId: string,
  {
    facilityName,
    date,
    startTime,
    endTime,
  }: {
    facilityName: string;
    date: string;
    startTime: string;
    endTime: string;
  }
) {
  const dateLabel = formatDate(date);

  await pushMessage(lineUserId, [
    {
      type: "text",
      text: `【EIGHT BASE UNGA 予約キャンセル】\n以下の予約をキャンセルしました。\n\n施設：${facilityName}\n日時：${dateLabel} ${startTime}〜${endTime}`,
    },
  ]);
}

// ─── 予約リマインド通知（30分前）──────────────────────────────────────────────
export async function sendReservationReminder(
  lineUserId: string,
  {
    facilityName,
    date,
    startTime,
    endTime,
  }: {
    facilityName: string;
    date: string;
    startTime: string;
    endTime: string;
  }
) {
  const dateLabel = formatDate(date);

  await pushMessage(lineUserId, [
    {
      type: "flex",
      altText: `【リマインド】${facilityName} ${startTime}〜 まもなく開始`,
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: "#B0E401",
          paddingAll: "14px",
          contents: [
            {
              type: "text",
              text: "まもなく予約の時間です",
              color: "#231714",
              weight: "bold",
              size: "md",
            },
          ],
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            labelValue("施設", facilityName),
            labelValue("日時", `${dateLabel} ${startTime} 〜 ${endTime}`),
            {
              type: "separator",
              margin: "md",
            },
            {
              type: "text",
              text: "ご利用の30分前です。お忘れなくご来館ください。",
              color: "#888888",
              size: "xs",
              margin: "md",
              wrap: true,
            },
          ],
        },
      },
    },
  ]);
}

// ─── コンテンツ公開通知（イベント・ゲーム・ニュース）─────────────────────────
type ContentType = "event" | "game" | "news";

const CONTENT_CONFIG: Record<ContentType, { label: string; path: string; color: string }> = {
  event: { label: "イベント", path: "/events", color: "#A5C1C8" },
  game:  { label: "ゲーム",   path: "/games",  color: "#A5C1C8" },
  news:  { label: "ニュース", path: "/news",   color: "#A5C1C8" },
};

export async function broadcastContentPublished(
  userIds: string[],
  contentType: ContentType,
  title: string,
) {
  if (userIds.length === 0) return;

  const config = CONTENT_CONFIG[contentType];
  const url = liffUrl(config.path);

  await multicastMessage(userIds, [
    {
      type: "flex",
      altText: `新しい${config.label}があります！「${title}」`,
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: config.color,
          paddingAll: "14px",
          contents: [
            {
              type: "text",
              text: `新しい${config.label}があります！`,
              color: "#231714",
              weight: "bold",
              size: "md",
            },
          ],
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: title,
              weight: "bold",
              size: "md",
              wrap: true,
              color: "#231714",
            },
            {
              type: "text",
              text: "以下から確認できます。",
              color: "#888888",
              size: "xs",
              margin: "md",
              wrap: true,
            },
          ],
        },
        footer: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "button",
              action: {
                type: "uri",
                label: `${config.label}を見る`,
                uri: url,
              },
              style: "primary",
              color: "#A5C1C8",
            },
          ],
        },
      },
    },
  ]);
}

// ─── 掲示板コメント通知 ──────────────────────────────────────────────────────
export async function sendCommentNotification(
  postAuthorLineUserId: string,
  {
    commenterName,
    postContent,
    postId,
  }: {
    commenterName: string;
    postContent: string;   // 投稿本文（プレビュー用）
    postId: string;
  }
) {
  const preview = postContent.length > 30 ? postContent.slice(0, 30) + "…" : postContent;
  const url = liffUrl(`/timeline/${postId}`);

  await pushMessage(postAuthorLineUserId, [
    {
      type: "flex",
      altText: `${commenterName}さんがあなたの投稿にコメントしました`,
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: "#A5C1C8",
          paddingAll: "14px",
          contents: [
            {
              type: "text",
              text: "投稿にコメントがつきました",
              color: "#231714",
              weight: "bold",
              size: "md",
            },
          ],
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: `${commenterName}さんがコメントしました`,
              size: "sm",
              color: "#231714",
              wrap: true,
            },
            {
              type: "separator",
              margin: "md",
            },
            {
              type: "text",
              text: `あなたの投稿「${preview}」`,
              color: "#888888",
              size: "xs",
              margin: "md",
              wrap: true,
            },
          ],
        },
        footer: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "button",
              action: {
                type: "uri",
                label: "投稿を確認する",
                uri: url,
              },
              style: "primary",
              color: "#A5C1C8",
            },
          ],
        },
      },
    },
  ]);
}

// ─── CS候補者通知 ──────────────────────────────────────────────────────────────
export async function sendCsNotification(
  userIds: string[],
  {
    title,
    startAt,
    location,
  }: {
    title: string;
    startAt: string;
    location: string;
  }
) {
  if (userIds.length === 0) return;

  const dateLabel = startAt.length >= 10 ? formatDate(startAt.slice(0, 10)) : startAt;

  await multicastMessage(userIds, [
    {
      type: "flex",
      altText: `【CS選出のお知らせ】${title}`,
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: "#B0E401",
          paddingAll: "14px",
          contents: [
            {
              type: "text",
              text: "CS（チャンピオンシップ）選出",
              color: "#231714",
              weight: "bold",
              size: "md",
            },
          ],
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: "おめでとうございます！あなたはCSに選出されました。",
              size: "sm",
              color: "#231714",
              wrap: true,
            },
            {
              type: "separator",
              margin: "md",
            },
            labelValue("大会名", title),
            labelValue("日程", dateLabel),
            labelValue("会場", location),
            {
              type: "separator",
              margin: "md",
            },
            {
              type: "text",
              text: "詳細はアプリの「ゲーム」タブからご確認ください。辞退される場合はお早めにご連絡ください。",
              color: "#888888",
              size: "xs",
              margin: "md",
              wrap: true,
            },
          ],
        },
        footer: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "button",
              action: {
                type: "uri",
                label: "詳細を確認する",
                uri: liffUrl("/info"),
              },
              style: "primary",
              color: "#B0E401",
            },
          ],
        },
      },
    },
  ]);
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────
function labelValue(label: string, value: string) {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: label, color: "#888888", size: "sm", flex: 2 },
      { type: "text", text: value, size: "sm", flex: 5, wrap: true },
    ],
  };
}

function formatDate(date: string): string {
  // YYYY-MM-DD → M月D日（曜日）
  const d = new Date(date);
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}月${d.getDate()}日（${days[d.getDay()]}）`;
}
