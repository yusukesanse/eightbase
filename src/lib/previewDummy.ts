/**
 * プレビューモード専用のダミーデータ。
 *
 * 目的: demo/preview で麻雀リーグ・掲示板などを「中身のある状態」で確認できるようにする。
 * 重要: これは **isPreviewMode(req) === true のときだけ** 各 GET API が返す。
 *       本番ユーザーは preview Cookie を持たないため絶対に通らない。
 *       Firestore へは一切書き込まない（メモリ上の固定データを返すのみ）= 本番にも demo DB にも影響なし。
 *
 * 型は本体の API レスポンス形に合わせている。シードIDは "demo-" 接頭辞で実データと区別。
 */

import type {
  MahjongStanding,
  MahjongCsEvent,
  MahjongScheduleEntry,
  NewsItem,
  NufEvent,
  MahjongLeagueTier,
} from "@/types";

/** プレビュー上の「自分」とみなすダミーID（YOU 強調表示に使用） */
export const PREVIEW_DUMMY_USER_ID = "demo-you";
const PREVIEW_SEASON_ID = "demo-season";

/* ───────── 掲示板（/api/posts） ───────── */

export interface PreviewPost {
  postId: string;
  authorId: string;
  authorName: string;
  authorPictureUrl: string;
  authorLineUrl: string;
  type: "offer" | "request";
  content: string;
  tags: string[];
  likes: string[];
  commentCount: number;
  createdAt: string;
}

export const dummyPosts: PreviewPost[] = [
  {
    postId: "demo-post-1",
    authorId: "demo-u2",
    authorName: "佐藤 みなみ",
    authorPictureUrl: "",
    authorLineUrl: "",
    type: "offer",
    content: "WebサイトのUIデザイン、お手伝いできます。Figmaでの設計〜実装ハンドオフまで。気軽にどうぞ！",
    tags: ["デザイン", "Figma", "UI"],
    likes: ["demo-u3", "demo-u4", "demo-you"],
    commentCount: 0,
    createdAt: "2026-06-18T02:30:00.000Z",
  },
  {
    postId: "demo-post-2",
    authorId: "demo-u3",
    authorName: "鈴木 健太",
    authorPictureUrl: "",
    authorLineUrl: "",
    type: "request",
    content: "個人開発のLPで、コピーライティングを相談できる方を探しています。短時間でもOKです。",
    tags: ["ライティング", "募集"],
    likes: ["demo-u2"],
    commentCount: 0,
    createdAt: "2026-06-17T09:10:00.000Z",
  },
  {
    postId: "demo-post-3",
    authorId: "demo-u4",
    authorName: "高橋 あや",
    authorPictureUrl: "",
    authorLineUrl: "",
    type: "offer",
    content: "確定申告まわりの相談に乗れます（税理士）。フリーランスの方ぜひ。",
    tags: ["税務", "相談"],
    likes: [],
    commentCount: 0,
    createdAt: "2026-06-15T23:45:00.000Z",
  },
];

/* ───────── メンバー一覧（/api/members） ───────── */

export interface PreviewMember {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  catchphrase: string;
  skills: string[];
  companyName: string;
  jobTitle: string;
  bio: string;
  companyUrl: string;
  socialLinks: { instagram?: string; x?: string; facebook?: string; other?: string };
  lineUrl: string;
}

export const dummyMembers: PreviewMember[] = [
  {
    lineUserId: "demo-u2",
    displayName: "佐藤 みなみ",
    pictureUrl: "",
    catchphrase: "伝わるUIをつくります",
    skills: ["UIデザイン", "Figma", "フロントエンド"],
    companyName: "スタジオ・ミナ",
    jobTitle: "UIデザイナー",
    bio: "受託・自社サービス問わずUI設計をしています。コワーキングではよくモブデザインしてます。",
    companyUrl: "https://example.com",
    socialLinks: { instagram: "https://instagram.com/", x: "https://x.com/" },
    lineUrl: "https://line.me/R/ti/p/@example",
  },
  {
    lineUserId: "demo-u3",
    displayName: "鈴木 健太",
    pictureUrl: "",
    catchphrase: "言葉で価値を届ける",
    skills: ["コピーライティング", "マーケティング"],
    companyName: "フリーランス",
    jobTitle: "コピーライター",
    bio: "LP・広告のコピーが得意です。雑談からの壁打ち歓迎。",
    companyUrl: "",
    socialLinks: { x: "https://x.com/" },
    lineUrl: "",
  },
  {
    lineUserId: "demo-u4",
    displayName: "高橋 あや",
    pictureUrl: "",
    catchphrase: "数字まわりはお任せを",
    skills: ["税務", "会計", "バックオフィス"],
    companyName: "高橋会計事務所",
    jobTitle: "税理士",
    bio: "フリーランス・スタートアップの税務顧問。",
    companyUrl: "https://example.com",
    socialLinks: {},
    lineUrl: "https://line.me/R/ti/p/@example",
  },
  {
    lineUserId: "demo-you",
    displayName: "あなた（プレビュー）",
    pictureUrl: "",
    catchphrase: "プレビュー表示用のサンプルです",
    skills: ["プロダクト", "ディレクション"],
    companyName: "エイトベース",
    jobTitle: "ディレクター",
    bio: "これはプレビューモードのサンプルプロフィールです。",
    companyUrl: "https://example.com",
    socialLinks: { instagram: "https://instagram.com/" },
    lineUrl: "",
  },
];

