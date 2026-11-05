/**
 * Content Moderation Types
 */

export type ModerationState = 'success' | 'warning' | 'failed';

export interface ModerationCheckResult {
  name: string;
  description: string;
  state: ModerationState;
}

/** What the moderation service classifies: an image it can fetch, or text. */
export type ModerationContent =
  | { kind: 'image'; url: string }
  | { kind: 'text'; text: string };

export interface ModerationBlock {
  blockId: number;
  blockType: string;
  blockName: string | null;
  /** The heading the sidebar shows for the block. */
  label: string;
}

export interface ModerationResult
  extends ModerationCheckResult, ModerationBlock {}

export interface ModerationReport {
  /** One result per category the service scored, for each checked block. */
  results: ModerationResult[];
  /** Blocks whose check failed, so the design is not confirmed clean. */
  unchecked: ModerationBlock[];
  /** The account ran out of credits during the check. */
  outOfCredits: boolean;
}
