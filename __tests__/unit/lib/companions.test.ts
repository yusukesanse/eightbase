/**
 * 単体テスト: 同伴者の純関数（サウナ等・1人での利用を禁止する施設）
 *
 * ここで守りたいこと:
 *  - 同伴者必須OFFの既存施設が一切影響を受けないこと（回帰）
 *  - 重複した同伴者で最低人数を水増しできないこと
 */
import type { Facility } from "@/types";
import {
  normalizeCompanionIds,
  checkPartySize,
  buildCompanionCalendarLines,
  minPartySizeOf,
  maxCompanionsOf,
  MAX_COMPANIONS,
} from "@/lib/companions";

const SELF = "U-self";

/** 同伴者設定だけを持つ最小の施設 */
function facility(over: Partial<Facility> = {}): Facility {
  return {
    id: "sauna",
    name: "サウナ",
    type: "activity",
    capacity: 6,
    calendarId: "cal@example.com",
    ...over,
  };
}

describe("normalizeCompanionIds", () => {
  test("未指定は空配列", () => {
    expect(normalizeCompanionIds(undefined, SELF)).toEqual({ ok: true, ids: [] });
    expect(normalizeCompanionIds(null, SELF)).toEqual({ ok: true, ids: [] });
  });

  test("重複は除去する（同じ人を2回選んで人数を水増しできない）", () => {
    const r = normalizeCompanionIds(["U-a", "U-a", "U-b"], SELF);
    expect(r).toEqual({ ok: true, ids: ["U-a", "U-b"] });
  });

  test("前後の空白は落とす", () => {
    expect(normalizeCompanionIds([" U-a "], SELF)).toEqual({ ok: true, ids: ["U-a"] });
  });

  test("自分自身が混ざっていたら COMPANION_SELF", () => {
    const r = normalizeCompanionIds(["U-a", SELF], SELF);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("COMPANION_SELF");
  });

  test("配列でない・文字列でない・空文字は COMPANION_INVALID", () => {
    for (const raw of ["U-a", 123, { a: 1 }, [1], [""], ["  "]]) {
      const r = normalizeCompanionIds(raw, SELF);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason).toBe("COMPANION_INVALID");
    }
  });
});

describe("minPartySizeOf / maxCompanionsOf", () => {
  test("minPartySize 未設定は既定の2", () => {
    expect(minPartySizeOf(facility())).toBe(2);
  });

  test("2未満の不正値は既定の2に丸める", () => {
    expect(minPartySizeOf(facility({ minPartySize: 1 }))).toBe(2);
    expect(minPartySizeOf(facility({ minPartySize: 0 }))).toBe(2);
  });

  test("設定値をそのまま使う", () => {
    expect(minPartySizeOf(facility({ minPartySize: 3 }))).toBe(3);
  });

  test("同伴者の上限は収容人数 - 予約者本人", () => {
    expect(maxCompanionsOf(facility({ capacity: 4 }))).toBe(3);
  });

  test("収容人数1名でも最低1名は選べる（設定ミスでUIが詰まないように）", () => {
    expect(maxCompanionsOf(facility({ capacity: 1 }))).toBe(1);
  });

  test("収容人数が大きくても MAX_COMPANIONS を超えない", () => {
    expect(maxCompanionsOf(facility({ capacity: 100 }))).toBe(MAX_COMPANIONS);
  });
});

describe("checkPartySize", () => {
  describe("同伴者必須OFF（既存施設の回帰）", () => {
    test("同伴者0名なら ok", () => {
      expect(checkPartySize(facility(), 0)).toEqual({ ok: true });
    });

    test("同伴者が来たら COMPANION_NOT_ALLOWED（サイレント無視しない）", () => {
      const r = checkPartySize(facility(), 1);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason).toBe("COMPANION_NOT_ALLOWED");
    });
  });

  describe("同伴者必須ON", () => {
    const sauna = facility({ requireCompanions: true, minPartySize: 2 });

    test("同伴者0名は COMPANION_REQUIRED", () => {
      const r = checkPartySize(sauna, 0);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason).toBe("COMPANION_REQUIRED");
    });

    test("同伴者1名（合計2名）で ok — 要件の境界", () => {
      expect(checkPartySize(sauna, 1)).toEqual({ ok: true });
    });

    test("minPartySize=3 なら同伴者1名はNG・2名でOK", () => {
      const f = facility({ requireCompanions: true, minPartySize: 3 });
      expect(checkPartySize(f, 1).ok).toBe(false);
      expect(checkPartySize(f, 2)).toEqual({ ok: true });
    });

    test("minPartySize 未設定でも既定の2名が効く", () => {
      const f = facility({ requireCompanions: true });
      expect(checkPartySize(f, 0).ok).toBe(false);
      expect(checkPartySize(f, 1)).toEqual({ ok: true });
    });

    test("収容人数を超えると COMPANION_TOO_MANY", () => {
      const f = facility({ requireCompanions: true, minPartySize: 2, capacity: 4 });
      expect(checkPartySize(f, 3)).toEqual({ ok: true }); // 合計4名 = ちょうど収容人数
      const r = checkPartySize(f, 4);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason).toBe("COMPANION_TOO_MANY");
    });

    test("収容人数が大きくても MAX_COMPANIONS を超えると COMPANION_TOO_MANY", () => {
      const f = facility({ requireCompanions: true, minPartySize: 2, capacity: 100 });
      expect(checkPartySize(f, MAX_COMPANIONS)).toEqual({ ok: true });
      const r = checkPartySize(f, MAX_COMPANIONS + 1);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason).toBe("COMPANION_TOO_MANY");
    });
  });
});

describe("buildCompanionCalendarLines", () => {
  test("同伴者なしは空文字（既存施設のイベント本文を変えない）", () => {
    expect(buildCompanionCalendarLines([], 1)).toBe("");
  });

  test("複数名は「、」で連結し合計人数を添える", () => {
    expect(
      buildCompanionCalendarLines([{ displayName: "山田太郎" }, { displayName: "佐藤花子" }], 3)
    ).toBe("\n同伴者: 山田太郎、佐藤花子\n合計人数: 3名");
  });
});
