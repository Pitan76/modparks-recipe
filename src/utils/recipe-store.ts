import { Env, resultItemOf, isCraftingType } from './minecraft';

/** Store a recipe JSON in R2, drop its stale D1 cache row, and update the index. */
export async function storeRecipe(env: Env, namespace: string, id: string, body: string, data: any): Promise<void> {
  await putRecipeBody(env, namespace, id, body);
  await updateIndex(env, `${namespace}:${id}`, data);
}

/** Write a recipe body to R2 and drop its stale D1 cache row, without touching the index. */
export async function putRecipeBody(env: Env, namespace: string, id: string, body: string): Promise<void> {
  await env.BUCKET.put(`data/${namespace}/recipe/${id}.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  });
  await env.DB.prepare('DELETE FROM recipes WHERE id = ?').bind(`${namespace}:${id}`).run().catch(() => {});
}

/** Upsert many recipes into index/recipes.json in a single read-modify-write. */
export async function updateIndexMany(env: Env, entries: { fullId: string; data: any }[]): Promise<void> {
  if (entries.length === 0) return;
  const obj = await env.BUCKET.get('index/recipes.json');
  const idx: any = obj ? await obj.json() : {};
  let recipes: any[] = Array.isArray(idx.recipes)
    ? idx.recipes
    : Array.isArray(idx.ids)
      ? idx.ids.map((i: string) => ({ id: i, result: i }))
      : [];
  const incoming = new Set(entries.map((e) => e.fullId));
  recipes = recipes.filter((r) => !incoming.has(r.id));
  for (const { fullId, data } of entries) {
    if (isCraftingType(data?.type)) {
      recipes.push({ id: fullId, result: resultItemOf(data), type: String(data.type).replace(/^minecraft:/, '') });
    }
  }
  recipes.sort((a, b) => a.id.localeCompare(b.id));
  await env.BUCKET.put(
    'index/recipes.json',
    JSON.stringify({ count: recipes.length, generatedAt: new Date().toISOString(), recipes }),
    { httpMetadata: { contentType: 'application/json' } }
  );
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
