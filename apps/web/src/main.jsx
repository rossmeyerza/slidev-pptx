// @ts-check
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'bootstrap/js/dist/offcanvas';
import 'bootstrap/js/dist/dropdown';
import 'bootstrap/js/dist/toast';
import { App } from './App.jsx';
import './styles.css';

try {
  const saved = localStorage.getItem('slidev-agent-theme');
  if (saved === 'dark' || saved === 'light') {
    document.documentElement.setAttribute('data-bs-theme', saved);
  }
} catch {}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
