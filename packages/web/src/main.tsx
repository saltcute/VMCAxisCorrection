import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Dock } from './pages/Dock';
import { Full } from './pages/Full';
import './styles.css';

const isDock = location.pathname.replace(/\/+$/, '') === '/dock';
document.body.classList.toggle('dock', isDock);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<StrictMode>{isDock ? <Dock /> : <Full />}</StrictMode>);
}
