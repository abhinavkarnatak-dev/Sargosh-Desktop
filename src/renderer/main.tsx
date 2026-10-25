import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Overlay } from './Overlay';
import './styles.css';
const overlay = window.location.hash === '#overlay';
document.documentElement.dataset.surface = overlay ? 'overlay' : 'app';
createRoot(document.getElementById('root')!).render(<React.StrictMode>{overlay ? <Overlay /> : <App />}</React.StrictMode>);
