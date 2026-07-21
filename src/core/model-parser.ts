/**
 * @fileoverview モデルJSONから3DのSVGデータを構築するモデルパーサー。
 */

import {
    applyElementRotation,
    applyGuiTransform,
    defaultUv,
    faceBrightness,
    faceVertices,
    guiTransform,
    REF_SIZE,
    FRAME_MARGIN,
    FLAT_ITEM_PARENTS,
} from './block-geometry';
import {
    boundsOf,
    centroidZ,
    project,
    uvMatrix,
    type Vec2,
} from './math';

interface SvgFace {
    pts2d: Vec2[];
    uv: number[];
    b64: string;
    /** テクスチャのピクセルサイズ。UVはこのサイズを基準として定義されます。 */
    texW: number;
    texH: number;
    brightness: number;
    centroidZ: number;
}

/**
 * PNGデータURLのIHDRチャンクから縦横のピクセルサイズを取得します。
 * 面のUVはテクスチャのピクセル単位（ブロックテクスチャの場合は 0..16、チェストなどのエンティティアトラスの場合は 0..64）で表現されるため、
 * `<image>` はテクスチャの実際のサイズで配置する必要があります。
 * 16pxとして固定値（ハードコード）にしてしまうと、それより大きいアセットが 16x16 の正方形に押しつぶされてしまいます。
 * @param dataUrl PNGのデータURL
 */
function pngSize(dataUrl: string): { w: number; h: number } {
    const comma = dataUrl.indexOf(',');
    // 33バイトには、8バイトのシグネチャ、チャンクヘッダー、およびIHDRの幅/高さが含まれます。
    const header = atob(dataUrl.slice(comma + 1, comma + 1 + 64)).slice(0, 33);
    const be32 = (o: number) =>
        (header.charCodeAt(o) << 24 | header.charCodeAt(o + 1) << 16 |
         header.charCodeAt(o + 2) << 8 | header.charCodeAt(o + 3)) >>> 0;
    const w = be32(16), h = be32(20);
    return w > 0 && h > 0 ? { w, h } : { w: 16, h: 16 };
}

/**
 * 指定されたモデルIDからモデルデータを読み込み、親モデルのチェーンと再帰的にマージします。
 * @param modelId 対象モデルのID
 * @param getModelJson モデルのJSONを取得する非同期関数
 * @returns マージされたモデルデータ
 */
export async function loadModel(
    modelId: string,
    getModelJson: (id: string) => Promise<any>
): Promise<any> {
    const model = await getModelJson(modelId);
    if (!model) return null;
    if (!model.parent) return model;

    let parentId = model.parent;
    if (!parentId.includes(':')) parentId = 'minecraft:' + parentId;

    const parent = await loadModel(parentId, getModelJson);
    if (!parent) return model;

    return {
        ...parent, ...model,
        textures: { ...(parent.textures || {}), ...(model.textures || {}) },
        elements: model.elements || parent.elements,
        display: { ...(parent.display || {}), ...(model.display || {}) },
    };
}

/**
 * `#ref` 形式のテクスチャ参照（インダイレクション）をたどり、実際のテクスチャパスを解決します。
 * @param texName テクスチャの参照名（例: "#all" や "#texture"）
 * @param textures モデルのテクスチャ定義マップ
 * @returns 解決されたテクスチャパス、解決できない場合は null
 */
export function resolveTexture(texName: string, textures: any): string | null {
    if (!texName) return null;
    let current = texName.startsWith('#') ? texName.substring(1) : texName;
    const visited = new Set<string>();
    while (textures && textures[current]) {
        if (visited.has(current)) break;
        visited.add(current);
        const next = textures[current];
        if (typeof next !== 'string') return null;
        if (!next.startsWith('#')) return next;
        current = next.substring(1);
    }
    if (current && !current.startsWith('#') && visited.size === 0) return current;
    return null;
}

/**
 * モデルを等角投影（isometric）のSVGアイコンとしてレンダリングします。ジオメトリが存在しない場合は null を返します。
 * @param modelId 対象モデルのID
 * @param getModelJson モデルのJSONを取得する非同期関数
 * @param getTextureBase64 テクスチャ画像をbase64データURLとして取得する非同期関数
 * @returns 生成されたSVG文字列、または null
 */
export async function renderModelToSvg(
    modelId: string,
    getModelJson: (id: string) => Promise<any>,
    getTextureBase64: (path: string) => Promise<string | null>
): Promise<string | null> {
    const model = await loadModel(modelId, getModelJson);
    if (!model) return null;

    if (FLAT_ITEM_PARENTS.has(model.parent)) return flatItemSvg(model, getTextureBase64);
    if (!model.elements) return null;

    const faces = await collectFaces(model, getTextureBase64);
    if (faces.length === 0) return null;
    faces.sort((a, b) => a.centroidZ - b.centroidZ);

    return buildSvg(faces);
}

/**
 * 平面的なスプライトアイテム（2D）のSVGを生成します。
 * @param model モデルデータ
 * @param getTextureBase64 テクスチャ画像データを取得する関数
 */
