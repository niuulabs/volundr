import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@niuulabs/design-tokens/tokens.css';
import '@niuulabs/ui/styles.css';
import '@niuulabs/shell/styles.css';
import { App } from './App';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
