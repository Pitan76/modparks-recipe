/**
 * @fileoverview 取り込みセッションを使った投入の手順と、その進行状況。
 *
 * ポータルはこれまで ns ごとに bulk を1発投げるだけでした。1リクエストが大きくなるほど失敗しやすく、
 * 落ちた回には索引が半端なまま公開されます。ここでは jar Worker 側（recipeUpload.ts）と同じく
 * begin → 種別ごとの分割送信 → commit の順に進め、途中で落ちたら abort します。
 *
 * 手順を細かく刻む副産物として、いま何をしているかが呼び出し側から見えます。進行は `Step` の配列
 * として都度通知し、表示側はそれを描くだけにします（表示の都合をこちらへ持ち込まないため）。
 */

import type { ExtractedJar, NamespaceAssets } from '../../core/jar-assets';
import type { AssetKind } from '../../core/paths';
import type { Messages } from '../../utils/i18n/portal';
import { runPool } from '../../utils/pool';

/** 手順の識別子。文言キーと1対1で対応します。 */
export type StepKind = 'begin' | AssetKind | 'commit';

/** 手順の状態。 */
export type StepState = 'pending' | 'running' | 'done' | 'failed';

/** 進行中の1手順。 */
export type Step = {
  kind: StepKind;
  state: StepState;
  /** 送信済みの件数。件数の概念が無い手順では 0 のままです。 */
  done: number;
  total: number;
};

/** 進行の通知。配列は毎回作り直すので、そのまま state に入れられます。 */
export type OnProgress = (steps: Step[]) => void;

/**
 * 種別ごとの送信単位。
 *
 * テクスチャと言語ファイルは1件が大きいため、件数だけでなくバイト数でも切ります。
 * 依存される側から先に送るため、この並び順がそのまま送信順になります。
 * レシピを先に入れると、テクスチャ未着の透明アイコンが焼き付きます。
 */
const PHASES: { kind: AssetKind; maxCount: number; maxBytes: number }[] = [
  { kind: 'textures', maxCount: 80, maxBytes: 6_000_000 },
  { kind: 'mcmetas', maxCount: 200, maxBytes: Infinity },
  { kind: 'models', maxCount: 200, maxBytes: Infinity },
  { kind: 'items', maxCount: 200, maxBytes: Infinity },
  { kind: 'tags', maxCount: 200, maxBytes: Infinity },
  { kind: 'langs', maxCount: 10, maxBytes: 6_000_000 },
  { kind: 'recipes', maxCount: 200, maxBytes: Infinity },
];

/**
 * 並行送信に切り替える分割数。
 *
 * 往復が数回で済むうちは直列のほうが素直です。数百件のモデルやテクスチャを持つ大きい mod で、
 * 往復待ちが積み上がる場合にだけ効かせます。
 */
const PARALLEL_THRESHOLD = 4;

/**
 * 同じ ns の中で同時に流すチャンク数。
 *
 * サーバは1リクエストにつき30本並列で書くため、ここを上げるほど掛け算で同時書き込みが増えます。
 * 往復待ちを埋めるだけなら2本で足ります。
 */
const CHUNK_CONCURRENCY = 2;

/** エントリ数と（任意で）バイト数を上限にレコードを分割します。 */
function chunkRecord(obj: Record<string, string>, maxCount: number, maxBytes: number): Record<string, string>[] {
  const chunks: Record<string, string>[] = [];
  let cur: Record<string, string> = {};
  let n = 0;
  let bytes = 0;

  for (const [k, v] of Object.entries(obj)) {
    if (n > 0 && (n >= maxCount || bytes + v.length > maxBytes)) {
      chunks.push(cur);
      cur = {};
      n = 0;
      bytes = 0;
    }
    cur[k] = v;
    n++;
    bytes += v.length;
  }
  if (n > 0) chunks.push(cur);
  return chunks;
}

/** 種別の総件数を ns 横断で数えます。 */
function totalOf(extracted: ExtractedJar, kind: AssetKind): number {
  return extracted.namespaces.reduce((n, ns) => n + Object.keys(bucketOf(extracted, ns)[kind] ?? {}).length, 0);
}

function bucketOf(extracted: ExtractedJar, ns: string): NamespaceAssets {
  return extracted.byNs[ns];
}

/** 進行状況を保持し、変化のたびに通知します。 */
class Progress {
  private readonly steps: Step[];

  constructor(extracted: ExtractedJar, private readonly notify: OnProgress) {
    this.steps = [
      { kind: 'begin', state: 'pending', done: 0, total: extracted.namespaces.length },
      ...PHASES.map((p): Step => ({ kind: p.kind, state: 'pending', done: 0, total: totalOf(extracted, p.kind) })),
      { kind: 'commit', state: 'pending', done: 0, total: extracted.namespaces.length },
    ];
    this.emit();
  }

