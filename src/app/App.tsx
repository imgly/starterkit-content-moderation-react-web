/**
 * Content Moderation Editor - Main App Component
 *
 * Two-column layout with CE.SDK editor and moderation sidebar.
 */

import { useEffect, useRef, useState } from 'react';

import CreativeEditorSDK from '@cesdk/cesdk-js';

import { initContentModerationEditor } from '../imgly';
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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let instance: CreativeEditorSDK | null = null;

    CreativeEditorSDK.create(containerRef.current, config)
      .then(async (sdk) => {
        instance = sdk;
        // Debug access (remove in production)
        (window as any).cesdk = sdk;
        await initContentModerationEditor(sdk);
        setCesdk(sdk);
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Failed to initialize CE.SDK:', error);
      });

    return () => {
      instance?.dispose();
    };
  }, []);

  return (
    <div className="app-container">
      <div className="cesdk-wrapper">
        <div ref={containerRef} className="cesdk-container" />
      </div>
      <Sidebar cesdk={cesdk} />
    </div>
  );
}
