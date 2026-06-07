import { SquareClient, SquareEnvironment } from "square";

/**
 * Square クライアントのシングルトン
 * 環境変数で sandbox / production を切り替え
 */
let _client: SquareClient | null = null;

export function getSquareClient(): SquareClient {
  if (_client) return _client;

  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("SQUARE_ACCESS_TOKEN が設定されていません");
  }

  const environment = process.env.SQUARE_ENVIRONMENT === "production"
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox;

  _client = new SquareClient({
    token,
    environment,
  });

  return _client;
}

export function getSquareLocationId(): string {
  const id = process.env.SQUARE_LOCATION_ID;
  if (!id) throw new Error("SQUARE_LOCATION_ID が設定されていません");
  return id;
}
