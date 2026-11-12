/**
 * Content Moderation
 *
 * Checks every image and text block in the scene with the IMG.LY Gateway
 * (see `gateway.ts`) and maps each category score to a moderation state.
 */

import type { CreativeEngine } from '@cesdk/cesdk-js';

import { detect, GatewayError, uploadImage } from './gateway';
import { getImageUrl, percentageToState } from './utils';
import type {
  ModerationBlock,
  ModerationCheckResult,
  ModerationContent,
  ModerationReport
} from './types';

interface Category {
  id: string;
  name: string;
  description: string;
}

/**
 * The categories the detection model reports, in the order the sidebar lists
 * them. The image and text sets do not overlap, so one table covers both.
 */
const CATEGORIES: Category[] = [
  {
    id: 'nudity',
    name: 'Nudity',
    description: 'Raw or partial nudity, sexual acts, and suggestive content.'
  },
  {
    id: 'weapon',
    name: 'Weapons',
    description: 'Handguns, rifles, machine guns, threatening knives...'
  },
  {
    id: 'recreational_drug',
    name: 'Recreational Drugs',
    description: 'Cannabis and other recreational drugs.'
  },
  {
    id: 'medical',
    name: 'Medical',
    description: 'Pills, syringes, medical devices, and other medical imagery.'
  },
  {
    id: 'alcohol',
    name: 'Alcohol',
    description: 'Wine, beer, cocktails, champagne...'
  },
  {
    id: 'offensive',
    name: 'Offensive Symbols',
    description: 'Hate symbols, extremist imagery, and offensive gestures.'
  },
  {
    id: 'gore',
    name: 'Gore',
    description: 'Blood, wounds, corpses, and other graphic imagery.'
  },
  {
    id: 'toxic',
    name: 'Toxic Language',
    description: 'Language likely to make someone leave the conversation.'
  },
  {
    id: 'insulting',
    name: 'Insulting Language',
    description: 'Insults, name-calling, and demeaning remarks.'
  },
  {
    id: 'discriminatory',
    name: 'Discriminatory Language',
    description: 'Language that demeans a group or protected characteristic.'
  },
  {
    id: 'violent',
    name: 'Violent Language',
    description: 'Threats of violence and calls to harm someone.'
  },
  {
    id: 'sexual',
    name: 'Sexual Language',
    description: 'Sexually explicit or suggestive wording.'
  },
  {
    id: 'self-harm',
    name: 'Self-Harm',
    description: 'References to suicide, self-injury, or eating disorders.'
  }
];

const MAX_CONCURRENT_REQUESTS = 4;
const RENDER_TARGET_SIZE = 1024;
const RENDER_QUALITY = 0.85;
const MAX_QUOTED_TEXT = 40;

/**
 * Maps the scores of one block to results. Every scored category is
 * reported, so one the model adds later is named from its id, not dropped.
 */
export function toCheckResults(
  scores: Record<string, number>
): ModerationCheckResult[] {
  const known = CATEGORIES.filter(({ id }) => id in scores);
  const unknown = Object.keys(scores)
    .filter((id) => !CATEGORIES.some((category) => category.id === id))
    .sort()
    .map((id) => ({
      id,
      name: id
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
      description: 'Reported by the moderation service.'
    }));
  return [...known, ...unknown].map(({ id, name, description }) => ({
    name,
    description,
    state: percentageToState(scores[id])
  }));
}

interface Target {
  block: ModerationBlock;
  /** Resolves the content lazily, so an upload counts toward the cap. */
  content: () => Promise<ModerationContent>;
}

/**
 * Hosts the gateway cannot reach: loopback, private and link-local IPv4 and
 * IPv6 addresses, shared address space, names without a dot, and local
 * domains.
 */
