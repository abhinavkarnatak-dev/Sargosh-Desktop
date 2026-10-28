import React from 'react';
import { createRoot } from 'react-dom/client';
import { StoreUpdatePreview } from './StoreUpdatePreview';
import { Tooltips } from '../Tooltips';
import '../styles.css';
import '../visual-refresh.css';
import './update-preview.css';

// Separate Vite HTML entry. Never load the normal App, audio runtime or native bridge.
if (import.meta.env.DEV) {
  document.documentElement.dataset.surface='app';
  createRoot(document.getElementById('root')!).render(<React.StrictMode><StoreUpdatePreview/><Tooltips/></React.StrictMode>);
}