  /** 手順を1つ進行中にします。 */
  start(kind: StepKind): void {
    this.patch(kind, { state: 'running' });
  }

  /** 進行中の手順に件数を積みます。 */
  advance(kind: StepKind, n: number): void {
    const step = this.find(kind);
    this.patch(kind, { done: step.done + n });
  }

  /** 手順を完了にします。件数のある手順は総数に揃えます（分割の端数で半端に見えないように）。 */
  finish(kind: StepKind): void {
    const step = this.find(kind);
    this.patch(kind, { state: 'done', done: step.total });
  }

  /** 進行中の手順を失敗にします。以降の手順は pending のまま残し、どこで止まったかを示します。 */
  fail(): void {
    const running = this.steps.find((s) => s.state === 'running');
    if (running) this.patch(running.kind, { state: 'failed' });
  }

  private find(kind: StepKind): Step {
    const step = this.steps.find((s) => s.kind === kind);
    if (!step) throw new Error(`unknown step: ${kind}`);
    return step;
  }

  private patch(kind: StepKind, next: Partial<Step>): void {
    Object.assign(this.find(kind), next);
    this.emit();
  }

  private emit(): void {
    this.notify(this.steps.map((s) => ({ ...s })));
  }
}

/** 投入1回分の文脈。 */
type Session = { ns: string; session: string | null };

/**
 * 取り込みセッションを使って展開済みアセットを投入します。
 *
 * セッションを開けなかった ns はセッション無しで送ります（従来動作）。CDN 側が古い場合でも
 * 投稿自体は通す必要があるためです。
 * @param extracted 展開結果
 * @param headers 認証込みのリクエストヘッダ
 * @param t 文言表
 * @param onProgress 進行の通知
 * @returns 取り込まれた件数
 */
export async function sendWithSession(
  extracted: ExtractedJar,
  headers: Record<string, string>,
  t: Messages,
  onProgress: OnProgress
): Promise<number> {
  const progress = new Progress(extracted, onProgress);
  const sessions: Session[] = [];

  let count = 0;
  try {
    progress.start('begin');
    for (const ns of extracted.namespaces) {
      sessions.push({ ns, session: await beginSession(ns, headers, t) });
      progress.advance('begin', 1);
    }
    progress.finish('begin');

    for (const phase of PHASES) {
      progress.start(phase.kind);
      count += await runPhase(extracted, sessions, phase, headers, t, progress);
      progress.finish(phase.kind);
    }

    progress.start('commit');
    for (const { ns, session } of sessions) {
      if (session) await endSession(ns, session, 'commit', headers, t);
      progress.advance('commit', 1);
    }
    progress.finish('commit');
  } catch (err) {
    progress.fail();
    // 途中で落ちた分は公開しない。半分だけ入った mod を出すより、何も変えないほうが害が小さい。
    for (const { ns, session } of sessions) {
      if (session) await endSession(ns, session, 'abort', headers, t);
    }
    throw err;
  }

  return count;
}

/**
 * 1フェーズ分を送ります。
 *
 * ns どうしは別のセッション・別の保存先なので同時に流します。同じ ns の中は、分割が
 * `PARALLEL_THRESHOLD` を超えたときだけ `CHUNK_CONCURRENCY` 本まで並行にします。
 *
 * 途中で落ちても残りの完了を待ってから投げ直します。飛行中の書き込みを残したまま abort すると、
 * 消したはずのステージングへ後から書き足されます。
 * @returns このフェーズで取り込まれた件数
 */
async function runPhase(
  extracted: ExtractedJar,
  sessions: Session[],
  phase: (typeof PHASES)[number],
  headers: Record<string, string>,
  t: Messages,
  progress: Progress
): Promise<number> {
  const results = await Promise.allSettled(
    sessions.map(async ({ ns, session }) => {
      const chunks = chunkRecord(bucketOf(extracted, ns)[phase.kind] ?? {}, phase.maxCount, phase.maxBytes);
      let count = 0;

      // 分割が少ないうちは直列のままにします。往復が数回なら並行にしても縮まらず、
      // 進捗の数字が飛ぶぶんだけ分かりにくくなります。
      const limit = chunks.length >= PARALLEL_THRESHOLD ? CHUNK_CONCURRENCY : 1;
      await runPool(chunks, limit, async (chunk) => {
        count += await postBulk(ns, session, { [phase.kind]: chunk }, headers, t);
        progress.advance(phase.kind, Object.keys(chunk).length);
      });
      return count;
    })
  );

  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
  return results.reduce((n, r) => n + (r.status === 'fulfilled' ? r.value : 0), 0);
}

