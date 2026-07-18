DROP TABLE IF EXISTS recipes;
DROP TABLE IF EXISTS tags;

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  result_item TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_recipes_result_item ON recipes(result_item);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
