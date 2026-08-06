/**
 * @fileoverview レシピJSONを読むための純粋関数。
 *
 * Worker と Node のパイプラインスクリプトの両方から使われます。`utils/minecraft.ts`
 * は R2 バインディングや WASM レンダラーを引き込むため Node からは import できません。
 * ここに置くことで、スクリプト側が Worker 専用の依存を巻き込まずに済みます。
 */

/**
 * レシピデータから完成品アイテムのIDを抽出します。
 * @param data レシピJSONオブジェクト
 * @returns 完全修飾されたアイテムID（例: "minecraft:apple"）、取得できない場合は null
 */
export function resultItemOf(data: any): string | null {
  const r = data?.result;
  if (!r) return null;
  const id = typeof r === 'string' ? r : (r.id || r.item || null);
  if (!id || typeof id !== 'string') return null;
  return id.includes(':') ? id : `minecraft:${id}`;
}

/**
 * 素材がタグ参照を含むかどうかを判定します。
 *
 * `resolveIngredient` が受け付ける形（文字列・配列・`{tag}`・`{id}`）に合わせています。
 * @param ingredient レシピの素材1つ
 */
function isTagIngredient(ingredient: any): boolean {
  if (!ingredient) return false;
  if (typeof ingredient === 'string') return ingredient.startsWith('#');
  if (Array.isArray(ingredient)) return ingredient.some(isTagIngredient);
  if (typeof ingredient.tag === 'string') return true;
  if (ingredient.items !== undefined) return isTagIngredient(ingredient.items);
  return typeof ingredient.id === 'string' && ingredient.id.startsWith('#');
}

/**
 * レシピがタグ由来の素材を持つか、つまり素材が切り替わりうるかを判定します。
 *
 * タグの中身までは見ません。構成アイテムが1つだけのタグもありますが、それを見分けるには
 * タグ本体の読み出しが要る一方、取り込みではレシピがタグより先に書かれるため当てになりません。
 * 静止画になる場合も描画側が同一フレームで打ち切るので、ここは静的な判定に留めます。
 * @param data レシピJSONオブジェクト
 */
export function hasTagIngredient(data: any): boolean {
  const shapeless = Array.isArray(data?.ingredients) ? data.ingredients : [];
  const shaped = data?.key && typeof data.key === 'object' ? Object.values(data.key) : [];
  return [...shapeless, ...shaped].some(isTagIngredient);
}

/**
 * レシピタイプがクラフト関連（shaped または shapeless）であるかどうかを判定します。
 * @param type レシピのタイプ
 */
export function isCraftingType(type: unknown): boolean {
  if (typeof type !== 'string') return false;
  const t = type.replace(/^minecraft:/, '');
  return t === 'crafting_shaped' || t === 'crafting_shapeless';
}
