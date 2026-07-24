/**
 * LINE Messaging API — Push / Multicast Message
 * SDK を使わず fetch で直接呼び出す軽量実装
 */

import { liffUrl } from "./liffUrl";
import { getActiveLineUserIdsByRoles } from "./firebaseAdmin";
import type { UserRole } from "./roles";

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

/**
 * マルチキャスト（最大500人同時送信）
 * 500人を超える場合は自動分割
 */
async function multicastMessage(
  userIds: string[],
  messages: object[]
): Promise<{ ok: boolean; failedBatches: number }> {
  const BATCH_SIZE = 500;
  let failedBatches = 0;
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
      failedBatches++;
    }
  }
  return { ok: failedBatches === 0, failedBatches };
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

// ─── 麻雀リーグ 人数不足による中止（流会）通知 ──────────────────────────────
export async function sendMahjongForfeitNotice(
  lineUserId: string,
  { eventDate }: { eventDate: string }
) {
  const dateLabel = formatDate(eventDate);
  await pushMessage(lineUserId, [
    {
      type: "flex",
      altText: `【麻雀リーグ 中止】${dateLabel} は人数不足のため中止です`,
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: "#d8a526",
          paddingAll: "14px",
          contents: [
            { type: "text", text: "本日のリーグ戦は中止です", color: "#231714", weight: "bold", size: "md" },
          ],
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            labelValue("開催日", dateLabel),
            { type: "separator", margin: "md" },
            {
              type: "text",
              text: "参加者が規定人数（4名）に満たなかったため、リーグ戦は中止となりました。お支払いいただいた参加費は返金対応いたします（担当より順次ご連絡します）。",
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
              action: { type: "uri", label: "アプリを開く", uri: liffUrl("/info") },
              style: "primary",
              color: "#d8a526",
            },
          ],
        },
      },
    },
  ]);
}

// ─── コンテンツ公開通知（イベント・ゲーム・ニュース）─────────────────────────
export type ContentType = "event" | "game" | "news";

const VALID_AUDIENCE_ROLES: UserRole[] = ["member", "staff", "guest"];

/**
 * 保存/受信した配信対象を UserRole[] に正規化する。
 * - 配列: 既知 role のみ残し重複排除（空配列＝送らない、として尊重）。
 * - 配列でない（未設定の旧 doc 等）: 種別の既定にフォールバック。
 */
export function sanitizeAudience(input: unknown, contentType: ContentType): UserRole[] {
  if (!Array.isArray(input)) return defaultBroadcastAudience(contentType);
  return Array.from(
    new Set(input.filter((r): r is UserRole => VALID_AUDIENCE_ROLES.includes(r as UserRole)))
  );
}

const CONTENT_CONFIG: Record<ContentType, { label: string; path: string; color: string }> = {
  event: { label: "イベント", path: "/events", color: "#A5C1C8" },
  game:  { label: "ゲーム",   path: "/games",  color: "#A5C1C8" },
  news:  { label: "ニュース", path: "/news",   color: "#A5C1C8" },
};

/**
 * 種別ごとの既定配信対象（doc に lineBroadcastAudience が無い場合のフォールバック）。
 * ニュース/イベントは会員系のみ、ゲームは全員（ゲストも閲覧可）。
 */
export function defaultBroadcastAudience(contentType: ContentType): UserRole[] {
  return contentType === "game" ? ["member", "staff", "guest"] : ["member", "staff"];
}

/** ボタンの遷移先。ゲストは会員専用ルート(/news,/events)に入れないので /info に振る。 */
function contentLink(contentType: ContentType, forGuest: boolean): { uri: string; label: string } {
  const config = CONTENT_CONFIG[contentType];
  // ゲームは全員 /games。ニュース/イベントのゲスト宛は導線が無いので /info（ゲームハブ）。
  if (forGuest && contentType !== "game") {
    return { uri: liffUrl("/info"), label: "アプリを開く" };
  }
  return { uri: liffUrl(config.path), label: `${config.label}を見る` };
}

function contentFlex(contentType: ContentType, title: string, forGuest: boolean): object {
  const config = CONTENT_CONFIG[contentType];
  const link = contentLink(contentType, forGuest);
  return {
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
          { type: "text", text: `新しい${config.label}があります！`, color: "#231714", weight: "bold", size: "md" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: title, weight: "bold", size: "md", wrap: true, color: "#231714" },
          { type: "text", text: "以下から確認できます。", color: "#888888", size: "xs", margin: "md", wrap: true },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "button", action: { type: "uri", label: link.label, uri: link.uri }, style: "primary", color: "#A5C1C8" },
        ],
      },
    },
  };
}

/**
 * コンテンツ公開の一斉通知。**宛先 role ごとに文面（導線）を分けて** multicast する。
 * - member/staff … 会員系の導線（/news, /events, /games）
 * - guest … ゲーム=/games、ニュース/イベント=/info（会員専用ルートに入れないため）
 * 宛先は `getActiveLineUserIdsByRoles` で登録ユーザーのみに限定（未登録フォロワーには届かない）。
 */
