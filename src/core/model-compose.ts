/**
 * @fileoverview 複数のモデルを1つに畳む処理。
 *
 * ベッドのように、アイテムの見た目が複数のブロックモデルの重ね合わせで定義されることがあります。
 * 描画側は1つのモデルしか扱えないため、ここで結合します。
 *
 * テクスチャの参照名（`#north` など）はモデルごとに意味が違うので、そのまま混ぜると衝突します。
 * モデル単位で接頭辞を付けて分離します。
 */

/** 畳む対象。解決済みのモデルと、置く位置のずらし幅（ピクセル）。 */
export type ModelPart = { model: any; translation: number[] };

/**
 * 複数のモデルを1つのモデルに畳みます。
 * @param parts 解決済みのモデルと、ずらし幅
 * @returns 畳んだモデル。中身が無ければ null
 */
export function composeModels(parts: ModelPart[]): any | null {
  const textures: Record<string, string> = {};
  const elements: any[] = [];
  // 見せる向きはモデル自身が持ちます。ベッドは通常のブロック（Y=225）と違う角度（Y=340）で、
  // 捨てると前後が逆さに見えます。引き継ぐのは向きだけです。縮尺や位置ずらしはアイコンの枠を
  // 前提にした値で、こちらは 16³ を基準にした固定フレームなので、重ねると小さく寄って描かれます。
  let rotation: number[] | undefined = undefined;

  parts.forEach(({ model, translation }, index) => {
    if (!model?.elements) return;
    const prefix = `c${index}_`;

    for (const [key, value] of Object.entries(model.textures ?? {})) {
      textures[prefix + key] = rename(String(value), prefix);
    }
    if (!rotation && Array.isArray(model.display?.gui?.rotation)) rotation = model.display.gui.rotation;
    for (const element of model.elements) elements.push(moveElement(element, translation, prefix));
  });

  if (elements.length === 0) return null;
  return { textures, elements, ...(rotation ? { display: { gui: { rotation } } } : {}) };
}

/**
 * テクスチャ参照に接頭辞を付けます。参照でない値（実パス）はそのまま返します。
 * @param value テクスチャの値
 * @param prefix 接頭辞
 */
function rename(value: string, prefix: string): string {
  return value.startsWith('#') ? `#${prefix}${value.slice(1)}` : value;
}

/**
 * エレメントを平行移動し、テクスチャ参照に接頭辞を付けます。
 * @param element 元のエレメント
 * @param translation ずらし幅（ピクセル）
 * @param prefix 接頭辞
 */
function moveElement(element: any, translation: number[], prefix: string): any {
  const faces: any = {};
  for (const [dir, face] of Object.entries(element.faces ?? {})) {
    const texture = (face as any).texture;
    faces[dir] = { ...(face as any), texture: typeof texture === 'string' ? rename(texture, prefix) : texture };
  }

  const moved: any = {
    ...element,
    from: shift(element.from, translation),
    to: shift(element.to, translation),
    faces,
  };
  // 回転の中心も一緒に動かさないと、ずらした先で違う軸を中心に回ってしまいます。
  if (element.rotation?.origin) {
    moved.rotation = { ...element.rotation, origin: shift(element.rotation.origin, translation) };
  }
  return moved;
}

/**
 * 座標をずらします。
 * @param point 元の座標
 * @param translation ずらし幅
 */
function shift(point: any, translation: number[]): number[] {
  if (!Array.isArray(point)) return point;
  return point.map((v: number, i: number) => v + (translation[i] ?? 0));
}
