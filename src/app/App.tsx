/**
 * Content Moderation Editor - Main App Component
 *
 * Two-column layout with CE.SDK editor and moderation sidebar.
 */

import { useCallback, useState } from 'react';

import CreativeEditor from '@cesdk/cesdk-js/react';
import type CreativeEditorSDK from '@cesdk/cesdk-js';

import { initContentModerationEditor } from '../imgly';
import { resolveAssetPath } from '../imgly/resolveAssetPath';
import { Sidebar } from './components/Sidebar';
import './App.css';

const config = {
  userId: 'starterkit-content-moderation-editor-user',
  ...(import.meta.env.CESDK_USE_LOCAL && {
    baseURL: import.meta.env.VITE_CESDK_ASSETS_BASE_URL
  }),
  role: 'Creator' as const
};

export default function App() {
  const [cesdk, setCesdk] = useState<CreativeEditorSDK | null>(null);

  const handleInit = useCallback(async (instance: CreativeEditorSDK) => {
    (window as any).cesdk = instance;
    await initContentModerationEditor(instance);

    // Load the scene
    await instance.loadFromURL(
      resolveAssetPath('/assets/example.scene')
    );

    setCesdk(instance);
  }, []);

  return (
    <div className="app-container">
      <CreativeEditor
        className="cesdk-wrapper"
        config={config}
        init={handleInit}
      />
      <Sidebar cesdk={cesdk} />
    </div>
  );
}