export async function broadcastContentPublished(
  contentType: ContentType,
  title: string,
  audience: UserRole[],
): Promise<{ recipientCount: number; ok: boolean }> {
  if (!audience || audience.length === 0) return { recipientCount: 0, ok: true };

  let recipientCount = 0;
  let ok = true;
  const memberRoles = audience.filter((r) => r === "member" || r === "staff");
  if (memberRoles.length > 0) {
    const ids = await getActiveLineUserIdsByRoles(memberRoles);
    if (ids.length > 0) {
      const r = await multicastMessage(ids, [contentFlex(contentType, title, false)]);
      recipientCount += ids.length;
      if (!r.ok) ok = false;
    }
  }
  if (audience.includes("guest")) {
    const ids = await getActiveLineUserIdsByRoles(["guest"]);
    if (ids.length > 0) {
      const r = await multicastMessage(ids, [contentFlex(contentType, title, true)]);
      recipientCount += ids.length;
      if (!r.ok) ok = false;
    }
  }
  return { recipientCount, ok };
}

/**
 * コンテンツ公開通知を「1 doc につき最大1回」だけ送る（news/event/game 共通）。
 * - 既に `lineNotifiedAt` があれば送らない（下書き↔公開の往復・POSTとcronの二重発火・再保存での再送を防ぐ）。
 * - 送信「済み」の主張(claim)を transaction で原子化し、同時発火でも二重送信しない。
 * - 送信結果（件数/成否/エラー）を doc の `lineNotifyResult` に記録し、管理者が追跡できるようにする。
 * - 送信に失敗したら claim を解除して**再試行可能**にする（次の公開遷移や再保存でやり直せる）。
 */
export async function notifyContentPublishedOnce(
  db: FirebaseFirestore.Firestore,
  collectionName: string,
  docId: string,
  contentType: ContentType,
  title: string,
  lineNotify: boolean,
  audience: UserRole[],
): Promise<{ sent: boolean; recipientCount: number; reason?: string }> {
  if (!lineNotify || audience.length === 0) {
    return { sent: false, recipientCount: 0, reason: "disabled" };
  }
  const ref = db.collection(collectionName).doc(docId);
  const nowIso = new Date().toISOString();

  // 「通知済み」を原子的に主張。既に主張済みなら送らない。
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    if (snap.data()?.lineNotifiedAt) return false;
    tx.update(ref, { lineNotifiedAt: nowIso });
    return true;
  });
  if (!claimed) return { sent: false, recipientCount: 0, reason: "already_notified" };

  try {
    const { recipientCount, ok } = await broadcastContentPublished(contentType, title, audience);
    // ok=false は LINE 配信の一部バッチが失敗（一部は届いている）。二重送信を避けるため claim は維持し、
    // 失敗を結果に残す（管理者が追跡し、必要なら手動で再送を判断できる）。
    await ref.update({
      lineNotifyResult: {
        ok,
        recipientCount,
        audience,
        at: nowIso,
        ...(ok ? {} : { error: "LINE配信の一部が失敗しました（詳細はサーバーログ）" }),
      },
    });
    return { sent: ok, recipientCount, ...(ok ? {} : { reason: "partial_failure" }) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // 送信前の例外（宛先取得失敗など・何も届いていない）: claim を戻して再試行可能にし、失敗を記録する。
    await ref
      .update({ lineNotifiedAt: null, lineNotifyResult: { ok: false, error, audience, at: nowIso } })
      .catch(() => {});
    console.error(`[notifyContentPublishedOnce] ${collectionName}/${docId} broadcast failed:`, error);
    return { sent: false, recipientCount: 0, reason: "error" };
  }
}

/**
 * 管理者アプリ「メッセージ送信」からの自由文配信。指定 lineUserId 群へ multicast。
 * text（＋任意でリンク1つ＝ボタン）。宛先 role 解決は呼び出し側で行う（登録ユーザーのみ）。
 */
export async function sendAdminMessage(
  userIds: string[],
  text: string,
  linkUrl?: string,
): Promise<void> {
  if (userIds.length === 0 || !text.trim()) return;
  const trimmed = text.trim();

  const messages: object[] = linkUrl
    ? [
        {
          type: "flex",
          altText: trimmed.slice(0, 100),
          contents: {
            type: "bubble",
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              contents: [{ type: "text", text: trimmed, wrap: true, size: "md", color: "#231714" }],
            },
            footer: {
              type: "box",
              layout: "vertical",
              contents: [
                { type: "button", action: { type: "uri", label: "開く", uri: linkUrl }, style: "primary", color: "#A5C1C8" },
              ],
            },
          },
        },
      ]
    : [{ type: "text", text: trimmed }];

  await multicastMessage(userIds, messages);
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
