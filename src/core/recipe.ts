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
 * レシピタイプがクラフト関連（shaped または shapeless）であるかどうかを判定します。
 * @param type レシピのタイプ
 */
export function isCraftingType(type: unknown): boolean {
  if (typeof type !== 'string') return false;
  const t = type.replace(/^minecraft:/, '');
  return t === 'crafting_shaped' || t === 'crafting_shapeless';
}
