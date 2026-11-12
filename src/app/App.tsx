/**
 * Content Moderation Editor - Main App Component
 *
 * Two-column layout with CE.SDK editor and moderation sidebar.
 */

import { useCallback, useEffect, useState } from 'react';

import CreativeEditor from '@cesdk/cesdk-js/react';
import type CreativeEditorSDK from '@cesdk/cesdk-js';
import type { Configuration } from '@cesdk/cesdk-js';

import { initContentModerationEditor } from '../imgly';
import {
  OnboardingScreen,
  probeAiCredentials,
  type AiCredentialMode
} from './ai-credentials';
import { Sidebar } from './components/Sidebar';
import { installExportGate } from './export-gate';
import { addModerateButton } from './moderation-button';
import { ModerationSession } from './moderation-session';
import './App.css';
import { DEMO_ASSETS_BASE_URL } from '../imgly/demo-assets';


interface AppProps {
  config: Configuration;
}

/**
 * Boot phases, rendered as distinct UI states:
 *   - `probing`    — credential preflight in flight; show an empty shell.
 *   - `onboarding` — no key / invalid key; show `OnboardingScreen`.
 *   - `ready`      — mount the editor and the sidebar.
 */
type BootState =
  | { phase: 'probing' }
  | {
      phase: 'onboarding';
      reason: 'missing' | 'invalid';
      mode: AiCredentialMode;
    }
  | { phase: 'ready' };

export default function App({ config }: AppProps) {
  const [boot, setBoot] = useState<BootState>({ phase: 'probing' });
  const [cesdk, setCesdk] = useState<CreativeEditorSDK | null>(null);
  const [session, setSession] = useState<ModerationSession | null>(null);

  useEffect(() => () => session?.dispose(), [session]);

  // The credential check runs before CE.SDK mounts, so a missing or rejected
  // key shows the onboarding screen instead of an editor whose check fails.
  useEffect(() => {
    let cancelled = false;

    probeAiCredentials().then((result) => {
      if (cancelled) return;

      if (result.status === 'missing') {
        setBoot({
          phase: 'onboarding',
          reason: 'missing',
          mode: 'unconfigured'
        });
        return;
      }
      if (result.status === 'invalid') {
        setBoot({ phase: 'onboarding', reason: 'invalid', mode: result.mode });
        return;
      }
      // An unreachable gateway still mounts the editor; the moderation check
      // reports the failure when it runs.
      if (result.status === 'unreachable') {
        console.warn(
          '[content-moderation] gateway unreachable:',
          result.message
        );
      }
      setBoot({ phase: 'ready' });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleInit = useCallback(async (instance: CreativeEditorSDK) => {
    await initContentModerationEditor(instance);
    // Created before the scene loads, so loading counts as an unchecked change.
    const moderation = new ModerationSession(instance);
    installExportGate(instance, moderation);
    addModerateButton(instance);

    // Load the scene
    await instance.load(`${DEMO_ASSETS_BASE_URL}/assets/example.scene`);

    setCesdk(instance);
    setSession(moderation);
  }, []);

  if (boot.phase === 'onboarding') {
    return (
      <div className="app-container">
        <OnboardingScreen reason={boot.reason} mode={boot.mode} />
      </div>
    );
  }

  return (
    <div className="app-container">
      {boot.phase === 'probing' ? (
        <div className="cesdk-wrapper" aria-hidden="true" />
      ) : (
        <>
          <CreativeEditor
            className="cesdk-wrapper"
            config={config}
            init={handleInit}
          />
          <Sidebar cesdk={cesdk} session={session} />
        </>
      )}
    </div>
  );
}
