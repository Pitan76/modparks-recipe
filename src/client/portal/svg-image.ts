/**
 * @fileoverview 組み立てた SVG を、ブラウザで表示・書き出しできる画像として扱うための変換。
 *
 * 描画が返すのは SVG 文字列です。そのままでは `<img>` にも canvas にも渡せず、ドット絵として
 * 出すための指定もサーバ向けのままです。ここが表示側の都合を引き受けます。
 */

/**
 * ドット絵が滲まないよう、拡大時の補間を切る指定を差し込みます。
 *
 * SVG が持つのは `image-rendering="optimizeSpeed"` です。SVG 1.1 の値で、ブラウザによっては
 * 補間されます。サーバー側のラスタライザはこの値で正しく動くため書き換えず、ブラウザへ渡すときだけ
 * 現行の指定を上から足します。
 * @param svg SVG文字列
 */
function pixelated(svg: string): string {
  const close = svg.indexOf('>');
  if (close < 0) return svg;
  return `${svg.slice(0, close + 1)}<style>image{image-rendering:pixelated}</style>${svg.slice(close + 1)}`;
}

/**
 * SVG文字列をデータURLにします。
 * @param svg SVG文字列
 */
export function svgDataUrl(svg: string): string {
  svg = pixelated(svg);
  // 日本語などの非ASCIIが混じっても壊れないように、UTF-8として符号化してから base64 にします。
  const utf8 = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of utf8) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/**
 * SVGをPNGのデータURLに変換します。
 *
 * アイコンはすべてSVGの中にデータURLとして埋まっているため、外部参照が無く canvas が汚れません。
 * @param svg SVG文字列
 * @param scale 拡大率
 */
export async function svgToPngDataUrl(svg: string, scale: number): Promise<string | null> {
  const image = new Image();
  image.src = svgDataUrl(svg);
  await image.decode().catch(() => undefined);
  if (!image.width) return null;

  const canvas = document.createElement('canvas');
  canvas.width = image.width * scale;
  canvas.height = image.height * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // ドット絵なので、拡大時に補間させません。
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/**
 * URLの中身をバイト列で読みます。
 * @param url 取得先
 * @returns 取れなければ null
 */
export async function fetchBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}
