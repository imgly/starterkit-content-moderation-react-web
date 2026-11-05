/**
 * The moderation state of one editor: the last report, whether a check runs,
 * and whether the design changed since the last check.
 *
 * The sidebar, the navigation bar button and the export check all read and
 * start checks through one session, so they never disagree.
 */

import type CreativeEditorSDK from '@cesdk/cesdk-js';

import { GatewayError } from './gateway';
import { moderateScene } from './moderation';
import type { ModerationReport } from './types';

/** The action that runs a check, for buttons outside the sidebar. */
export const CHECK_ACTION = 'contentModeration.design.check';

export interface ModerationSnapshot {
  report: ModerationReport | null;
  isLoading: boolean;
  /** The message of the last failed check, other than out of credits. */
  error: string | null;
  /** The last check threw, so no report is shown. */
  lastRunFailed: boolean;
}

/** The last check that returned a report. */
export interface LastCheck {
  report: ModerationReport;
  /** The design changed during or after the check. */
  changed: boolean;
}

const OUT_OF_CREDITS_MESSAGE =
  "You've run out of AI credits. Content moderation is unavailable until more credits are available.";

/** Where the account owner buys credits. Point it at your own billing page. */
const CREDIT_BALANCE_URL = 'https://img.ly/dashboard/credit-balance';

/** The editor's own error dialog, so the user cannot miss that checks stopped. */
function showOutOfCreditsDialog(cesdk: CreativeEditorSDK): void {
  cesdk.ui.showDialog({
    type: 'error',
    content: { title: 'Out of credits', message: OUT_OF_CREDITS_MESSAGE },
    actions: {
      color: 'accent',
      label: 'Manage credits',
      onClick: ({ id }) => {
        window.open(CREDIT_BALANCE_URL, '_blank', 'noopener');
        cesdk.ui.closeDialog(id);
      }
    },
    cancel: {
      variant: 'plain',
      label: 'common.close',
      onClick: ({ id }) => cesdk.ui.closeDialog(id)
    }
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof GatewayError && error.isAuthenticationFailure) {
    return 'The IMG.LY Gateway rejected the API key. Check the key and reload.';
  }
  if (error instanceof Error && error.message.length > 0) {
    return `The moderation check failed (${error.message.replace(/\.$/, '')}). Try again.`;
  }
  return 'The moderation check failed. Try again.';
}

export class ModerationSession {
  #snapshot: ModerationSnapshot = {
    report: null,
    isLoading: false,
    error: null,
    lastRunFailed: false
  };
  #listeners = new Set<() => void>();
  /** Counts the edits, so a check knows whether the design changed under it. */
  #edits = 0;
  #lastCheck: LastCheck | null = null;
  #unsubscribe: () => void;
  #running: Promise<void> | null = null;

  constructor(private readonly cesdk: CreativeEditorSDK) {
    this.#unsubscribe = cesdk.engine.editor.onHistoryUpdatedWithKind(() => {
      this.#edits += 1;
      if (this.#lastCheck != null) {
        this.#lastCheck = { ...this.#lastCheck, changed: true };
      }
    });
    cesdk.actions.register(CHECK_ACTION, () => this.check());
  }

  /** For `useSyncExternalStore`, so it keeps `this`. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): ModerationSnapshot => this.#snapshot;

  /** `null` when the design was never checked or the last check failed. */
  get lastCheck(): LastCheck | null {
    return this.#lastCheck;
  }

  /** Runs a check. A call while one runs waits for that check. */
  check(): Promise<void> {
    this.#running ??= this.#run().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  async #run(): Promise<void> {
    this.#update({ isLoading: true, error: null });
    const edits = this.#edits;
    try {
      const report = await moderateScene(this.cesdk.engine);
      this.#lastCheck = { report, changed: edits !== this.#edits };
      this.#update({ report, isLoading: false, lastRunFailed: false });
      if (report.outOfCredits) showOutOfCreditsDialog(this.cesdk);
    } catch (caught) {
      this.#lastCheck = null;
      // The last report may describe a design that has changed since, so it
      // must not stay on screen as clean.
      const outOfCredits =
        caught instanceof GatewayError && caught.isOutOfCredits;
      this.#update({
        report: null,
        isLoading: false,
        lastRunFailed: true,
        error: outOfCredits ? null : errorMessage(caught)
      });
      if (outOfCredits) showOutOfCreditsDialog(this.cesdk);
    }
  }

  dispose(): void {
    this.#unsubscribe();
    this.#listeners.clear();
  }

  #update(change: Partial<ModerationSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...change };
    for (const listener of this.#listeners) listener();
  }
}