/**
 * 取り込みセッションを開始します。
 *
 * 書けないことが確定する応答（未認証・権限なし・上限）は、ここで止めます。以前はこれも
 * 「セッションを開けなかった」として無視して先へ進んでいたため、開始が成功したように見えたまま
 * 最初のフェーズで初めて失敗し、原因が1手順ずれて見えていました。
 *
 * それ以外の失敗（CDN 側が古いなど）は従来どおりセッション無しで続行します。
 * @param ns ネームスペース
 * @param headers 認証込みのリクエストヘッダ
 * @param t 文言表
 * @returns セッションID。開けなければ null（セッション無しで送る）
 */
async function beginSession(ns: string, headers: Record<string, string>, t: Messages): Promise<string | null> {
  const res = await fetch(`/api/${ns}/ingest/begin`, {
    method: 'POST',
    headers,
    // ポータルからは対象MCバージョンが分からないため build は作らせない。
    // 素性の無い build はチャネルに載らず、置き場所だけを消費します。
    body: JSON.stringify({ source: 'portal' }),
  });
  if (res.status === 429) throw new Error(await limitMessage(res, t));
  if (res.status === 401 || res.status === 403) throw await detailedError(res, t, `begin ${ns}`);
  if (!res.ok) {
    // 黙って落とすと、以降が非トランザクションで進んだことに誰も気付けません。
    console.warn(`ingest/begin failed for ${ns}: ${res.status} ${await res.text()}`);
    return null;
  }

  const body = (await res.json()) as { session?: string };
  return body.session ?? null;
}

/**
 * 1チャンクを送ります。
 * @returns 取り込まれた件数
 */
async function postBulk(
  ns: string,
  session: string | null,
  part: Partial<Record<AssetKind, Record<string, string>>>,
  headers: Record<string, string>,
  t: Messages
): Promise<number> {
  const query = session ? `?session=${encodeURIComponent(session)}` : '';
  const res = await fetch(`/api/${ns}/bulk${query}`, { method: 'POST', headers, body: JSON.stringify(part) });
  if (res.status === 429) throw new Error(await limitMessage(res, t));
  if (!res.ok) throw await detailedError(res, t, whereOf(ns, part));

  const body = (await res.json()) as Record<string, number>;
  return Object.keys(part).reduce((n, kind) => n + (body[kind] || 0), 0);
}

/** セッションを確定または破棄します。破棄の失敗は握り潰します（TTLで掃除されるため）。 */
async function endSession(
  ns: string,
  session: string,
  action: 'commit' | 'abort',
  headers: Record<string, string>,
  t: Messages
): Promise<void> {
  const url = `/api/${ns}/ingest/${action}?session=${encodeURIComponent(session)}`;
  if (action === 'abort') {
    await fetch(url, { method: 'POST', headers }).catch(() => undefined);
    return;
  }
  const res = await fetch(url, { method: 'POST', headers });
  if (!res.ok) throw await detailedError(res, t, `commit ${ns}`);
}

/**
 * 429 の理由を文言に振り分けます。
 *
 * 日次の投稿枠と namespace の所有上限はどちらも 429 で返りますが、投稿者から見て意味も
 * 対処も違います。同じ文言にすると「残り3回あるのに上限」という表示になります。
 * @param res 429 の応答
 * @param t 文言表
 */
async function limitMessage(res: Response, t: Messages): Promise<string> {
  const body = await res.text().catch(() => '');
  return body.includes('Namespace') ? t.errorNamespaceLimit : t.errorLimit;
}

/**
 * 失敗した送信が「どの ns の、どの種別の、どのファイル群か」を1行にします。
 *
 * ns と種別だけでは、数百件のうちどれが原因かを探せません。チャンクの件数と先頭・末尾のキーが
 * あれば、jar の中の該当ファイルまで辿れます。
 * @param ns ネームスペース
 * @param part 送ろうとした中身
 */
function whereOf(ns: string, part: Partial<Record<AssetKind, Record<string, string>>>): string {
  const [kind, entries] = Object.entries(part)[0] as [string, Record<string, string>];
  const keys = Object.keys(entries);
  const range = keys.length > 1 ? `${keys[0]}…${keys[keys.length - 1]}` : keys[0];
  return `${ns} ${kind} ${keys.length}件 ${range}`;
}

/**
 * 失敗した応答から、原因の分かるエラーを作ります。
 *
 * 表示文言だけだと、どの ns のどの種別で何が起きたのかが残りません。翻訳済みの文言の後ろに、
 * 状況と応答本文を付けます（サーバ側は理由を素の文字列で返すため）。
 * @param res 失敗した応答
 * @param t 文言表
 * @param where どの手順か
 */
async function detailedError(res: Response, t: Messages, where: string): Promise<Error> {
  const body = await res.text().catch(() => '');
  return new Error(`${t.errorGeneric} [${where}: ${res.status} ${body.slice(0, 200)}]`);
}