/* ───────── ニュース（/api/news） ───────── */

export const dummyNews: NewsItem[] = [
  {
    newsId: "demo-news-1",
    title: "コワーキングスペース 7月の営業時間について",
    body: "7月の営業時間は平日9:00〜21:00、土日10:00〜18:00です。祝日は休業となります。",
    category: "info",
    publishedAt: "2026-06-20T00:00:00.000Z",
    priority: "high",
    published: true,
  },
  {
    newsId: "demo-news-2",
    title: "新しい会議室（Room C）がオープンしました",
    body: "6名まで利用可能な会議室を増設しました。予約画面からご利用いただけます。",
    category: "facility",
    publishedAt: "2026-06-14T00:00:00.000Z",
    priority: "normal",
    published: true,
  },
  {
    newsId: "demo-news-3",
    title: "メンバー交流会のお知らせ",
    body: "毎月第3金曜の夜に交流会を開催しています。お気軽にご参加ください。",
    category: "community",
    publishedAt: "2026-06-10T00:00:00.000Z",
    priority: "normal",
    published: true,
  },
];

/* ───────── イベント（/api/events） ───────── */

export const dummyEvents: (Omit<NufEvent, "eventId"> & { eventId: string; goodCount: number })[] = [
  {
    eventId: "demo-event-1",
    title: "もくもく会 #12",
    category: "勉強会",
    description: "各自の作業をもくもく進める会。途中参加・退出自由です。",
    startAt: "2026-07-03T10:00:00.000Z",
    endAt: "2026-07-03T13:00:00.000Z",
    location: "ラウンジ",
    published: true,
    goodCount: 8,
  },
  {
    eventId: "demo-event-2",
    title: "ライトニングトーク Night",
    category: "交流",
    description: "5分間のLT大会。登壇者募集中！",
    startAt: "2026-07-17T10:00:00.000Z",
    endAt: "2026-07-17T12:00:00.000Z",
    location: "イベントスペース",
    published: true,
    goodCount: 15,
  },
];

/* ───────── 麻雀リーグ 順位表（/api/mahjong/standings） ───────── */

function tierOf(rank: number): MahjongLeagueTier {
  if (rank <= 4) return "M1";
  if (rank <= 8) return "M2";
  return "M3";
}

function buildStanding(
  rank: number,
  lineUserId: string,
  displayName: string,
  average: number,
  gamesPlayed: number,
  firstCount: number,
  top2Count: number
): MahjongStanding {
  return {
    lineUserId,
    displayName,
    pictureUrl: "",
    gamesPlayed,
    totalPoints: Math.round(average * gamesPlayed),
    average,
    firstCount,
    top2Count,
    firstRate: gamesPlayed ? firstCount / gamesPlayed : 0,
    top2Rate: gamesPlayed ? top2Count / gamesPlayed : 0,
    csEligible: gamesPlayed >= 5,
    rank,
    tier: tierOf(rank),
  };
}

export const dummyStandings: {
  standings: MahjongStanding[];
  seasonId: string;
  currentUserId: string;
} = {
  standings: [
    buildStanding(1, "demo-you", "あなた（プレビュー）", 32800, 8, 4, 6),
    buildStanding(2, "demo-u2", "佐藤 みなみ", 30100, 8, 3, 5),
    buildStanding(3, "demo-u3", "鈴木 健太", 28400, 7, 2, 4),
    buildStanding(4, "demo-u4", "高橋 あや", 27200, 8, 2, 4),
    buildStanding(5, "demo-u5", "田中 大輔", 26500, 7, 2, 3),
    buildStanding(6, "demo-u6", "渡辺 さくら", 25100, 6, 1, 3),
    buildStanding(7, "demo-u7", "伊藤 翔", 24300, 6, 1, 2),
    buildStanding(8, "demo-u8", "山本 結衣", 23800, 5, 1, 2),
    buildStanding(9, "demo-u9", "中村 拓海", 22100, 5, 0, 1),
    buildStanding(10, "demo-u10", "小林 美月", 20400, 5, 0, 1),
  ],
  seasonId: PREVIEW_SEASON_ID,
  currentUserId: PREVIEW_DUMMY_USER_ID,
};

