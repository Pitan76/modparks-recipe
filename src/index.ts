import { Hono } from 'hono';
import { Env, getRecipe, getRecipesByResultItem } from './utils/minecraft';
import { renderRecipePng, renderRecipeGif } from './utils/image-generator';

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => {
  return c.text('ModParks Recipe API');
});

// Single recipe endpoint
app.get('/recipe/:namespace/:id.png', async (c) => {
  const { namespace, id } = c.req.param();
  const tagOffset = parseInt(c.req.query('tagOffset') || '0', 10);
  
  const recipeId = `${namespace}:${id}`;
  const recipeData = await getRecipe(recipeId, c.env);
  
  if (!recipeData) {
    return c.text('Recipe not found', 404);
  }

  const pngBuffer = await renderRecipePng(recipeData, c.env, tagOffset);
  
  return new Response(pngBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

app.get('/recipe/:namespace/:id.gif', async (c) => {
  const { namespace, id } = c.req.param();
  
  const recipeId = `${namespace}:${id}`;
  const recipeData = await getRecipe(recipeId, c.env);
  
  if (!recipeData) {
    return c.text('Recipe not found', 404);
  }

  const gifBuffer = await renderRecipeGif(recipeData, c.env, 5); // 5 frames
  
  return new Response(gifBuffer, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

export default app;
