-- build 版管理と外部 jar 受け入れのための所有権・認証テーブル。
-- 追加のみで、既存のテーブルには一切触れない。

-- ---- 所有権と認証 ----
-- namespace の書き込み権限を「共有シークレット1本」から所有権ベースへ移すためのテーブル群。
-- 所有権はプロバイダ非依存の identities.id に紐付ける。ModParks 連携を後から外しても
-- 所有権が失われないようにするため。

CREATE TABLE IF NOT EXISTS identities (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- access_token はプロバイダ側のアクセストークン。所有 ns の照会は「本人のトークンで本人を引く」
-- 形にしているため、ログイン時に受け取ったものを所有権の主張時まで持ち越す。失効していれば
-- 照会が失敗し、unverified として扱われるだけで害はない。
CREATE TABLE IF NOT EXISTS identity_links (
  provider     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  identity_id  TEXT NOT NULL REFERENCES identities(id),
  access_token TEXT,
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
