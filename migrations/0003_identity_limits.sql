-- identity ごとの上限の上書き。追加のみで、既存のテーブルには触れない。
--
-- 既定値は全員に同じ数を当てるため、依存 mod を含む jar を投げる人（1本で複数の namespace を
-- 持ち込む）と、1本ずつ投げる人の差を吸収できない。行が無ければ既定値を使うので、
-- 例外を認めた identity だけがここに載る。
--
-- 値の -1 は無制限を表す。0 は「1回も許さない」という別の意味になるため、
-- 無制限を 0 で表してはならない。

CREATE TABLE IF NOT EXISTS identity_limits (
  identity_id  TEXT PRIMARY KEY REFERENCES identities(id),
  ns_limit     INTEGER,
  daily_limit  INTEGER,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