/* ───────── 麻雀 日程（/api/mahjong/schedule） ───────── */

export const dummySchedule: MahjongScheduleEntry[] = [
  { scheduleId: "demo-sch-1", seasonId: PREVIEW_SEASON_ID, date: "2026-07-11", startTime: "12:00", endTime: "18:00", type: "league", createdAt: "2026-06-01T00:00:00.000Z" },
  { scheduleId: "demo-sch-2", seasonId: PREVIEW_SEASON_ID, date: "2026-08-08", startTime: "12:00", endTime: "18:00", type: "league", createdAt: "2026-06-01T00:00:00.000Z" },
  { scheduleId: "demo-sch-3", seasonId: PREVIEW_SEASON_ID, date: "2026-09-05", startTime: "12:00", endTime: "18:00", type: "league", createdAt: "2026-06-01T00:00:00.000Z" },
];

/* ───────── 麻雀 CS（/api/mahjong/cs） ───────── */

const csEvent: MahjongCsEvent = {
  csEventId: "demo-cs-1",
  seasonId: PREVIEW_SEASON_ID,
  name: "第1回 EIGHTBASE 麻雀チャンピオンシップ",
  eventDate: "2027-06-19",
  status: "finished",
  entrants: [
    { lineUserId: "demo-you", displayName: "あなた（プレビュー）", pictureUrl: "", tier: "M1", rank: 1, seed: true },
    { lineUserId: "demo-u2", displayName: "佐藤 みなみ", pictureUrl: "", tier: "M1", rank: 2, seed: true },
    { lineUserId: "demo-u3", displayName: "鈴木 健太", pictureUrl: "", tier: "M1", rank: 3, seed: false },
    { lineUserId: "demo-u4", displayName: "高橋 あや", pictureUrl: "", tier: "M1", rank: 4, seed: false },
  ],
  rounds: [
    {
      type: "semi",
      label: "準決勝",
      advanceCount: 2,
      matches: [
        {
          matchId: "demo-semi-1",
          label: "準決1",
          status: "completed",
          players: [
            { lineUserId: "demo-you", displayName: "あなた（プレビュー）", pictureUrl: "", points: 38200, rank: 1 },
            { lineUserId: "demo-u3", displayName: "鈴木 健太", pictureUrl: "", points: 27600, rank: 2 },
            { lineUserId: "demo-u5", displayName: "田中 大輔", pictureUrl: "", points: 19800, rank: 3 },
            { lineUserId: "demo-u7", displayName: "伊藤 翔", pictureUrl: "", points: 14400, rank: 4 },
          ],
        },
        {
          matchId: "demo-semi-2",
          label: "準決2",
          status: "completed",
          players: [
            { lineUserId: "demo-u2", displayName: "佐藤 みなみ", pictureUrl: "", points: 35100, rank: 1 },
            { lineUserId: "demo-u4", displayName: "高橋 あや", pictureUrl: "", points: 28900, rank: 2 },
            { lineUserId: "demo-u6", displayName: "渡辺 さくら", pictureUrl: "", points: 21300, rank: 3 },
            { lineUserId: "demo-u8", displayName: "山本 結衣", pictureUrl: "", points: 14700, rank: 4 },
          ],
        },
      ],
    },
    {
      type: "final",
      label: "決勝",
      advanceCount: 1,
      matches: [
        {
          matchId: "demo-final",
          label: "決勝",
          status: "completed",
          players: [
            { lineUserId: "demo-you", displayName: "あなた（プレビュー）", pictureUrl: "", points: 41200, rank: 1 },
            { lineUserId: "demo-u2", displayName: "佐藤 みなみ", pictureUrl: "", points: 29500, rank: 2 },
            { lineUserId: "demo-u4", displayName: "高橋 あや", pictureUrl: "", points: 18800, rank: 3 },
            { lineUserId: "demo-u3", displayName: "鈴木 健太", pictureUrl: "", points: 10500, rank: 4 },
          ],
        },
      ],
    },
  ],
  championId: "demo-you",
  createdAt: "2027-06-01T00:00:00.000Z",
  updatedAt: "2027-06-19T12:00:00.000Z",
};

export const dummyCs: { event: MahjongCsEvent; entered: boolean } = {
  event: csEvent,
  entered: true,
};
