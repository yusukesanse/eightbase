#!/usr/bin/env node
/**
 * SwitchBot デバイス一覧取得 / 時限パスコードの実機テスト用 CLI。
 *
 * 目的: トレーラー予約の実機通し確認のために、施設設定 `switchBotDeviceId` に入れる
 *       キーパッド/ロックの deviceId を取得する。さらに createKey/deleteKey を
 *       手元から直接叩いて、実際にキーパッドで解錠できるか検証する。
 *
 * 認証は src/lib/switchbot.ts と同一（HMAC-SHA256 / sign・t・nonce ヘッダ）。
 * 認証情報は process.env か .env.local の SWITCHBOT_TOKEN / SWITCHBOT_SECRET を使う。
 *
 * 使い方:
 *   node scripts/switchbot-devices.mjs                 # デバイス一覧（deviceId を確認）
 *   node scripts/switchbot-devices.mjs status <id>     # デバイスの状態取得
 *   node scripts/switchbot-devices.mjs createkey <id>  # 5分間有効の6桁テストコードを発行
 *   node scripts/switchbot-devices.mjs deletekey <id> <keyId>  # テストコードを削除
 *
 * ※ createkey は実機に本物の時限パスコードを書き込みます（permanent には触れません）。
 */

import { createHmac, randomUUID, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API_BASE = "https://api.switch-bot.com/v1.1";

// .env.local を簡易ロード（dotenv 非依存。既存 process.env を優先）
function loadEnvLocal() {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const text = readFileSync(join(root, ".env.local"), "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue;
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch {
    // .env.local が無くても process.env だけで動かせる
  }
}

function getCreds() {
  const token = process.env.SWITCHBOT_TOKEN ?? "";
  const secret = process.env.SWITCHBOT_SECRET ?? "";
  if (!token || !secret) {
    console.error(
      "[switchbot] SWITCHBOT_TOKEN / SWITCHBOT_SECRET が未設定です。" +
        ".env.local に設定するか環境変数で渡してください。"
    );
    process.exit(1);
  }
  return { token, secret };
}

function buildAuthHeaders(token, secret, t, nonce) {
  const sign = createHmac("sha256", secret)
    .update(`${token}${t}${nonce}`)
    .digest("base64")
    .toUpperCase();
  return {
    Authorization: token,
    sign,
    t: String(t),
    nonce,
    "Content-Type": "application/json; charset=utf-8",
  };
}

async function api(path, init = {}) {
  const { token, secret } = getCreds();
  const headers = buildAuthHeaders(token, secret, Date.now(), randomUUID());
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.statusCode !== 100) {
    throw new Error(
      `status=${json.statusCode ?? res.status} ${json.message ?? ""}`.trim()
    );
  }
  return json.body ?? {};
}

async function listDevices() {
  const body = await api("/devices");
  const devices = body.deviceList ?? [];
  const remotes = body.infraredRemoteList ?? [];
  console.log(`\n== 物理デバイス (${devices.length}) ==`);
  for (const d of devices) {
    console.log(
      `  ${d.deviceId}\t${d.deviceType ?? "?"}\t${d.deviceName ?? ""}` +
        (d.hubDeviceId ? `\t(hub=${d.hubDeviceId})` : "")
    );
  }
  console.log(`\n== 赤外線リモコン (${remotes.length}) ==`);
  for (const r of remotes) {
    console.log(`  ${r.deviceId}\t${r.remoteType ?? "?"}\t${r.deviceName ?? ""}`);
  }
  console.log(
    "\nヒント: キーパッド/ロック(Smart Lock 系)の deviceId を施設設定 switchBotDeviceId に入れてください。"
  );
}

async function getStatus(id) {
  const body = await api(`/devices/${encodeURIComponent(id)}/status`);
  console.log(JSON.stringify(body, null, 2));
}

async function sendCommand(id, command, parameter) {
  return api(`/devices/${encodeURIComponent(id)}/commands`, {
    method: "POST",
    body: JSON.stringify({ commandType: "command", command, parameter }),
  });
}

async function createTestKey(id) {
  const password = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const startMs = Date.now();
  const endMs = startMs + 5 * 60 * 1000; // 5分間有効
  const body = await sendCommand(id, "createKey", {
    name: `test-${startMs}`,
    type: "timeLimit",
    password,
    startTime: startMs,
    endTime: endMs,
  });
  console.log("createKey OK:", JSON.stringify(body));
  console.log(`\n  パスコード: ${password}（5分間有効）`);
  console.log(`  keyId: ${body.id}  ← deletekey で使用`);
  console.log(`  → キーパッドで ${password} を入力して解錠できるか確認してください。`);
}

async function deleteKey(id, keyId) {
  const body = await sendCommand(id, "deleteKey", { id: Number(keyId) });
  console.log("deleteKey OK:", JSON.stringify(body));
}

async function main() {
  loadEnvLocal();
  const [cmd, ...args] = process.argv.slice(2);
  try {
    switch (cmd) {
      case undefined:
      case "list":
        await listDevices();
        break;
      case "status":
        if (!args[0]) throw new Error("usage: status <deviceId>");
        await getStatus(args[0]);
        break;
      case "createkey":
        if (!args[0]) throw new Error("usage: createkey <deviceId>");
        await createTestKey(args[0]);
        break;
      case "deletekey":
        if (!args[0] || !args[1]) throw new Error("usage: deletekey <deviceId> <keyId>");
        await deleteKey(args[0], args[1]);
        break;
      default:
        console.error(`unknown command: ${cmd}`);
        console.error("commands: list | status <id> | createkey <id> | deletekey <id> <keyId>");
        process.exit(1);
    }
  } catch (e) {
    console.error("[switchbot] エラー:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
