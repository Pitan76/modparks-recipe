/**
 * @fileoverview 新しいアイテムモデル定義（`assets/<ns>/items/<name>.json`）の解釈。
 *
 * 以前は `models/item/<name>.json` がアイテムの見た目の起点でしたが、現在のバニラは `items/` に
 * 定義を置き、そこから描き方を指示します。単純にモデルを指すものだけでなく、複数モデルの合成
 * （ベッド）や専用描画（チェスト）、条件による差し替え（クリスマスのチェスト）もあります。
 *
 * ここでは描画に必要な形だけを取り出します。条件分岐は既定（`fallback`）を採り、日付や状態では
 * 切り替えません。レシピの絵は特定の瞬間ではなく、そのアイテムの標準的な姿を示すためです。
 */

/** 定義から取り出した描き方。 */
export type ItemVisual =
  /** 1つのモデルをそのまま描く */
  | { kind: 'model'; id: string }
  /** 複数のモデルを位置をずらして重ねる */
  | { kind: 'composite'; parts: { id: string; translation: number[] }[] }
  /** 専用描画。エンティティのテクスチャから組み立てます */
  | { kind: 'special'; special: string; texture: string | null; variant: string | null };

/** ブロック1つ分のピクセル数。合成時のずらし幅の単位です。 */
const BLOCK_PIXELS = 16;

/**
 * 定義JSONから描き方を取り出します。
 * @param definition `items/<name>.json` の中身
 * @returns 解釈できなければ null
 */
export function readItemVisual(definition: any): ItemVisual | null {
  return fromModelNode(definition?.model);
}

/**
 * 定義の `model` ノードを読み解きます。入れ子になるため再帰します。
 * @param node `model` ノード
 */
function fromModelNode(node: any): ItemVisual | null {
  if (!node || typeof node !== 'object') return null;

  const type = String(node.type ?? '').replace(/^minecraft:/, '');
  if (type === 'model') return typeof node.model === 'string' ? { kind: 'model', id: node.model } : null;
  if (type === 'composite') return fromComposite(node);
  if (type === 'special') return fromSpecial(node);
  // 条件つきの差し替えは既定を採ります。`select` は日付や持ち方で切り替わるためです。
  if (type === 'select' || type === 'condition' || type === 'range_dispatch') {
    return fromModelNode(node.fallback ?? node.on_false);
  }
  return null;
}

/**
 * 合成（複数モデルの重ね合わせ）を読み解きます。
 * @param node `composite` ノード
 */
function fromComposite(node: any): ItemVisual | null {
  if (!Array.isArray(node.models)) return null;

  const parts: { id: string; translation: number[] }[] = [];
  for (const child of node.models) {
    const inner = fromModelNode(child);
    // 合成の中の合成や専用描画は扱いません。素直にモデルを指すものだけを重ねます。
    if (inner?.kind !== 'model') continue;
    parts.push({ id: inner.id, translation: translationOf(child) });
  }
  return parts.length > 0 ? { kind: 'composite', parts } : null;
}

/**
 * 専用描画を読み解きます。
 * @param node `special` ノード
 */
function fromSpecial(node: any): ItemVisual | null {
  const special = String(node.model?.type ?? '').replace(/^minecraft:/, '');
  if (!special) return null;

  const texture = typeof node.model.texture === 'string'
    ? node.model.texture.replace(/^minecraft:/, '')
    : null;
  // 頭部は `kind`（`skeleton` など）で種類が決まります。名前の一覧を持たずに済みます。
  const variant = typeof node.model.kind === 'string' ? node.model.kind : null;
  return { kind: 'special', special, texture, variant };
}

/**
 * 合成時のずらし幅をモデル座標で返します。
 *
 * 定義はブロック単位なので 1ブロック=16 に直します。軸はそのままです。パーツの形自体がその軸に
 * 沿って作られているため、ずらす向きだけ変えると噛み合わなくなります。見え方の向きは
 * 合成後のモデルをまとめて回して整えます。
 * @param child 合成の子ノード
 */
function translationOf(child: any): number[] {
  const raw = child?.transformation?.translation;
  if (!Array.isArray(raw) || raw.length < 3) return [0, 0, 0];

  return raw.slice(0, 3).map((v: any) => (Number(v) || 0) * BLOCK_PIXELS);
}
