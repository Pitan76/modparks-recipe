/**
 * @fileoverview 検索ページの状態。索引の読み込み・表示名の解決・URL同期をまとめます。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchIndex, fetchNameIndex, fetchNames, splitId, type Assets, type Names, type RecipeEntry, type Versions } from './api';

/** 検索時に表示名を引きに行く上限件数。 */
const SEARCH_NAME_LIMIT = 3000;

/** 初期表示のURLパラメータ。同期処理が書き換える前の値を読む必要があります。 */
export const INITIAL_PARAMS = new URLSearchParams(window.location.search);

/**
 * URLのクエリを書き換えます。空になったら `?` ごと落とします。
 * @param mutate クエリを変更する処理
 */
export function replaceQuery(mutate: (params: URLSearchParams) => void): void {
  const params = new URLSearchParams(window.location.search);
  mutate(params);
  const qs = params.toString();
  const next = window.location.pathname + (qs ? `?${qs}` : '');
  if (next === window.location.pathname + window.location.search) return;
  window.history.replaceState(null, '', next);
}

/** 索引の読み込み結果。`recipes` が null の間は読み込み中です。 */
export type IndexState = { recipes: RecipeEntry[] | null; versions: Versions | null; assets: Assets | null };

/** レシピ索引を1回だけ読み込みます。 */
export function useRecipeIndex(): IndexState {
  const [state, setState] = useState<IndexState>({ recipes: null, versions: null, assets: null });

  useEffect(() => {
    fetchIndex()
      .then((index) => setState({ recipes: index.recipes, versions: index.versions, assets: index.assets }))
      .catch(() => setState({ recipes: [], versions: null, assets: null }));
  }, []);

  return state;
}

/** 完成品アイテムごとにレシピIDをまとめた表。 */
export type Groups = Record<string, string[]>;

/**
 * レシピを完成品アイテムでまとめます。複数レシピを持つアイテムは同時に表示するためです。
 * @param recipes 索引のレシピ一覧
 */
export function useGroups(recipes: RecipeEntry[] | null): Groups {
  return useMemo(() => {
    const groups: Groups = {};
    (recipes ?? []).forEach((r) => {
      const key = r.result || r.id;
      (groups[key] = groups[key] ?? []).push(r.id);
    });
    return groups;
  }, [recipes]);
}

/**
 * アイテムが属する Mod。完成品ではなくレシピ側のネームスペースを見ます。
 *
 * Mod がバニラのアイテムを作るレシピを足すことがあり（`astralenchant` のエンチャント本など）、
 * 完成品で数えるとその Mod の一覧から消えてしまいます。1つのアイテムが複数の Mod から
 * 作られることもあるため、返すのは集合です。
 * @param groups 完成品ごとのレシピID一覧
 * @param item 完成品アイテムID
 */
export function namespacesOf(groups: Groups, item: string): string[] {
  return Array.from(new Set((groups[item] ?? []).map((rid) => splitId(rid).ns)));
}

/**
 * Mod ごとのアイテム件数。どの Mod にどれだけあるかを選ぶ前に知りたいので、選択肢に添えます。
 *
 * 複数の Mod にレシピを持つアイテムは、そのどちらでも数えます。選んだ Mod で表示される件数と
 * 揃えるためで、合計が `all` を上回ることがあります。
 * @param groups 完成品ごとのレシピID一覧
 * @param items アイテムID一覧
 */
export function useNamespaceCounts(groups: Groups, items: string[]): Record<string, number> {
  return useMemo(() => {
    const counts: Record<string, number> = { all: items.length };
    items.forEach((item) => {
      const nss = namespacesOf(groups, item);
      nss.forEach((ns) => {
        counts[ns] = (counts[ns] ?? 0) + 1;
      });
    });
    return counts;
  }, [groups, items]);
}

/** 表示名の解決結果。 */
export type NameState = { names: Names; request: (ids: string[]) => void };

/**
 * 表示名を解決します。
 *
 * 起動時に静的索引を丸ごと読み、そこから漏れたIDだけを都度引きます。
 * 一度要求したIDは覚えておき、二度と引きません。
 * @param locale Minecraftのロケール名
 */
export function useNames(locale: string): NameState {
  const [names, setNames] = useState<Names>({});
  const requested = useRef<Set<string>>(new Set());

  const merge = useCallback((loaded: Names) => {
    setNames((prev) => ({ ...prev, ...loaded }));
  }, []);

  useEffect(() => {
    fetchNameIndex(locale)
      .then((loaded) => {
        Object.keys(loaded).forEach((id) => requested.current.add(id));
        setNames((prev) => ({ ...loaded, ...prev }));
      })
      .catch(() => undefined);
  }, [locale]);

  const request = useCallback(
    (ids: string[]) => {
      const missing = ids.filter((id) => id.includes(':') && !requested.current.has(id));
      if (missing.length === 0) return;
      missing.forEach((id) => requested.current.add(id));
      fetchNames(missing, locale, merge).catch(() => undefined);
    },
    [locale, merge]
  );

  return { names, request };
}

/**
 * 表示中のアイテムと、検索時の対象範囲について表示名を取りに行きます。
 * @param ready 索引が読み込み済みか
 * @param visibleItems 画面に出ているアイテム
 * @param searchScope 検索の対象範囲（Mod で絞った全件）
 * @param hasQuery 検索語が入っているか
 * @param request 表示名の要求
 */
export function useNameRequests(
  ready: boolean,
  visibleItems: string[],
  searchScope: string[],
  hasQuery: boolean,
  request: (ids: string[]) => void
): void {
  useEffect(() => {
    if (ready) request(visibleItems);
  }, [ready, visibleItems, request]);

  // 名前で検索するには表示中のページに無いアイテムの名前も要る。
  // 常に全件引くと重いので、検索語が入ったときだけ範囲を埋める。
  useEffect(() => {
    if (ready && hasQuery) request(searchScope.slice(0, SEARCH_NAME_LIMIT));
  }, [ready, hasQuery, searchScope, request]);
}
