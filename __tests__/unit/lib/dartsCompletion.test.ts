/**
 * 単体テスト（再発防止）: Issue 2 の判定 classifyDartsCompletion。
 * 旧 dartsCsFinal.test.ts から、CS（旧方式）以外のテストだけを残したもの。
 */
import { classifyDartsCompletion } from "@/lib/dartsDay";

describe("classifyDartsCompletion（Issue 2）", () => {
  test("中止済み → 返金待ち", () => {
    expect(classifyDartsCompletion({ cancelled: true, closed: false, isConfirmedParticipant: false, entryExists: true })).toBe("refundPending");
  });
  test("entry が消えている → 返金待ち", () => {
    expect(classifyDartsCompletion({ cancelled: false, closed: false, isConfirmedParticipant: false, entryExists: false })).toBe("refundPending");
  });
  test("締切後の非確定参加者 → 返金待ち", () => {
    expect(classifyDartsCompletion({ cancelled: false, closed: true, isConfirmedParticipant: false, entryExists: true })).toBe("refundPending");
  });
  test("締切後でも確定参加者なら paid（開始時に確定済み・通常は起きない）", () => {
    expect(classifyDartsCompletion({ cancelled: false, closed: true, isConfirmedParticipant: true, entryExists: true })).toBe("paid");
  });
  test("受付中に成立 → paid", () => {
    expect(classifyDartsCompletion({ cancelled: false, closed: false, isConfirmedParticipant: false, entryExists: true })).toBe("paid");
  });
});
