"use client";

/**
 * 「対戦記録」タブの共通プレースホルダ（4種目で同一）。
 *
 * このタブの中身は **その開催日に参加していて、かつ当日である** ときだけ意味がある。
 * それ以外（参加していない／今日は開催日でない／シーズン未作成・取得失敗）は、
 * 種目ごとにバラバラの文言（「準備中です」「アクティブなシーズンがありません」
 * 「本日のゲームマスターが未定です」…）を出していたため、ここに一本化した。
 *
 * ⚠️ 呼び出し側は **データが取れなかった場合（day が null）も必ずこれを出す**こと。
 *    「取得できたが非参加」だけを弾くと、シーズン未作成やAPIエラーのときに
 *    進行UI（GM選出ボタン等）が非参加者に見えてしまう。
 */
export function DayTabPlaceholder() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-8 text-center">
      <div className="text-[14px] font-extrabold text-[#231714]">参加当日に表示されます</div>
      <p className="text-[12px] text-[#3c4f54] mt-2 leading-relaxed">
        「参加」タブから開催日にお申し込みいただくと、当日この画面に
        <br className="hidden sm:inline" />
        進行状況（ゲームマスターの選出・スコア申告）が表示されます。
      </p>
    </div>
  );
}
