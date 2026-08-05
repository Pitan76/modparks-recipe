-- 誰が何を投入したかの履歴。追加のみで、既存のテーブルには触れない。
--
-- 所有権テーブルは「今の持ち主」しか持たないため、乗っ取りや放棄のあとでは
-- 問題のあるデータを入れた主体が辿れなくなる。投入のたびに1行残して追跡できるようにする。
-- identity_id は共有シークレット経由（ModParks 側の取り込み）では NULL になる。

CREATE TABLE IF NOT EXISTS upload_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_id TEXT REFERENCES identities(id),
  ns          TEXT NOT NULL,
  source      TEXT NOT NULL,
  items       INTEGER NOT NULL DEFAULT 0,
  build_id    TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upload_events_ns ON upload_events(ns, id);
CREATE INDEX IF NOT EXISTS idx_upload_events_identity ON upload_events(identity_id, id);
