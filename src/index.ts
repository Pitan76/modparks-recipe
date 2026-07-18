import { Hono } from 'hono';
import { Env, getRecipe, getRecipesByResultItem } from './utils/minecraft';
import { renderRecipePng, renderRecipeGif } from './utils/image-generator';

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => {
  return c.text('ModParks Recipe API');
});

// Single recipe endpoint
app.get('/recipe/:namespace/:filename', async (c) => {
  const { namespace, filename } = c.req.param();
  
  if (!filename.endsWith('.png') && !filename.endsWith('.gif')) {
    return c.text('Not found', 404);
  }

  const id = filename.replace(/\.(png|gif)$/, '');
  const tagOffset = parseInt(c.req.query('tagOffset') || '0', 10);
  
  const recipeId = `${namespace}:${id}`;
  const recipeData = await getRecipe(recipeId, c.env);
  
  if (!recipeData) {
    return c.text('Recipe not found', 404);
  }

  if (filename.endsWith('.png')) {
    const pngBuffer = await renderRecipePng(recipeData, c.env, tagOffset);
    return new Response(pngBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } else {
    const gifBuffer = await renderRecipeGif(recipeData, c.env, 5); // 5 frames
    return new Response(gifBuffer, {
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }
});



export default app;
