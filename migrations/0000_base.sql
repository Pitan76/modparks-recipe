-- 既存の稼働環境に合わせた土台。レシピとタグのキャッシュ表。
-- 本番には既に存在するため IF NOT EXISTS で何もしない。新規環境ではここから作られる。

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  result_item TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recipes_result_item ON recipes(result_item);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
