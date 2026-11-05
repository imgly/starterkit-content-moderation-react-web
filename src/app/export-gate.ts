/**
 * Asks before an export when the design is not confirmed clean.
 *
 * Every export button of the editor runs the `exportDesign` action, so the
 * check wraps that action and covers them all.
 */

import type CreativeEditorSDK from '@cesdk/cesdk-js';

import type { LastCheck, ModerationSession } from './moderation-session';

type ExportDecision = 'export' | 'moderate' | 'cancel';

/**
 * Wraps the registered `exportDesign` action. Register the kit's own
 * `exportDesign` first, otherwise this wraps the editor's default.
 */
export function installExportGate(
  cesdk: CreativeEditorSDK,
  session: ModerationSession
): void {
  const exportDesign = cesdk.actions.get('exportDesign');
  if (exportDesign == null) {
    throw new Error('Register the exportDesign action before the export gate.');
  }

  cesdk.actions.register('exportDesign', async (...args) => {
    const decision = await decideExport(cesdk, session);
    if (decision === 'moderate') {
      await session.check();
      return;
    }
    if (decision === 'export') await exportDesign(...args);
  });
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The dialog text, or `null` when the design is confirmed clean. */
function exportWarning(
  check: LastCheck | null,
  lastRunFailed: boolean
): { title: string; message: string } | null {
  if (lastRunFailed) {
    return {
      title: 'Content not moderated',
      message:
        'The last check did not finish, so this design may contain restricted content. Export anyway?'
    };
  }
  if (check == null) {
    return {
      title: 'Content not moderated',
      message:
        "This design hasn't been moderated yet and may contain restricted content. Export anyway?"
    };
  }
  if (check.changed) {
    return {
      title: 'Content not moderated',
      message:
        'This design has changed since the last check and may contain restricted content. Export anyway?'
    };
  }
  const flaggedBlocks = new Set(
    check.report.results
      .filter((result) => result.state !== 'success')
      .map((result) => result.blockId)
  ).size;
  if (flaggedBlocks > 0) {
    return {
      title: 'Restricted content detected',
      message: `This design may contain restricted content in ${plural(flaggedBlocks, 'place')}. Export anyway?`
    };
  }
  const unchecked = check.report.unchecked.length;
  if (unchecked > 0) {
    return {
      title: 'Content not moderated',
      message: `${plural(unchecked, 'block')} could not be checked and may contain restricted content. Export anyway?`
    };
  }
  return null;
}

async function decideExport(
  cesdk: CreativeEditorSDK,
  session: ModerationSession
): Promise<ExportDecision> {
  const content = exportWarning(
    session.lastCheck,
    session.getSnapshot().lastRunFailed
  );
  if (content == null) return 'export';

  return new Promise<ExportDecision>((resolve) => {
    let settled = false;
    const settle = (decision: ExportDecision) => {
      if (settled) return;
      settled = true;
      resolve(decision);
    };
    const choose =
      (decision: ExportDecision) =>
      ({ id }: { id: string }) => {
        settle(decision);
        cesdk.ui.closeDialog(id);
      };

    cesdk.ui.showDialog({
      type: 'warning',
      content,
      actions: [
        {
          variant: 'regular',
          label: 'Moderate now',
          onClick: choose('moderate')
        },
        {
          variant: 'regular',
          color: 'danger',
          label: 'Export anyway',
          onClick: choose('export')
        }
      ],
      cancel: { variant: 'plain', label: 'Cancel', onClick: choose('cancel') },
      // A click outside or the close button cancels the export.
      onClose: () => settle('cancel')
    });
  });
}
