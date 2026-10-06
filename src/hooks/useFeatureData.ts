import { useMemo } from 'react';
import { usePreflight } from '@/hooks/queries';
import { exportService } from '@/services';
import type { PreflightIssue } from '@/types/domain';

export const DEMO_BOOK_ID = 'book_keeper_ledger';

/** Export formats with their audience, sourced from the export service. */
export function useExportFormats() {
  return useMemo(
    () =>
      exportService.formats().map((format) => ({
        id: format.id,
        label: format.label,
        audience: format.family === 'print' ? 'Print' : 'Digital',
        description: format.description,
      })),
    [],
  );
}

export interface PreflightRow extends PreflightIssue {
  rowId: string;
}

/** Representative preflight rows for marketing pages, taken from the real checker. */
export function usePreflightRows(): PreflightRow[] {
  const { data: report } = usePreflight(DEMO_BOOK_ID, 'paperback');
  return useMemo(() => {
    if (!report) return [];
    return report.issues.slice(0, 8).map((issue) => ({ ...issue, rowId: issue.id }));
  }, [report]);
}
