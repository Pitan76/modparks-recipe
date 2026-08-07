/**
 * @fileoverview 結果が無い・読み込み中といった、中身の代わりに出す表示。
 */

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { type WithMessages } from './parts';

/** 何も選ばれていないときの案内。 */
export function EmptyState({ t }: WithMessages) {
  return (
    <div className="empty-state">
      <Typography variant="body2">{t.lead}</Typography>
    </div>
  );
}

/** 読み込み中の表示。 */
export function Loading() {
  return (
    <Box sx={{ p: 2, textAlign: 'center' }}>
      <CircularProgress size={20} />
    </Box>
  );
}

/** 一覧が空のときの表示。 */
export function EmptyMessage({ text }: { text: string }) {
  return (
    <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
      <Typography variant="body2">{text}</Typography>
    </Box>
  );
}
