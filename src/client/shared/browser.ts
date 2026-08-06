/**
 * @fileoverview ブラウザAPIの薄い包み。環境によって例外を投げるものだけを集めています。
 */

/**
 * localStorage から読みます。参照自体が投げる環境があるため、失敗は null に倒します。
 * @param key 保存キー
 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * localStorage へ書きます。書けなくても表示は続けます。
 * @param key 保存キー
 * @param value 保存する値
 */
export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できないだけで機能は損なわれない
  }
}

/**
 * localStorage から消します。
 * @param key 保存キー
 */
export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 消せなくても再読込で判定し直される
  }
}

/**
 * クリップボードへコピーします。
 *
 * clipboard API は HTTPS でしか生えず、権限も拒否されうるため、必ず退避経路を通します。
 * @param text コピーする文字列
 * @returns コピーできたかどうか
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 退避経路へ
  }
  return legacyCopy(text);
}

/**
 * `document.execCommand` によるコピー。clipboard API が使えない環境向けです。
 * @param text コピーする文字列
 * @returns コピーできたかどうか
 */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.readOnly = true;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

/**
 * ファイルをダウンロードさせます。
 * @param url 取得先
 * @param fileName 保存名
 */
export function downloadUrl(url: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
