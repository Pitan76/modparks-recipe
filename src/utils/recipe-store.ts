import { Env, resultItemOf, isCraftingType } from './minecraft';

/** Store a recipe JSON in R2, drop its stale D1 cache row, and update the index. */
export async function storeRecipe(env: Env, namespace: string, id: string, body: string, data: any): Promise<void> {
  await env.BUCKET.put(`data/${namespace}/recipe/${id}.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  });
  await env.DB.prepare('DELETE FROM recipes WHERE id = ?').bind(`${namespace}:${id}`).run().catch(() => {});
  await updateIndex(env, `${namespace}:${id}`, data);
}

/** Upsert one recipe into index/recipes.json (kept crafting-only, like the CI build). */
export async function updateIndex(env: Env, fullId: string, data: any): Promise<void> {
  const obj = await env.BUCKET.get('index/recipes.json');
  const idx: any = obj ? await obj.json() : {};
  let recipes: any[] = Array.isArray(idx.recipes)
    ? idx.recipes
    : Array.isArray(idx.ids)
      ? idx.ids.map((i: string) => ({ id: i, result: i }))
      : [];
  recipes = recipes.filter((r) => r.id !== fullId);
  if (isCraftingType(data?.type)) {
    recipes.push({ id: fullId, result: resultItemOf(data), type: String(data.type).replace(/^minecraft:/, '') });
  }
  recipes.sort((a, b) => a.id.localeCompare(b.id));
  await env.BUCKET.put(
    'index/recipes.json',
    JSON.stringify({ count: recipes.length, generatedAt: new Date().toISOString(), recipes }),
    { httpMetadata: { contentType: 'application/json' } }
  );
}
