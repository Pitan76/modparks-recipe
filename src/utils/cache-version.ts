/**
 * @fileoverview ネームスペースごとのアセットバージョン管理。レンダリングされた画像のキャッシュを無効化するために使用されます。
 *
 * 書き込み時に個々のキャッシュエントリを削除することは困難です。1つのテクスチャアップロードが数十個のレシピ画像に影響を与える可能性があり、
 * 各画像にはクエリバリアント（`?scale=`, `?tagOffset=` など）ごとにキャッシュエントリが存在するためです。
 * 代わりに、バージョン番号をキャッシュキーに組み込みます。
 * バージョンを上げることで、古いエントリが一斉にアクセス不能（無効化）になり、時間が経てば自動的に消去されます。
 *
 * 全ネームスペースを1つのオブジェクトに集約しているのは、`/api/list.json` が全バージョンをクライアントへ
 * 配るためです。クライアントが画像URLに `?v=` を載せてくれれば、画像配信側はバージョン参照のための
 * R2 往復（実測 約220ms、キャッシュヒット時のサーバ処理時間の6割）を完全に省略できます。
 */

import type { Env } from './minecraft';
import { updateJson } from './r2-json';

const KEY = 'meta/versions.json';

/** 読み取ったバージョンがアイソレート内で信頼される期間（ミリ秒単位）。 */
const MEMO_TTL = 10_000;

export type VersionMap = Record<string, string>;

let memo: { value: VersionMap; readAt: number } | null = null;

/**
 * 集約バージョンオブジェクトを読み取ります。
 *
 * 更新側は `updateJson` が必ず実体を読み直すため、ここは常にメモを使って構いません。
 * @param env 環境変数
 * @returns ネームスペース -> バージョン のマップ
 */
async function readVersions(env: Env): Promise<VersionMap> {
  if (memo && Date.now() - memo.readAt < MEMO_TTL) return memo.value;

  const obj = await env.BUCKET.get(KEY);
  let value: VersionMap = {};
  if (obj) {
    try {
      const parsed = await obj.json<VersionMap>();
      if (parsed && typeof parsed === 'object') value = parsed;
    } catch {
      // 壊れていれば空として扱う。次回の bump で作り直される。
    }
  }
  memo = { value, readAt: Date.now() };
  return value;
}

/**
 * 全ネームスペースのバージョンを取得します（`/api/list.json` がクライアントへ配るため）。
 * @param env 環境変数
 * @returns ネームスペース -> バージョン のマップ
 */
export async function getAllVersions(env: Env): Promise<VersionMap> {
  return readVersions(env);
}

/**
 * 特定のネームスペースの現在のバージョンを取得します（一度も書き込まれていない場合は '0'）。
 * クライアントが `?v=` を送ってこなかった場合のフォールバック経路でのみ使用します。
 * @param env 環境変数
 * @param ns ネームスペース
 * @returns バージョン文字列
 */
export async function getAssetVersion(env: Env, ns: string): Promise<string> {
  const versions = await readVersions(env);
  return versions[ns] || '0';
}

/**
 * ネームスペースのアセットが変更されたことをマーク（バージョンを更新）します。
 * レンダリングされた画像に影響を与える可能性のある書き込み（レシピ、テクスチャ、モデル、タグなど）が行われた後に呼び出します。
 * MEMO_TTL 以内にすべてのクライアントに適用されます。
 * @param env 環境変数
 * @param ns ネームスペース
 */
export async function bumpAssetVersion(env: Env, ns: string): Promise<void> {
  await mutateVersions(env, (versions) => ({ ...versions, [ns]: nextVersion(versions[ns]) }));
}

/**
 * 次のバージョン値を作ります。
 *
 * 単なる現在時刻だと、同じミリ秒に2回上げたときに値が変わらず、`immutable` で1年キャッシュ
 * された画像が更新されません。前の値以下になりそうなら1つ進めて、必ず変化させます。
 * @param previous 現在のバージョン（未設定なら undefined）
 */
function nextVersion(previous: string | undefined): string {
  const now = Date.now();
  const prev = previous ? parseInt(previous, 36) : 0;
  if (!Number.isFinite(prev) || prev < now) return now.toString(36);
  return (prev + 1).toString(36);
}

/**
 * まだバージョンを持たないネームスペースに初期値を与えます。
 * バージョンが無いネームスペースはクライアントが `?v=` を付けられず、画像1枚ごとに
 * サーバ側でのバージョン参照が発生し続けるため、`/admin/reindex` から一度呼んで解消します。
 * @param env 環境変数
 * @param namespaces 対象のネームスペース一覧
 * @returns 新たに初期化されたネームスペースの数
 */
export async function ensureAssetVersions(env: Env, namespaces: Iterable<string>): Promise<number> {
  const wanted = [...namespaces];

  let added = 0;
  await mutateVersions(env, (versions) => {
    added = 0;
    const next = { ...versions };
    for (const ns of wanted) {
      if (next[ns]) continue;
      next[ns] = nextVersion(undefined);
      added++;
    }
    return next;
  });
  return added;
}

/**
 * バージョンマップを read-modify-write で更新し、アイソレート内のメモも更新します。
 *
 * 更新は条件付き書き込みで行うため、他ネームスペースの同時更新を上書きで消しません。
 * 失敗は握りつぶさず呼び出し元へ伝えます。書き込めなかったのにメモだけ進めると、
 * このアイソレートだけが存在しないバージョンを配り、そのバージョンで L1 キャッシュが
 * 書かれて誰からも参照されない孤児オブジェクトになるためです。
 * 書き込みAPIは冪等なので、呼び出し元はそのまま失敗させて再送させて構いません。
 * @param env 環境変数
 * @param mutate 現在のバージョンマップから新しいマップを作る関数
 */
async function mutateVersions(env: Env, mutate: (versions: VersionMap) => VersionMap): Promise<void> {
  const written = await updateJson<VersionMap>(env, KEY, (current) => {
    const versions = current && typeof current === 'object' ? current : {};
    return mutate(versions);
  });
  memo = { value: written, readAt: Date.now() };
}
