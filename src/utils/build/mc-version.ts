/**
 * @fileoverview MCバージョンの正規化と比較。チャネルのキーはメジャー系（`1.21`）に丸めます。
 *
 * パッチ違いでレシピが変わることはほぼ無い一方、パッチまでチャネルを切るとチャネル数が数倍になり、
 * 解決スナップショットもキャッシュもその分だけ薄まります。
 */

/** チャネルキーとして妥当なメジャー系の形。 */
const CHANNEL_RE = /^\d+\.\d+$/;

/**
 * MCバージョン文字列をチャネルキー（メジャー系）へ丸めます。
 *
 * `1.21.1` → `1.21`、`1.21` → `1.21`。スナップショットやプレリリース（`24w14a`, `1.21-pre1`）は
 * 解釈できないため null を返し、呼び出し側で弾きます。
 * @param version 生のMCバージョン文字列
 * @returns チャネルキー。解釈できなければ null
 */
export function toChannel(version: string): string | null {
  const matched = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(version.trim());
  if (!matched) return null;
  return `${matched[1]}.${matched[2]}`;
}

/**
 * 複数のMCバージョンをチャネルキーの集合へ丸めます（重複と解釈不能を除去）。
 * @param versions 生のMCバージョン文字列の配列
 */
export function toChannels(versions: readonly string[]): string[] {
  const out = new Set<string>();
  for (const v of versions) {
    const channel = toChannel(v);
    if (channel) out.add(channel);
  }
  return [...out].sort(compareChannels);
}

/**
 * チャネルキーとして妥当かを判定します。
 * @param value 判定対象
 */
export function isChannel(value: string): boolean {
  return CHANNEL_RE.test(value);
}

/**
 * チャネルキーを数値として比較します（`1.9` < `1.21` を正しく扱うため）。
 * @param a 比較対象
 * @param b 比較対象
 * @returns a が古ければ負
 */
export function compareChannels(a: string, b: string): number {
  const [aMajor, aMinor] = a.split('.').map(Number);
  const [bMajor, bMinor] = b.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor;
}

/**
 * 要求されたチャネルを、実際に存在するチャネルへ解決します。
 *
 * 完全一致が無ければ**直下（それ以下で最も新しい）**へ落とします。mod が 1.20 までしか
 * 対応していない状態で 1.21 を要求されたとき、何も出さないより 1.20 を出す方が実用的なためです。
 * 要求より新しい方へは上げません（未対応版のレシピを出してしまうため）。
 * @param wanted 要求チャネル（未指定なら null）
 * @param available 存在するチャネルの一覧
 * @returns 解決されたチャネル。候補が無ければ null
 */
export function resolveChannel(wanted: string | null, available: readonly string[]): string | null {
  if (available.length === 0) return null;

  const sorted = [...available].sort(compareChannels);
  if (!wanted) return sorted[sorted.length - 1];
  if (sorted.includes(wanted)) return wanted;

  const older = sorted.filter((c) => compareChannels(c, wanted) < 0);
  return older.length > 0 ? older[older.length - 1] : null;
}