const PRIVATE_HOST =
  /^(localhost|0\.0\.0\.0|127\.[\d.]+|10\.[\d.]+|192\.168\.[\d.]+|172\.(1[6-9]|2\d|3[01])\.[\d.]+|169\.254\.[\d.]+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.[\d.]+|\[(::1?|::ffff:.*|f[cd].*|fe[89ab].*)\]|[^.[]+)$|\.(localhost|local|lan|internal|home\.arpa)$/;

/**
 * The gateway fetches the image itself, so it needs a public URL. A `blob:`
 * or `buffer:` upload, or an asset served from this machine or the local
 * network, is rendered and uploaded instead.
 */
function isPublicUrl(uri: string): boolean {
  try {
    const { protocol, hostname } = new URL(uri);
    return (
      (protocol === 'https:' || protocol === 'http:') &&
      // A trailing dot names the same host.
      !PRIVATE_HOST.test(hostname.replace(/\.$/, ''))
    );
  } catch {
    return false;
  }
}

function describeBlock(
  engine: CreativeEngine,
  blockId: number,
  label: string
): ModerationBlock {
  return {
    blockId,
    blockType: engine.block.getType(blockId),
    blockName: engine.block.getName(blockId),
    label
  };
}

function imageTargets(engine: CreativeEngine): Target[] {
  return engine.block.findByKind('image').flatMap((blockId) => {
    const url = getImageUrl(engine, blockId);
    if (!url) return [];
    const block = describeBlock(
      engine,
      blockId,
      engine.block.getName(blockId) || 'Image'
    );
    if (isPublicUrl(url)) {
      return [{ block, content: async () => ({ kind: 'image', url }) }];
    }
    return [
      {
        block,
        content: async () => {
          // JPEG keeps the upload small. The engine renders the block large
          // enough to fill the target size, so a small block is scaled up.
          const rendered = await engine.block.export(blockId, {
            mimeType: 'image/jpeg',
            jpegQuality: RENDER_QUALITY,
            targetWidth: RENDER_TARGET_SIZE,
            targetHeight: RENDER_TARGET_SIZE
          });
          return { kind: 'image', url: await uploadImage(rendered) };
        }
      }
    ];
  });
}

/** Blank text is skipped: there is nothing to classify. */
function textTargets(engine: CreativeEngine): Target[] {
  return engine.block.findByType('text').flatMap((blockId) => {
    const text = engine.block.getString(blockId, 'text/text');
    if (text.trim().length === 0) return [];
    // A text block's name defaults to "Text", so the words identify it.
    const quoted = text.slice(0, MAX_QUOTED_TEXT).trim();
    const label = `"${quoted}${text.length > MAX_QUOTED_TEXT ? '…' : ''}"`;
    return [
      {
        block: describeBlock(engine, blockId, label),
        content: async () => ({ kind: 'text', text })
      }
    ];
  });
}

/**
 * Runs `tasks` with at most `limit` in flight, keeping their order. After a
 * task fails with a reason that `stop` accepts, no further task starts, and
 * each one not started is rejected with that reason.
 */
async function settleWithLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  stop: (reason: unknown) => boolean
): Promise<PromiseSettledResult<T>[]> {
  const settled: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  let stopped: { reason: unknown } | undefined;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      if (stopped) {
        settled[index] = { status: 'rejected', reason: stopped.reason };
        continue;
      }
      try {
        settled[index] = { status: 'fulfilled', value: await tasks[index]() };
      } catch (reason) {
        settled[index] = { status: 'rejected', reason };
        if (stop(reason)) stopped ??= { reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker)
  );
  return settled;
}

function isOutOfCredits(reason: unknown): boolean {
  return reason instanceof GatewayError && reason.isOutOfCredits;
}

/**
 * Checks all images and texts in the scene. A block whose check fails is
 * reported as unchecked. When every block fails, the error is thrown, and an
 * out-of-credits error wins over any other. Once the account is out of
 * credits, no further block is sent.
 */
export async function moderateScene(
  engine: CreativeEngine
): Promise<ModerationReport> {
  const targets = [...imageTargets(engine), ...textTargets(engine)];
  // A scene with many text blocks would otherwise open one request per block
  // at once and be rate-limited.
  const outcomes = await settleWithLimit(
    targets.map(
      (target) => async () =>
        toCheckResults(await detect(await target.content()))
    ),
    MAX_CONCURRENT_REQUESTS,
    isOutOfCredits
  );

  const failures = outcomes.filter(
    (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
  );
  if (targets.length > 0 && failures.length === targets.length) {
    throw (
      failures.find((failure) => isOutOfCredits(failure.reason)) ?? failures[0]
    ).reason;
  }

  return {
    outOfCredits: failures.some((failure) => isOutOfCredits(failure.reason)),
    results: outcomes.flatMap((outcome, index) =>
      outcome.status === 'fulfilled'
        ? outcome.value.map((result) => ({
            ...result,
            ...targets[index].block
          }))
        : []
    ),
    unchecked: targets
      .filter((_, index) => outcomes[index].status === 'rejected')
      .map((target) => target.block)
  };
}
