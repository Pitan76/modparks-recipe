/**
 * @fileoverview モデルの読み込み（親モデルとのマージ）およびテクスチャ参照の解決を行うモジュール。
 */

import { readJarJson } from './jar';

const modelCache = new Map<string, any>();

/**
 * 指定されたモデルIDからモデルデータを読み込み、親モデルのチェーンと再帰的にマージします。
 * @param modelId 対象モデル of ID
 * @returns マージされたモデルデータ、読み込めない場合は null
 */
export function loadModel(modelId: string): any {
    if (modelCache.has(modelId)) return modelCache.get(modelId);

    let name = modelId.replace('minecraft:', '');
    if (!name.endsWith('.json')) name += '.json';

    const model = readJarJson(`assets/minecraft/models/${name}`);
    if (!model) { modelCache.set(modelId, null); return null; }

    if (model.parent) {
        let parentId = model.parent;
        if (!parentId.startsWith('minecraft:') && !parentId.includes(':'))
            parentId = 'minecraft:' + parentId;

        // 組み込み（builtin/）の親モデルはマージをスキップします
        if (parentId.includes('builtin/')) {
            modelCache.set(modelId, model);
            return model;
        }

        const parent = loadModel(parentId);
        if (parent) {
            const merged = {
                ...parent, ...model,
                textures: { ...(parent.textures || {}), ...(model.textures || {}) },
                elements: model.elements || parent.elements,
                display:  { ...(parent.display  || {}), ...(model.display  || {}) },
            };
            modelCache.set(modelId, merged);
            return merged;
        }
    }
    modelCache.set(modelId, model);
    return model;
}

/**
 * `#ref` 形式のテクスチャ参照をたどり、実際のテクスチャパスを解決します。
 * @param texName テクスチャの参照名（例: "#all" や "#texture"）
 * @param textures モデルのテクスチャ定義マップ
 * @returns 解決されたテクスチャパス、解決できない場合は null
 */
export function resolveTexture(texName: string, textures: any): string | null {
    if (!texName) return null;
    let current = texName.startsWith('#') ? texName.substring(1) : texName;
    const visited = new Set<string>();
    while (textures?.[current]) {
        if (visited.has(current)) break;
        visited.add(current);
        const next = textures[current];
        if (typeof next !== 'string') return null;
        if (next.startsWith('#')) { current = next.substring(1); }
        else return next;
    }
    if (current && !current.startsWith('#') && visited.size === 0) return current;
    return null;
}