async function flatItemSvg(
    model: any,
    getTextureBase64: (path: string) => Promise<string | null>
): Promise<string | null> {
    const texPath = resolveTexture('#layer0', model.textures);
    if (!texPath) return null;
    const b64 = await getTextureBase64(texPath);
    if (!b64) return null;
    // アニメーションテクスチャは縦長のフレーム群（帯状）です。最初のフレームのみを表示します。
    const { w } = pngSize(b64);
    return `<svg viewBox="0 0 ${w} ${w}" xmlns="http://www.w3.org/2000/svg">`
        + `<image href="${b64}" width="${w}" height="${w}" preserveAspectRatio="xMinYMin slice"`
        + ` image-rendering="optimizeSpeed"/></svg>`;
}

/**
 * モデル要素のすべての描画対象面を収集します。
 * @param model モデルデータ
 * @param getTextureBase64 テクスチャ画像データを取得する関数
 */
async function collectFaces(
    model: any,
    getTextureBase64: (path: string) => Promise<string | null>
): Promise<SvgFace[]> {
    const gui = guiTransform(model);
    const faces: SvgFace[] = [];

    for (const el of model.elements) {
        for (const [dir, face] of Object.entries(el.faces) as [string, any][]) {
            const corners = faceVertices(dir, el.from, el.to);
            if (!corners) continue;

            const texPath = resolveTexture(face.texture, model.textures);
            if (!texPath) continue;
            const b64 = await getTextureBase64(texPath);
            if (!b64) continue;

            const { w: texW, h: texH } = pngSize(b64);
            const pts = applyGuiTransform(applyElementRotation(corners, el.rotation), gui);
            faces.push({
                pts2d: project(pts),
                uv: face.uv || defaultUv(dir, el.from, el.to),
                b64,
                texW,
                texH,
                brightness: faceBrightness(dir),
                centroidZ: centroidZ(pts),
            });
        }
    }
    return faces;
}

/**
 * 固定の基準（フルサイズ 16³ ブロックの投影サイズ）に基づいてフレーム位置を算出します。
 * モデル独自のバウンディングボックスを基準にはしません。バウンディングボックスに合わせると、
 * ボタンやハーフブロックがフルサイズブロックと同じ大きさに引き伸ばされてしまい、オフラインレンダラーとも一致しなくなります。
 * 基準よりも大きいモデルは、フレームからはみ出さないように縮小されます。
 * @param faces 収集されたSVG面の配列
 */
function viewBox(faces: SvgFace[]): string {
    const { minX, minY, maxX, maxY } = boundsOf(faces.map(f => f.pts2d));
    const extent = Math.max(REF_SIZE * FRAME_MARGIN, maxX - minX, maxY - minY, 1);
    return `${(minX + maxX) / 2 - extent / 2} ${(minY + maxY) / 2 - extent / 2} ${extent} ${extent}`;
}

/**
 * 収集されたSVG面リストを結合して、最終的なSVGドキュメント文字列を組み立てます。
 * @param faces 収集された面の配列
 */
function buildSvg(faces: SvgFace[]): string {
    let defs = '';
    let body = '';
    let clipSeq = 0;
    const brightnesses = new Set<number>();

    for (const f of faces) {
        const m = uvMatrix(f.pts2d, f.uv);
        if (!m) continue;

        const clipId = `clip_${clipSeq++}`;
        const points = f.pts2d.map(pt => `${pt.x},${pt.y}`).join(' ');

        // クリッピングパス（clipPath）は、変換されていない面自体のローカル空間に適用される必要があります。
        // そのため、クリップ設定は外側の `<g>` 要素に適用し、UVの変換行列は内側の `<image>` 要素に設定します。
        // 両方を同じ要素に設定すると、ポリゴン頂点も変換行列にかけられてしまい、テクスチャの大部分がクリップされて非表示になります。
        defs += `<clipPath id="${clipId}"><polygon points="${points}"/></clipPath>\n`;
        const filter = f.brightness < 1 ? ` filter="url(#${shadeId(f.brightness)})"` : '';
        // シェーディング（影）は `<image>` ではなく `<g>` に適用します。
        // 画像にフィルターをかけると変換前の矩形サイズに対して計算されますが、その後にUV行列によって縮小されるため、
        // フィルター領域が潰れた際に resvg が面を描画対象からドロップしてしまいます。
        body += `<g clip-path="url(#${clipId})"${filter}><image href="${f.b64}" width="${f.texW}" height="${f.texH}"`
            + ` transform="matrix(${m.join(', ')})" image-rendering="optimizeSpeed"/></g>\n`;
        if (f.brightness < 1) brightnesses.add(f.brightness);
    }

    for (const b of brightnesses) defs += shadeFilter(b);

    return `<svg viewBox="${viewBox(faces)}" xmlns="http://www.w3.org/2000/svg">\n`
        + `<defs>\n${defs}</defs>\n${body}</svg>`;
}

/**
 * 明るさの倍率から、ユニークなフィルターIDを取得します。
 * @param brightness 明るさの倍率
 */
function shadeId(brightness: number): string {
    return `shade${Math.round(brightness * 100)}`;
}

/**
 * シェーディング用のフィルター。RGB乗算を行いつつ、アルファ（透過）はそのまま維持します。
 * これにより、切り抜き透過テクスチャに平坦なオーバーレイを重ねた時のように、周囲に黒い四角形が表示されるのを防ぎます。
 * @param b 明るさの倍率
 */
function shadeFilter(b: number): string {
    return `<filter id="${shadeId(b)}" color-interpolation-filters="sRGB">`
        + `<feColorMatrix type="matrix" values="${b} 0 0 0 0  0 ${b} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0"/></filter>\n`;
}
