/**
 * @fileoverview 投入の進行表示。
 *
 * 取り込みは begin から commit までを1つのまとまりとして扱うため、途中経過が見えないと
 * 「止まっている」のか「テクスチャを送っている最中」なのか区別できません。手順を縦に並べ、
 * 矢印で順序を、回転で進行中を示します。判断は upload-flow が持ち、ここは描くだけです。
 */

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import type { Step, StepKind, StepState } from './upload-flow';
import type { Messages, MessageKey } from '../../utils/i18n/portal';

/** 手順から文言キーへの対応。手順が増えたらここも足します。 */
const LABEL_KEYS: Record<StepKind, MessageKey> = {
  begin: 'stepBegin',
  textures: 'stepTextures',
  models: 'stepModels',
  items: 'stepItems',
  tags: 'stepTags',
  langs: 'stepLangs',
  recipes: 'stepRecipes',
  commit: 'stepCommit',
};

/** 状態ごとの文字色。進行中と失敗だけを強調し、残りは背景に沈めます。 */
const COLORS: Record<StepState, string> = {
  pending: 'text.disabled',
  running: 'text.primary',
  done: 'text.secondary',
  failed: 'error.main',
};

/** 状態を表す先頭のしるし。進行中だけが回ります。 */
function Marker({ state }: { state: StepState }) {
  if (state === 'running') return <CircularProgress size={14} thickness={5} />;

  const glyph = state === 'done' ? '✓' : state === 'failed' ? '✕' : '○';
  return (
    <Typography component="span" sx={{ width: 14, textAlign: 'center', fontSize: 13, color: COLORS[state] }}>
      {glyph}
    </Typography>
  );
}

/** 1手順の行。件数を持つ手順だけ「済 / 全」を出します。 */
function StepRow({ t, step }: { t: Messages; step: Step }) {
  const showCount = step.total > 0 && step.state !== 'pending';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Marker state={step.state} />
      <Typography variant="body2" sx={{ color: COLORS[step.state] }}>
        {t[LABEL_KEYS[step.kind]]}
      </Typography>
      {showCount && (
        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
          {step.done} / {step.total}
        </Typography>
      )}
    </Box>
  );
}

/**
 * 投入の進行を描きます。
 * @param t 文言表
 * @param steps 進行中の手順。空なら何も描きません
 */
export function UploadProgress({ t, steps }: { t: Messages; steps: Step[] }) {
  if (steps.length === 0) return null;

  return (
    <Box sx={{ mt: 1.5 }}>
      {steps.map((step, i) => (
        <Box key={step.kind}>
          {i > 0 && (
            <Typography
              component="div"
              aria-hidden
              sx={{ ml: '6px', lineHeight: 1, fontSize: 12, color: 'text.disabled' }}
            >
              ↓
            </Typography>
          )}
          <StepRow t={t} step={step} />
        </Box>
      ))}
    </Box>
  );
}
