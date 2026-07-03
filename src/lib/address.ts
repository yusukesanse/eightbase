/** 郵便番号→住所（zipcloud）。プロフィール登録/編集の住所自動入力で共用。 */
export async function lookupAddressByPostalCode(
  postalCode: string
): Promise<{ prefecture: string; city: string } | null> {
  const code = postalCode.replace(/[-\s]/g, "");
  if (code.length !== 7) return null;
  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${code}`);
    const data = await res.json();
    const r = data.results?.[0];
    if (r) return { prefecture: r.address1, city: r.address2 + r.address3 };
  } catch {
    /* ignore */
  }
  return null;
}
