/**
 * Content Moderation Sidebar
 *
 * Manages the moderation sidebar UI including:
 * - Validate button with loading state
 * - Results list with status indicators, for images and text
 * - Blocks the service could not check
 * - Block selection on click
 */

import { useCallback, useSyncExternalStore } from 'react';

import type CreativeEditorSDK from '@cesdk/cesdk-js';

import type {
  ModerationSession,
  ModerationSnapshot
} from '../../moderation-session';
import { selectBlocks } from '../../utils';
import { ResultItem, UncheckedItem } from './ResultItem';
import './Sidebar.css';
import { DEMO_ASSETS_BASE_URL } from '../../../imgly/demo-assets';

interface SidebarProps {
  cesdk: CreativeEditorSDK | null;
  /** Owns the check, so the export check and the toolbar share its result. */
  session: ModerationSession | null;
}

const IDLE: ModerationSnapshot = {
  report: null,
  isLoading: false,
  error: null,
  lastRunFailed: false
};
const noSubscription = () => () => {};

export function Sidebar({ cesdk, session }: SidebarProps) {
  const { report, isLoading, error, lastRunFailed } = useSyncExternalStore(
    session?.subscribe ?? noSubscription,
    session?.getSnapshot ?? (() => IDLE)
  );

  const unsuccessfulResults =
    report?.results.filter((r) => r.state !== 'success') ?? [];
  const unchecked = report?.unchecked ?? [];
  const resultCount = unsuccessfulResults.length + unchecked.length;

  const handleValidate = useCallback(() => {
    void session?.check();
  }, [session]);

  const handleSelectBlock = useCallback(
    (blockId: number) => {
      if (!cesdk) return;
      if (cesdk.engine.block.isAllowedByScope(blockId, 'editor/select')) {
        selectBlocks(cesdk.engine, [blockId]);
      }
    },
    [cesdk]
  );

  return (
    <div className="moderation-sidebar">
      <div className="moderation-header">
        <button
          className="moderation-validate-btn"
          onClick={handleValidate}
          disabled={!cesdk || !session || isLoading}
        >
          <img
            src={`${DEMO_ASSETS_BASE_URL}/assets/icons/refresh.svg`}
            alt=""
            width="16"
            height="16"
          />
          <span>{isLoading ? 'Checking...' : 'Validate Content'}</span>
        </button>
        <span className="moderation-header-info">
          {resultCount} result
          {resultCount !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="moderation-list">
        {error != null && (
          <div className="moderation-status-text moderation-error" role="alert">
            {error}
          </div>
        )}
        {unchecked.length > 0 && (
          <p className="moderation-unchecked-note">
            {unchecked.length} block{unchecked.length !== 1 ? 's' : ''} could
            not be checked, so this design is not confirmed clean.
          </p>
        )}
        {resultCount === 0 ? (
          <div className="moderation-status-text">
            {report == null ? (
              lastRunFailed ? (
                'The last check did not finish, so no results are shown.'
              ) : (
                'No check has been performed yet.'
              )
            ) : (
              <span>
                No content violations found.
                <br />
                Every image and text block was checked and nothing was flagged.
              </span>
            )}
          </div>
        ) : (
          <>
            {unsuccessfulResults.map((result) => (
              <ResultItem
                key={`${result.blockId}-${result.name}`}
                result={result}
                onSelect={handleSelectBlock}
              />
            ))}
            {unchecked.map((block) => (
              <UncheckedItem
                key={`${block.blockId}-unchecked`}
                block={block}
                onSelect={handleSelectBlock}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
