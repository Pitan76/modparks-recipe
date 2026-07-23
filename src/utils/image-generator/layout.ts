/**
 * @fileoverview レシピ画像のレイアウト定数と純粋な描画ヘルパー。
 *
 * ここには minecraft データ取得や wasm 初期化への依存を一切含めません。
 * これにより、ローカルのプレビュー/検証スクリプトが本番と同一の座標・同一の `iconSvg` を、
 * 重い依存（R2 / wasm）を引き込まずに再利用できます。
 */

export const CANVAS_W = 236;
export const CANVAS_H = 112;

// public/crafting_3x3.png: ネイティブ解像度 118x56 のクラフトUI（スロットと矢印）をここでは2倍で描画します。
// スロットの境界や矢印のギザギザした輪郭は背景画像由来なので、コード内で枠線を再描画する処理は行いません。
export const BACKGROUND = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHYAAAA4CAYAAAAo9QwNAAAACXBIWXMAAFxGAABcRgEUlENBAAABk0lEQVR4nO3bUY6DIBSF4cOEVekyZCW6LpYhcVf0YeJjYwqI18P5kkn6MLlp8tdKC3X7vmeQcs49/RQe4wFgXdfqQcuyIMZoZk4IAfM8V895K38+CCFUDdq2DTFGU3OO46ia8WZ/Tz8BuYfCklJYUgpLSmFJKSwphSWlsKQUlpTCklJYUv76X6SFnPttojnnFLanFrtoV85dLYXtrHbX6sq5q6V7LCkP/G9ub9tWPczanJF5AIgxVp9aOE8+WJlzxwmKcwH0hiM3OkHxo5QSpmkyH1f32AIppa4fX0oobCHrcRW2guW4ClvJatwhw+aci/6+sRh32G+eUkrN51laLQ95xd6l9YulhsI2ZOknJUO+FTvniiLknL9elZaiArpim7AWFVDYahajAgpbxWpUQGGLWY4KKGwR61EBhf1J6Wr6CTpBQUonKEjpBAUp3WNJDfmV4lNCCN3WDgrbybmi7nV70FsxKYUlpbCkFJaUwpJSWFIKS0phSSksKYUlpbCkFJaUB9rtOlibMzKXUrL1MzFp4gNTwNqKklCKbAAAAABJRU5ErkJggg==';

export const ICON = 32;

/** 最初のスロットの内部の左上座標、およびスロット間のピッチ（間隔）。 */
export const GRID_X = 4;
export const GRID_Y = 4;
export const SLOT = 36;

/*
 * 出力スロットは入力スロットと同じサイズ（内側 16px 相当 = ICON がぴったり充填）。
 * 入力スロットと完全に同一機構で、アイテム描画開始 = スロット内側の左上原点。
 * 原点 = ネイティブ(96,20) = 2倍(192,40)。余白が無いので位置ズレは原理的に起きない。
 */
export const OUT_X = 192;
export const OUT_Y = 40;

/**
 * 指定された座標にアイコンを配置するためのSVGイメージ要素を生成します。
 * @param href アイコン画像のデータURLまたはURL
 * @param x X座標
 * @param y Y座標
 * @returns SVGイメージ要素文字列
 */
export function iconSvg(href: string, x: number, y: number): string {
  return `<image href="${href}" x="${x}" y="${y}" width="${ICON}" height="${ICON}"`
    + ` image-rendering="optimizeSpeed" preserveAspectRatio="xMidYMid meet"/>`;
}

/**
 * Minecraft デフォルトフォント（ascii.png）の数字 0-9 のビットマップ。
 * 各グリフは 5px 幅 × 7px 高。'#' が塗りピクセル。バニラのスタック数表示に使われる書体そのもの。
 */
const GLYPH_W = 5;
const GLYPH_H = 7;
const DIGIT_GLYPHS: Record<string, string[]> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
};

/** バニラのドロップシャドウ色（白テキストの場合 = white * 0.25）。 */
const SHADOW_COLOR = '#3f3f3f';
const TEXT_COLOR = '#ffffff';

/**
 * スタック数をマインクラフト風にスロット右下へ描画する SVG を生成します。
 * 公式フォントのビットマップを矩形パスで再現し、1pxオフセットのドロップシャドウ付き。
 * @param text 表示する数値文字列（例: "16"）
 * @param rightX 描画領域の右端 X 座標
 * @param bottomY 描画領域の下端 Y 座標
 * @param px 1フォントピクセルあたりの描画サイズ（ネイティブ→SVG座標の倍率）
 */
export function countSvg(text: string, rightX: number, bottomY: number, px: number): string {
  const digits = text.split('');
  const totalW = (digits.length * GLYPH_W + (digits.length - 1)) * px;
  const startX = rightX - totalW;
  const startY = bottomY - GLYPH_H * px;

  const fill: string[] = [];
  const shadow: string[] = [];
  let cx = startX;
  for (const ch of digits) {
    const glyph = DIGIT_GLYPHS[ch];
    if (glyph) {
      for (let r = 0; r < GLYPH_H; r++) {
        for (let c = 0; c < GLYPH_W; c++) {
          if (glyph[r][c] === '#') {
            const rx = cx + c * px;
            const ry = startY + r * px;
            fill.push(`M${rx} ${ry}h${px}v${px}h${-px}z`);
            // シャドウは 1ネイティブpx（= px）右下へオフセット
            shadow.push(`M${rx + px} ${ry + px}h${px}v${px}h${-px}z`);
          }
        }
      }
    }
    cx += (GLYPH_W + 1) * px;
  }

  return `<path d="${shadow.join('')}" fill="${SHADOW_COLOR}"/>`
    + `<path d="${fill.join('')}" fill="${TEXT_COLOR}"/>`;
}
