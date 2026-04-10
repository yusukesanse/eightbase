/**
 * LINE Messaging API — Push / Multicast Message
 * SDK を使わず fetch で直接呼び出す軽量実装
 */

const LINE_API_BASE = "https://api.line.me/v2/bot";

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "";

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
          backgroundColor: "#8BB5BF",
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
                uri: `${PORTAL_URL}/my-reservations`,
              },
              style: "primary",
              color: "#8BB5BF",
            },
          ],
        },
      },
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

// ─── コンテンツ公開通知（イベント・クエスト・ニュース）─────────────────────────
type ContentType = "event" | "quest" | "news";

const CONTENT_CONFIG: Record<ContentType, { label: string; path: string; color: string }> = {
  event: { label: "イベント", path: "/events", color: "#8BB5BF" },
  quest: { label: "クエスト", path: "/quests", color: "#8BB5BF" },
  news:  { label: "ニュース", path: "/news",   color: "#8BB5BF" },
};

export async function broadcastContentPublished(
  userIds: string[],
  contentType: ContentType,
  title: string,
) {
  if (userIds.length === 0) return;

  const config = CONTENT_CONFIG[contentType];
  const url = `${PORTAL_URL}${config.path}`;

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
              color: "#8BB5BF",
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
