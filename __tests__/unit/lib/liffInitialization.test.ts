const mockInit = jest.fn();
jest.mock("@line/liff", () => ({
  __esModule: true,
  default: { init: mockInit },
}));

beforeEach(() => {
  jest.resetModules();
  mockInit.mockReset();
  process.env.NEXT_PUBLIC_LIFF_ID_PROD = "test-liff-id";
});

afterEach(() => { delete process.env.NEXT_PUBLIC_LIFF_ID_PROD; });

test("concurrent callers initialize LIFF once", async () => {
  let finish!: () => void;
  mockInit.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  const { initLiff } = await import("@/lib/liff");
  const first = initLiff();
  const second = initLiff();
  // Dynamic SDK import resolves before its init promise.
  await Promise.resolve();
  await Promise.resolve();
  expect(mockInit).toHaveBeenCalledTimes(1);
  finish();
  const [a, b] = await Promise.all([first, second]);
  expect(a).toBe(b);
  expect(await initLiff()).toBe(a);
  expect(mockInit).toHaveBeenCalledTimes(1);
});

test("failed initialization can be retried", async () => {
  mockInit.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
  const { initLiff } = await import("@/lib/liff");
  await expect(initLiff()).rejects.toThrow("offline");
  await expect(initLiff()).resolves.toBeDefined();
  expect(mockInit).toHaveBeenCalledTimes(2);
});
