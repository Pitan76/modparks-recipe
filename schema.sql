DROP TABLE IF EXISTS recipes;

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  modid TEXT NOT NULL,
  path TEXT NOT NULL,
  data TEXT NOT NULL,
  image_key TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_recipes_modid ON recipes(modid);
