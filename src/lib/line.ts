/**
 * LINE Messaging API — Push Message
 * SDK を使わず fetch で直接呼び出す軽量実装
 */

const LINE_API_BASE = "https://api.line.me/v2/bot";

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
      altText: `【NUF 予約完了】${facilityName} ${dateLabel} ${startTime}〜${endTime}`,
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: "#06C755",
          contents: [
            {
              type: "text",
              text: "予約が完了しました",
              color: "#FFFFFF",
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
      text: `【NUF 予約キャンセル】\n以下の予約をキャンセルしました。\n\n施設：${facilityName}\n日時：${dateLabel} ${startTime}〜${endTime}`,
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
