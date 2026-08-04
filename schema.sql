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

-- ---- 所有権と認証 ----
-- namespace の書き込み権限を「共有シークレット1本」から所有権ベースへ移すためのテーブル群。
-- 所有権はプロバイダ非依存の identities.id に紐付ける。ModParks 連携を後から外しても
-- 所有権が失われないようにするため。

CREATE TABLE IF NOT EXISTS identities (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS identity_links (
  provider    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  identity_id TEXT NOT NULL REFERENCES identities(id),
  PRIMARY KEY (provider, subject)
);

CREATE INDEX IF NOT EXISTS idx_identity_links_identity ON identity_links(identity_id);

CREATE TABLE IF NOT EXISTS namespaces (
  ns         TEXT PRIMARY KEY,
  trust      TEXT NOT NULL DEFAULT 'unverified',
  owner_id   TEXT NOT NULL REFERENCES identities(id),
  claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_namespaces_owner ON namespaces(owner_id);

-- 生のトークンは保存しない（漏洩時に総当たりの的にしないため）。
CREATE TABLE IF NOT EXISTS tokens (
  hash        TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES identities(id),
  scope       TEXT NOT NULL,
  expires_at  TIMESTAMP,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tokens_identity ON tokens(identity_id);

-- レート制限の日次カウンタ。identity ごとに1日あたりの jar 投入数を数える。
CREATE TABLE IF NOT EXISTS upload_quota (
  identity_id TEXT NOT NULL REFERENCES identities(id),
  day         TEXT NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (identity_id, day)
);
