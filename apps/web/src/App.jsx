// @ts-check
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { shouldAutoStartDashboardTour, shouldAutoStartWorkbenchTour, startDashboardTour, startWorkbenchTour } from './tour.js';

/* Icon bodies extracted from @iconify-json/mdi (Apache-2.0), 24x24 viewBox.
   Inline so the app stays self-contained — no icon font, no CDN. */
const ICONS = {
  chat: "<path fill='currentColor' d='M12 3C6.5 3 2 6.58 2 11a7.22 7.22 0 0 0 2.75 5.5c0 .6-.42 2.17-2.75 4.5c2.37-.11 4.64-1 6.47-2.5c1.14.33 2.34.5 3.53.5c5.5 0 10-3.58 10-8s-4.5-8-10-8m0 14c-4.42 0-8-2.69-8-6s3.58-6 8-6s8 2.69 8 6s-3.58 6-8 6m5-5v-2h-2v2zm-4 0v-2h-2v2zm-4 0v-2H7v2z'/>",
  magic: "<path fill='currentColor' d='M7.5 5.6L5 7l1.4-2.5L5 2l2.5 1.4L10 2L8.6 4.5L10 7zm12 9.8L22 14l-1.4 2.5L22 19l-2.5-1.4L17 19l1.4-2.5L17 14zM22 2l-1.4 2.5L22 7l-2.5-1.4L17 7l1.4-2.5L17 2l2.5 1.4zm-8.66 10.78l2.44-2.44l-2.12-2.12l-2.44 2.44zm1.03-5.49l2.34 2.34c.39.37.39 1.02 0 1.41L5.04 22.71c-.39.39-1.04.39-1.41 0l-2.34-2.34c-.39-.37-.39-1.02 0-1.41L12.96 7.29c.39-.39 1.04-.39 1.41 0'/>",
  share: "<path fill='currentColor' d='M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81c1.66 0 3-1.34 3-3s-1.34-3-3-3s-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.15c-.05.21-.08.43-.08.66c0 1.61 1.31 2.91 2.92 2.91s2.92-1.3 2.92-2.91s-1.31-2.92-2.92-2.92M18 4c.55 0 1 .45 1 1s-.45 1-1 1s-1-.45-1-1s.45-1 1-1M6 13c-.55 0-1-.45-1-1s.45-1 1-1s1 .45 1 1s-.45 1-1 1m12 7c-.55 0-1-.45-1-1s.45-1 1-1s1 .45 1 1s-.45 1-1 1'/>",
  pptx: "<path fill='currentColor' d='M9.8 13.4h2.5c1.5 0 2.16-.28 2.8-.82c.64-.55.9-1.33.9-2.35c0-.97-.25-1.73-.9-2.35c-.65-.59-1.27-.88-2.8-.88H8v10h1.8zM19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm-9.2 9V8.4h2.3c.66 0 1.17.25 1.5.6s.5.72.5 1.24c0 .56-.18.95-.5 1.26s-.7.5-1.38.5z'/>",
  presentation: "<path fill='currentColor' d='M2 3h8a2 2 0 0 1 2-2a2 2 0 0 1 2 2h8v2h-1v11h-5.75L17 22h-2l-1.75-6h-2.5L9 22H7l1.75-6H3V5H2zm3 2v9h14V5z'/>",
  people: "<path fill='currentColor' d='M12 5a3.5 3.5 0 0 0-3.5 3.5A3.5 3.5 0 0 0 12 12a3.5 3.5 0 0 0 3.5-3.5A3.5 3.5 0 0 0 12 5m0 2a1.5 1.5 0 0 1 1.5 1.5A1.5 1.5 0 0 1 12 10a1.5 1.5 0 0 1-1.5-1.5A1.5 1.5 0 0 1 12 7M5.5 8A2.5 2.5 0 0 0 3 10.5c0 .94.53 1.75 1.29 2.18c.36.2.77.32 1.21.32s.85-.12 1.21-.32c.37-.21.68-.51.91-.87A5.42 5.42 0 0 1 6.5 8.5v-.28c-.3-.14-.64-.22-1-.22m13 0c-.36 0-.7.08-1 .22v.28c0 1.2-.39 2.36-1.12 3.31c.12.19.25.34.4.49a2.48 2.48 0 0 0 1.72.7c.44 0 .85-.12 1.21-.32c.76-.43 1.29-1.24 1.29-2.18A2.5 2.5 0 0 0 18.5 8M12 14c-2.34 0-7 1.17-7 3.5V19h14v-1.5c0-2.33-4.66-3.5-7-3.5m-7.29.55C2.78 14.78 0 15.76 0 17.5V19h3v-1.93c0-1.01.69-1.85 1.71-2.52m14.58 0c1.02.67 1.71 1.51 1.71 2.52V19h3v-1.5c0-1.74-2.78-2.72-4.71-2.95M12 16c1.53 0 3.24.5 4.23 1H7.77c.99-.5 2.7-1 4.23-1'/>",
  link: "<path fill='currentColor' d='M10.59 13.41c.41.39.41 1.03 0 1.42c-.39.39-1.03.39-1.42 0a5.003 5.003 0 0 1 0-7.07l3.54-3.54a5.003 5.003 0 0 1 7.07 0a5.003 5.003 0 0 1 0 7.07l-1.49 1.49c.01-.82-.12-1.64-.4-2.42l.47-.48a2.98 2.98 0 0 0 0-4.24a2.98 2.98 0 0 0-4.24 0l-3.53 3.53a2.98 2.98 0 0 0 0 4.24m2.82-4.24c.39-.39 1.03-.39 1.42 0a5.003 5.003 0 0 1 0 7.07l-3.54 3.54a5.003 5.003 0 0 1-7.07 0a5.003 5.003 0 0 1 0-7.07l1.49-1.49c-.01.82.12 1.64.4 2.43l-.47.47a2.98 2.98 0 0 0 0 4.24a2.98 2.98 0 0 0 4.24 0l3.53-3.53a2.98 2.98 0 0 0 0-4.24a.973.973 0 0 1 0-1.42'/>",
  upload: "<path fill='currentColor' d='M2 12h2v5h16v-5h2v5c0 1.11-.89 2-2 2H4a2 2 0 0 1-2-2zM12 2L6.46 7.46l1.42 1.42L11 5.75V15h2V5.75l3.13 3.13l1.42-1.43z'/>",
  bolt: "<path fill='currentColor' d='M11 9.47V11h3.76L13 14.53V13H9.24zM13 1L6 15h5v8l7-14h-5z'/>",
  edit: "<path fill='currentColor' d='M10 21H5c-1.11 0-2-.89-2-2V5c0-1.11.89-2 2-2h14c1.11 0 2 .89 2 2v5.33c-.3-.12-.63-.19-.96-.19c-.37 0-.72.08-1.04.23V5H5v14h5.11l-.11.11zM7 9h10V7H7zm0 8h5.11L14 15.12V15H7zm0-4h9.12l.88-.88V11H7zm14.7.58l-1.28-1.28a.55.55 0 0 0-.77 0l-1 1l2.05 2.05l1-1a.55.55 0 0 0 0-.77M12 22h2.06l6.05-6.07l-2.05-2.05L12 19.94z'/>",
  eye: "<path fill='currentColor' d='M12 9a3 3 0 0 1 3 3a3 3 0 0 1-3 3a3 3 0 0 1-3-3a3 3 0 0 1 3-3m0-4.5c5 0 9.27 3.11 11 7.5c-1.73 4.39-6 7.5-11 7.5S2.73 16.39 1 12c1.73-4.39 6-7.5 11-7.5M3.18 12a9.821 9.821 0 0 0 17.64 0a9.821 9.821 0 0 0-17.64 0'/>",
  sparkles: "<path fill='currentColor' d='m19 1l-1.26 2.75L15 5l2.74 1.26L19 9l1.25-2.74L23 5l-2.75-1.25M9 4L6.5 9.5L1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5M19 15l-1.26 2.74L15 19l2.74 1.25L19 23l1.25-2.75L23 19l-2.75-1.26'/>",
  palette: "<path fill='currentColor' d='m2.5 19.6l1.3.6v-9L1.4 17c-.4 1.1.1 2.2 1.1 2.6M15.2 4.8l5 12l-7.3 3l-5-11.9v-.1zm.1-2c-.3 0-.5 0-.8.1L7.1 6c-.7.3-1.2 1-1.2 1.8c0 .2 0 .5.1.8l5 11.9c.3.8 1 1.2 1.8 1.2c.3 0 .5 0 .8-.1l7.4-3.1c1-.4 1.5-1.6 1.1-2.6L17.1 4c-.3-.8-1.1-1.2-1.8-1.2m-4.8 7.1c-.6 0-1-.4-1-1s.4-1 1-1s1 .5 1 1s-.4 1-1 1m-4.6 9.9c0 1.1.9 2 2 2h1.4l-3.4-8.3z'/>",
  timer: "<path fill='currentColor' d='M6 2h12v6l-4 4l4 4v6H6v-6l4-4l-4-4zm10 14.5l-4-4l-4 4V20h8zm-4-5l4-4V4H8v3.5zM10 6h4v.75l-2 2l-2-2z'/>",
};

function Icon({ name, size = 18, className = '' }) {
  const body = ICONS[name];
  if (!body) return null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`app-icon${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
import {
  addAdminDependency,
  bootstrapAdmin,
  acquireDeckLock,
  cancelAgentRun,
  createAdminComponent,
  createAdminLayout,
  createDeck,
  createShare,
  exportPptx,
  getDeck,
  getDeckAgentSettings,
  getAdminSettings,
  getExport,
  getPreviewBuild,
  getSharedDeck,
  getSession,
  identifyShareVisitor,
  importPptxDeck,
  inviteUser,
  listCollaborators,
  listDecks,
  listAgentModels,
  listScaffolds,
  listUsers,
  logout,
  publishDeck,
  queryKeys,
  requestLogin,
  restartDeckPreview,
  releaseDeckLock,
  removeCollaborator,
  revokeShare,
  saveCollaborator,
  sendShareInstruction,
  sendInstructionStream,
  startLivePreview,
  submitSharePassword,
  updateAdminSettings,
  updateDeckAgentSettings,
  updateUser,
} from './api.js';

export function App() {
  const queryClient = useQueryClient();
  const clientShareToken = clientShareTokenFromPath(window.location.pathname);
  const [toast, setToast] = useState(null);
  const [authNotice, setAuthNotice] = useState('');
  const [view, setView] = useState('dashboard');
  const [selectedDeckId, setSelectedDeckId] = useState('');
  const [exportJobs, setExportJobs] = useState({});
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('slidev-agent-theme') ?? 'light'; } catch { return 'light'; }
  });

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-bs-theme', next);
    setTheme(next);
    try { localStorage.setItem('slidev-agent-theme', next); } catch {}
  };

  const session = useQuery({
    queryKey: queryKeys.session,
    queryFn: getSession,
    enabled: !clientShareToken,
  });
  const user = session.data?.user ?? null;
  const hasUsers = session.data?.hasUsers ?? true;

  const decksQuery = useQuery({
    queryKey: queryKeys.decks,
    queryFn: listDecks,
    enabled: Boolean(user),
  });

  const scaffoldsQuery = useQuery({
    queryKey: queryKeys.scaffolds,
    queryFn: listScaffolds,
    enabled: Boolean(user),
  });

  const selectedDeckQuery = useQuery({
    queryKey: queryKeys.deck(selectedDeckId),
    queryFn: () => getDeck(selectedDeckId),
    enabled: Boolean(user && selectedDeckId),
  });

  const collaboratorsQuery = useQuery({
    queryKey: queryKeys.collaborators(selectedDeckId),
    queryFn: () => listCollaborators(selectedDeckId),
    enabled: Boolean(user && selectedDeckId && view === 'detail'),
    retry: false,
  });

  const decks = decksQuery.data ?? [];
  const selectedDeck = selectedDeckQuery.data ?? decks.find((deck) => deck.id === selectedDeckId) ?? null;

  const showDevLink = (result, label) => {
    const url = result.loginUrl ?? result.inviteUrl;
    if (!url && !result.sent) return;
    const fallbackReason = result.deliveryError
      ? `Email delivery failed (${result.deliveryError}); use this dev link:`
      : 'SMTP is not configured; use this dev link:';
    const text = url
      ? `${label}: ${result.sent ? 'Email sent.' : fallbackReason} ${url}`
      : `${label}: Email sent.`;
    user ? showToast(text, result.sent ? 'success' : 'warning', label) : setAuthNotice(text);
  };

  const showToast = (message, tone = 'info', title = 'Slidev Agent') => {
    setToast({ id: Date.now(), message, tone, title });
  };

  const refreshDeck = (deck) => {
    queryClient.setQueryData(queryKeys.deck(deck.id), deck);
    queryClient.invalidateQueries({ queryKey: queryKeys.decks });
  };

  if (clientShareToken) {
    return <ShareClient token={clientShareToken} />;
  }

  if (session.isLoading) {
    return <AuthScreen loading />;
  }

  if (!user) {
    return (
      <AuthScreen
        hasUsers={hasUsers}
        notice={authNotice}
        onLogin={async (email) => {
          const result = await requestLogin(email);
          showDevLink(result, 'Sign-in');
        }}
        onBootstrap={async (input) => {
          const result = await bootstrapAdmin(input);
          showDevLink(result, 'Bootstrap admin');
          await queryClient.invalidateQueries({ queryKey: queryKeys.session });
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        user={user}
        decks={decks}
        selectedDeckId={selectedDeckId}
        activeView={view}
        onSelectDeck={(deckId) => {
          setSelectedDeckId(deckId);
          setView('detail');
        }}
        onView={setView}
        onLogout={async () => {
          await logout().catch(() => null);
          setSelectedDeckId('');
          setView('dashboard');
          queryClient.clear();
          await queryClient.invalidateQueries({ queryKey: queryKeys.session });
        }}
      />

      <header className="app-topbar">
        <button type="button" data-bs-toggle="offcanvas" data-bs-target="#workspace-sidebar" className="btn btn-sm btn-ghost-inverse d-inline-flex align-items-center" aria-label="Open sidebar">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5" /></svg>
        </button>
        <a className="app-brand" href="#" onClick={(event) => { event.preventDefault(); setView('dashboard'); }}>
          <span className="brand-mark" aria-hidden="true">S</span>
          Slidev Agent
        </a>
        <span className="topbar-context">{topbarContext(view, selectedDeck)}</span>
        <button type="button" className="btn btn-sm btn-ghost-inverse ms-auto d-inline-flex align-items-center" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {theme === 'dark' ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6m0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8m10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0m-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707M3.757 6.464a.5.5 0 0 1-.707 0L1.636 5.05a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707" /></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278M4.858 1.311A7.27 7.27 0 0 0 1.025 7.71c0 4.02 3.279 7.276 7.319 7.276a7.32 7.32 0 0 0 5.205-2.162q-.506.063-1.029.063c-4.61 0-8.343-3.714-8.343-8.29 0-1.167.242-2.278.681-3.286" /></svg>
          )}
        </button>
      </header>

      <main className="app-main">
        <ToastHost toast={toast} onClose={() => setToast(null)} />

        {view === 'dashboard' ? (
          <DeckDashboard
            user={user}
            decks={decks}
            scaffolds={scaffoldsQuery.data ?? []}
            loading={decksQuery.isLoading}
            onSelectDeck={(deckId) => {
              setSelectedDeckId(deckId);
              setView('detail');
            }}
            onCreate={async (input) => {
              const deck = await createDeck({ ...input, source: 'react-web-v1' });
              refreshDeck(deck);
              await queryClient.invalidateQueries({ queryKey: queryKeys.previewBuild(deck.id) });
              setSelectedDeckId(deck.id);
              setView('detail');
            }}
            onImport={async (input) => {
              const deck = await importPptxDeck(input);
              refreshDeck(deck);
              await queryClient.invalidateQueries({ queryKey: queryKeys.previewBuild(deck.id) });
              setSelectedDeckId(deck.id);
              setView('detail');
            }}
          />
        ) : null}

        {view === 'detail' ? (
          <DeckDetail
            deck={selectedDeck}
            currentUser={user}
            loading={selectedDeckQuery.isLoading}
            exportJob={selectedDeck ? exportJobs[selectedDeck.id] : null}
            onWork={async () => {
              if (!selectedDeck) return;
              try {
                refreshDeck(await acquireDeckLock(selectedDeck.id));
                setView('workbench');
              } catch (error) {
                showToast(error instanceof Error ? error.message : 'Deck is locked by another editor.', 'warning', 'Deck lock');
              }
            }}
            onPublish={async () => selectedDeck && refreshDeck(await publishDeck(selectedDeck.id))}
            onExport={async () => {
              if (!selectedDeck) return;
              const result = await exportPptx(selectedDeck.id);
              const jobId = result.export?.id ?? result.id;
              const job = result.export ?? result;
              if (jobId) {
                setExportJobs((current) => ({ ...current, [selectedDeck.id]: job }));
                void pollExport(queryClient, selectedDeck.id, jobId, setExportJobs);
              }
              await queryClient.invalidateQueries({ queryKey: queryKeys.deck(selectedDeck.id) });
            }}
            onShare={async (input) => {
              if (!selectedDeck) return;
              await createShare(selectedDeck.id, input);
              await queryClient.invalidateQueries({ queryKey: queryKeys.deck(selectedDeck.id) });
            }}
            onRevokeShare={async (shareId) => {
              if (!selectedDeck) return;
              await revokeShare(selectedDeck.id, shareId);
              await queryClient.invalidateQueries({ queryKey: queryKeys.deck(selectedDeck.id) });
            }}
            collaborators={collaboratorsQuery.data ?? []}
            collaboratorsLoading={collaboratorsQuery.isLoading}
            onSaveCollaborator={async (input) => {
              if (!selectedDeck) return;
              await saveCollaborator(selectedDeck.id, input);
              await queryClient.invalidateQueries({ queryKey: queryKeys.collaborators(selectedDeck.id) });
            }}
            onRemoveCollaborator={async (userId) => {
              if (!selectedDeck) return;
              await removeCollaborator(selectedDeck.id, userId);
              await queryClient.invalidateQueries({ queryKey: queryKeys.collaborators(selectedDeck.id) });
              await queryClient.invalidateQueries({ queryKey: queryKeys.decks });
            }}
            onAdminTool={async (action, input) => {
              if (!selectedDeck) return null;
              const actions = {
                component: () => createAdminComponent(selectedDeck.id, input),
                layout: () => createAdminLayout(selectedDeck.id, input),
                dependency: () => addAdminDependency(selectedDeck.id, input),
                restartPreview: () => restartDeckPreview(selectedDeck.id),
              };
              const result = await actions[action]?.();
              await queryClient.invalidateQueries({ queryKey: queryKeys.livePreview(selectedDeck.id) });
              await queryClient.invalidateQueries({ queryKey: queryKeys.previewBuild(selectedDeck.id) });
              await queryClient.invalidateQueries({ queryKey: queryKeys.deck(selectedDeck.id) });
              return result;
            }}
            onLoadDeckAgentSettings={() => selectedDeck ? getDeckAgentSettings(selectedDeck.id) : null}
            onSaveDeckAgentSettings={async (agent) => {
              if (!selectedDeck) return null;
              const result = await updateDeckAgentSettings(selectedDeck.id, agent);
              await queryClient.invalidateQueries({ queryKey: queryKeys.deck(selectedDeck.id) });
              return result;
            }}
          />
        ) : null}

        {view === 'workbench' ? (
          <Workbench
            deck={selectedDeck}
            currentUser={user}
            onBack={async () => {
              if (selectedDeck) {
                await releaseDeckLock(selectedDeck.id).then(refreshDeck).catch(() => null);
              }
              setView('detail');
            }}
            onSend={async (instruction, onEvent) => {
              if (!selectedDeck) return;
              refreshDeck(await sendInstructionStream(selectedDeck.id, instruction, onEvent));
              await queryClient.invalidateQueries({ queryKey: queryKeys.previewBuild(selectedDeck.id) });
            }}
            onCancel={async (runId) => {
              if (!selectedDeck) return;
              await cancelAgentRun(selectedDeck.id, runId);
            }}
          />
        ) : null}

        {view === 'templates' ? <TemplatesView scaffolds={scaffoldsQuery.data ?? []} loading={scaffoldsQuery.isLoading} /> : null}

        {view === 'admin' && user.role === 'admin' ? (
          <AdminView
            scaffolds={scaffoldsQuery.data ?? []}
            onInvite={async (input) => {
              const result = await inviteUser(input);
              showDevLink(result, 'Invite');
            }}
            onSettingsSaved={() => {
              showToast('Settings saved.', 'success', 'Admin');
              queryClient.invalidateQueries({ queryKey: queryKeys.scaffolds });
            }}
          />
        ) : null}
      </main>
    </div>
  );
}

function AuthScreen({ loading = false, hasUsers = true, notice = '', onLogin, onBootstrap }) {
  const [email, setEmail] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <section className="auth-shell" data-bs-theme="light">
      <div className="card auth-card auth-card-split overflow-hidden shadow">
        <div className="row g-0">
        <div className="col-12 col-md-6 auth-intro">
          <span className="brand-mark mb-3" style={{ width: '2rem', height: '2rem', fontSize: '1rem' }} aria-hidden="true">S</span>
          <h1 className="h4 mb-1">Slidev Agent</h1>
          <p className="mb-0 small auth-intro-lead">Describe the deck. The agent builds it.</p>
          <ul className="auth-intro-points">
            <li>
              <span className="hero-step-icon"><Icon name="chat" size={18} /></span>
              <span>Brief an agent in plain language and it writes branded slides for you.</span>
            </li>
            <li>
              <span className="hero-step-icon"><Icon name="eye" size={18} /></span>
              <span>Watch the deck take shape in a live preview while the agent works.</span>
            </li>
            <li>
              <span className="hero-step-icon"><Icon name="share" size={18} /></span>
              <span>Share a secure client link or export a pixel-perfect PPTX.</span>
            </li>
          </ul>
        </div>
        <div className="col-12 col-md-6">
        <div className="card-body p-4">
        {notice ? <section className="alert alert-warning" role="alert">{notice}</section> : null}
        {loading ? <p className="text-body-secondary">Checking session...</p> : null}

        {!loading ? (
          <form
            className="d-grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await onLogin?.(email);
                setEmail('');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div>
              <label className="form-label" htmlFor="loginEmail">Email</label>
              <input className="form-control" id="loginEmail" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@company.com" required />
            </div>
            <button className="btn btn-primary" disabled={busy} type="submit">Send sign-in link</button>
          </form>
        ) : null}

        {!loading && !hasUsers ? (
          <form
            className="d-grid gap-3 mt-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await onBootstrap?.({ email: adminEmail, name: adminName });
                setAdminEmail('');
                setAdminName('');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div>
              <label className="form-label" htmlFor="bootstrapEmail">First admin email</label>
              <input className="form-control" id="bootstrapEmail" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} type="email" placeholder="admin@company.com" required />
            </div>
            <div>
              <label className="form-label" htmlFor="bootstrapName">Name</label>
              <input className="form-control" id="bootstrapName" value={adminName} onChange={(event) => setAdminName(event.target.value)} type="text" placeholder="Admin" />
            </div>
            <button className="btn btn-outline-primary" disabled={busy} type="submit">Create first admin</button>
          </form>
        ) : null}
        </div>
        </div>
        </div>
      </div>
    </section>
  );
}

function ShareClient({ token }) {
  const queryClient = useQueryClient();
  const shareQuery = useQuery({
    queryKey: queryKeys.share(token),
    queryFn: () => getSharedDeck(token),
  });
  const [password, setPassword] = useState('');
  const [visitorName, setVisitorName] = useState('');
  const [visitorEmail, setVisitorEmail] = useState('');
  const [instruction, setInstruction] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [previewReload, setPreviewReload] = useState(0);
  const [busy, setBusy] = useState('');
  const share = shareQuery.data?.share;
  const title = shareQuery.data?.title ?? share?.name ?? 'Shared deck';
  const deckUrl = `/share/${encodeURIComponent(token)}/deck/#/1`;

  if (shareQuery.isLoading) {
    return <CenteredPanel title="Shared deck" subtitle="Loading shared deck..." />;
  }

  if (shareQuery.isError) {
    return <CenteredPanel title="Shared deck unavailable" subtitle={shareQuery.error instanceof Error ? shareQuery.error.message : 'This share link could not be opened.'} tone="danger" />;
  }

  if (shareQuery.data?.passwordRequired) {
    return (
      <CenteredPanel title="Share password required" subtitle={`This deck link${share?.name ? ` for ${share.name}` : ''} is password protected.`}>
        <form
          className="d-grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            setBusy('password');
            try {
              await submitSharePassword(token, password);
              setPassword('');
              await queryClient.invalidateQueries({ queryKey: queryKeys.share(token) });
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'Could not continue.');
            } finally {
              setBusy('');
            }
          }}
        >
          {error ? <section className="alert alert-danger" role="alert">{error}</section> : null}
          <div>
            <label className="form-label" htmlFor="sharePassword">Password</label>
            <input className="form-control" id="sharePassword" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          <button className="btn btn-primary" disabled={busy === 'password'} type="submit">Continue</button>
        </form>
      </CenteredPanel>
    );
  }

  if (shareQuery.data?.visitorRequired) {
    return (
      <CenteredPanel title="Identify yourself" subtitle={`This editable deck link was shared with ${share?.name ?? 'you'}.`}>
        <form
          className="d-grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            setBusy('visitor');
            try {
              await identifyShareVisitor(token, { name: visitorName, email: visitorEmail });
              setVisitorName('');
              setVisitorEmail('');
              await queryClient.invalidateQueries({ queryKey: queryKeys.share(token) });
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'Could not continue.');
            } finally {
              setBusy('');
            }
          }}
        >
          {error ? <section className="alert alert-danger" role="alert">{error}</section> : null}
          <div>
            <label className="form-label" htmlFor="visitorName">Name</label>
            <input className="form-control" id="visitorName" value={visitorName} onChange={(event) => setVisitorName(event.target.value)} autoComplete="name" required />
          </div>
          <div>
            <label className="form-label" htmlFor="visitorEmail">Email</label>
            <input className="form-control" id="visitorEmail" type="email" value={visitorEmail} onChange={(event) => setVisitorEmail(event.target.value)} autoComplete="email" required />
          </div>
          <button className="btn btn-primary" disabled={busy === 'visitor'} type="submit">Continue</button>
        </form>
      </CenteredPanel>
    );
  }

  const canEdit = share?.permission === 'edit' && shareQuery.data?.visitor;
  return (
    <main className="share-client-shell">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-4">
        <div>
          <p className="page-eyebrow mb-1">{canEdit ? `Editing as ${shareQuery.data.visitor.name}` : 'Shared view'}</p>
          <h1 className="h3 mb-0">{title}</h1>
        </div>
        <div className="btn-toolbar gap-2">
          <a className="btn btn-outline-secondary" href={deckUrl} target="_blank" rel="noreferrer">Open deck</a>
          <button className="btn btn-outline-secondary" type="button" onClick={() => setPreviewReload((value) => value + 1)}>Reload preview</button>
        </div>
      </div>

      <div className={canEdit ? 'share-client-grid' : ''}>
        <section className="card shadow-sm">
          <div className="card-header d-flex align-items-center justify-content-between gap-2">
            <h2 className="h5 mb-0">Preview</h2>
            <span className="badge text-bg-secondary">{share?.permission === 'edit' ? 'Editable link' : 'View only'}</span>
          </div>
          <PreviewFrame src={deckUrl} reloadToken={previewReload} />
        </section>

        {canEdit ? (
          <section className="card shadow-sm">
            <div className="card-header">
              <h2 className="h5 mb-1">Client workbench</h2>
              <p className="text-body-secondary small mb-0">Request focused changes to this draft deck.</p>
            </div>
            <form
              className="card-body"
              onSubmit={async (event) => {
                event.preventDefault();
                const value = instruction.trim();
                if (!value) return;
                setError('');
                setStatus('');
                setBusy('instruction');
                try {
                  await sendShareInstruction(token, value);
                  setInstruction('');
                  setStatus('Change applied. Preview refreshed.');
                  setPreviewReload((current) => current + 1);
                  await queryClient.invalidateQueries({ queryKey: queryKeys.share(token) });
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : 'Could not apply the change.');
                } finally {
                  setBusy('');
                }
              }}
            >
              {error ? <section className="alert alert-danger" role="alert">{error}</section> : null}
              {status ? <section className="alert alert-success" role="status">{status}</section> : null}
              <label className="form-label" htmlFor="shareInstruction">Instruction</label>
              <textarea className="form-control mb-3" id="shareInstruction" rows={10} value={instruction} onChange={(event) => setInstruction(event.target.value)} required />
              <button className="btn btn-primary" disabled={busy === 'instruction'} type="submit">{busy === 'instruction' ? 'Sending...' : 'Send change'}</button>
            </form>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function CenteredPanel({ title, subtitle, children = null, tone = 'secondary' }) {
  return (
    <section className="auth-shell" data-bs-theme="light">
      <div className="card auth-card shadow">
        <div className="card-body p-4">
        <h1 className="h4 mb-2">{title}</h1>
        <p className={`text-${tone === 'danger' ? 'danger' : 'body-secondary'} mb-4`}>{subtitle}</p>
        {children}
        </div>
      </div>
    </section>
  );
}

function ToastHost({ toast, onClose }) {
  if (!toast) return null;
  const toneClass = toast.tone === 'success'
    ? 'text-bg-success'
    : toast.tone === 'warning'
      ? 'text-bg-warning'
      : toast.tone === 'danger'
        ? 'text-bg-danger'
        : 'text-bg-primary';

  return (
    <div className="toast-container position-fixed top-0 end-0 p-3">
      <div className={`toast show ${toneClass}`} role="status" aria-live="polite" aria-atomic="true">
        <div className="toast-header">
          <strong className="me-auto">{toast.title}</strong>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose}></button>
        </div>
        <div className="toast-body text-break">{toast.message}</div>
      </div>
    </div>
  );
}

function Sidebar({ user, decks, selectedDeckId, activeView, onSelectDeck, onView, onLogout }) {
  const [query, setQuery] = useState('');
  const filteredDecks = useMemo(
    () => decks.filter((deck) => !query || deck.title.toLowerCase().includes(query.toLowerCase())),
    [decks, query],
  );
  const drawerDismissAttrs = {
    'data-bs-dismiss': 'offcanvas',
    'data-bs-target': '#workspace-sidebar',
  };

  const initial = (user.name ?? user.email ?? '?')[0].toUpperCase();

  return (
    <nav className="workspace-sidebar offcanvas offcanvas-start" tabIndex="-1" id="workspace-sidebar" aria-label="Workspace navigation">
      <div className="offcanvas-header border-bottom">
        <a className="sidebar-brand" href="#" onClick={(event) => { event.preventDefault(); onView('dashboard'); }}>
          <span className="brand-mark" aria-hidden="true">S</span>
          Slidev Agent
        </a>
        <button type="button" className="btn-close" data-bs-dismiss="offcanvas" aria-label="Close" data-bs-target="#workspace-sidebar"></button>
      </div>

      <div className="offcanvas-body d-flex flex-column">
        <ul className="sidebar-nav mb-3 d-grid gap-1">
          <li><h6 className="sidebar-header">Workspace</h6></li>
          <li><hr className="sidebar-divider" /></li>
          <li className="nav-item">
            <button {...drawerDismissAttrs} className={`nav-link d-flex align-items-center gap-2 w-100 text-start ${['dashboard', 'detail', 'workbench'].includes(activeView) ? 'active' : ''}`} type="button" onClick={() => onView('dashboard')}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style={{ width: '1.5rem', flexShrink: 0 }} aria-hidden="true"><path d="M0 1.5A1.5 1.5 0 0 1 1.5 0h2A1.5 1.5 0 0 1 5 1.5v2A1.5 1.5 0 0 1 3.5 5h-2A1.5 1.5 0 0 1 0 3.5zM1.5 1a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5zM0 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm1 3v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2zm14-1V8a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v2zM2 8.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5m0 4a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5" /></svg>
              Decks
            </button>
          </li>
          <li className="nav-item">
            <button {...drawerDismissAttrs} className={`nav-link d-flex align-items-center gap-2 w-100 text-start ${activeView === 'templates' ? 'active' : ''}`} type="button" onClick={() => onView('templates')}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style={{ width: '1.5rem', flexShrink: 0 }} aria-hidden="true"><path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5z" /></svg>
              Templates
            </button>
          </li>
          {user.role === 'admin' ? (
            <li className="nav-item">
              <button {...drawerDismissAttrs} className={`nav-link d-flex align-items-center gap-2 w-100 text-start ${activeView === 'admin' ? 'active' : ''}`} type="button" onClick={() => onView('admin')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style={{ width: '1.5rem', flexShrink: 0 }} aria-hidden="true"><path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0" /><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.116z" /></svg>
                Admin
              </button>
            </li>
          ) : null}
        </ul>

        <button {...drawerDismissAttrs} className="btn btn-primary w-100 mb-3" type="button" onClick={() => onView('dashboard')}>New deck</button>

        <div className="mb-3">
          <label className="form-label" htmlFor="deckSearch">Search decks</label>
          <input className="form-control" id="deckSearch" type="search" placeholder="Search by title" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>

        <ul className="sidebar-nav deck-list mb-4" aria-live="polite">
          <li><h6 className="sidebar-header">Decks</h6></li>
          <li><hr className="sidebar-divider" /></li>
          {filteredDecks.length ? filteredDecks.map((deck) => (
            <li className="nav-item" key={deck.id}>
              <button {...drawerDismissAttrs} type="button" className={`nav-link w-100 text-start ${deck.id === selectedDeckId ? 'active' : ''}`} onClick={() => onSelectDeck(deck.id)}>
                <span className="d-flex align-items-center gap-2">
                  <span className={`status-dot ${deckStatusDot(deck)}`} aria-hidden="true"></span>
                  <strong className="text-truncate">{deck.title}</strong>
                </span>
                <span className="d-block small text-body-secondary ps-4">{deck.status} · {formatDate(deck.updatedAt)}</span>
              </button>
            </li>
          )) : <li className="text-body-secondary small px-3 py-2">No decks found.</li>}
        </ul>

        <div className="dropup mt-auto border-top border-secondary border-opacity-25 pt-3">
          <button className="btn btn-outline-secondary w-100 d-flex align-items-center gap-2 text-start" type="button" data-bs-toggle="dropdown" aria-expanded="false">
            <span className="badge text-bg-primary rounded-circle d-inline-flex align-items-center justify-content-center" style={{ width: '1.75rem', height: '1.75rem', fontSize: '.75rem' }}>{initial}</span>
            <span className="text-truncate flex-grow-1">{user.name || user.email}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path fillRule="evenodd" d="M7.646 4.646a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8 5.707 5.354 8.354a.5.5 0 1 1-.708-.708l3-3z" /></svg>
          </button>
          <ul className="dropdown-menu w-100 shadow-sm">
            <li>
              <button {...drawerDismissAttrs} className="dropdown-item d-flex align-items-center gap-2" type="button" onClick={() => {}}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z" /></svg>
                Profile
              </button>
            </li>
            <li><hr className="dropdown-divider" /></li>
            <li>
              <button {...drawerDismissAttrs} className="dropdown-item d-flex align-items-center gap-2" type="button" onClick={onLogout}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path fillRule="evenodd" d="M10 12.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v2a.5.5 0 0 0 1 0v-2A1.5 1.5 0 0 0 9.5 2h-8A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-2a.5.5 0 0 0-1 0z" /><path fillRule="evenodd" d="M15.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708.708L14.293 7.5H5.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708z" /></svg>
                Logout
              </button>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
}

function DeckDashboard({ user, decks, scaffolds, loading, onSelectDeck, onCreate, onImport }) {
  const [title, setTitle] = useState('');
  const [scaffold, setScaffold] = useState('');
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const defaultScaffold = scaffolds.find((item) => item.isDefault)?.key ?? scaffolds[0]?.key ?? '';
  const selectedScaffold = scaffold || defaultScaffold;
  useEffect(() => {
    if (loading || !shouldAutoStartDashboardTour()) return undefined;
    const timer = setTimeout(() => startDashboardTour(), 600);
    return () => clearTimeout(timer);
  }, [loading]);
  const sortedDecks = [...decks].sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')));
  const recentDecks = sortedDecks.slice(0, 6);

  return (
    <section>
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-4">
        <div>
          <p className="page-eyebrow mb-1">{user?.role === 'admin' ? 'Admin workspace' : 'Workspace'}</p>
          <h2 className="h3 mb-0">{user?.role === 'admin' ? 'Deck operations' : 'My decks'}</h2>
        </div>
      </div>

      <section className="dashboard-hero card shadow-sm mb-4" aria-label="How this works" data-tour="hero">
        <div className="card-body">
          <div className="hero-copy">
            <p className="page-eyebrow mb-2">Deck agent</p>
            <h2 className="hero-title">Describe the deck. The agent builds it.</h2>
            <p className="hero-lead mb-3">Chat with an agent that writes branded slides in front of you — then hand your client a live link or a pixel-perfect PowerPoint.</p>
            <button type="button" className="btn btn-sm hero-tour-btn" onClick={() => startDashboardTour()}>
              <Icon name="bolt" size={15} />
              Take the tour
            </button>
          </div>
          <ol className="hero-steps">
            <li>
              <span className="hero-step-icon"><Icon name="chat" size={20} /></span>
              <div>
                <strong>Brief it</strong>
                <span>Pick a branded template and describe the deck in plain language.</span>
              </div>
            </li>
            <li>
              <span className="hero-step-icon"><Icon name="magic" size={20} /></span>
              <div>
                <strong>Watch it build</strong>
                <span>The agent edits the slides while the preview updates live.</span>
              </div>
            </li>
            <li>
              <span className="hero-step-icon"><Icon name="share" size={20} /></span>
              <div>
                <strong>Share or export</strong>
                <span>Send a secure client link, or export the deck as PPTX.</span>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <div className="card shadow-sm mb-4" data-tour="start-deck">
        <div className="card-header d-flex align-items-center gap-2">
          <Icon name="sparkles" size={18} className="text-primary" />
          <div>
            <h3 className="h5 mb-1">Start a deck</h3>
            <p className="text-body-secondary small mb-0">The agent drafts the first version from your template and brief — usually in under a minute.</p>
          </div>
        </div>
        <div className="card-body">
          <form
            className="row g-3 align-items-end"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await onCreate({ title, scaffold: selectedScaffold, audience, goal });
                setTitle('');
                setScaffold('');
                setAudience('');
                setGoal('');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="col-12 col-lg-3">
              <label className="form-label" htmlFor="newDeckTitle">Deck title</label>
              <input className="form-control" id="newDeckTitle" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Quarterly product review" required />
            </div>
            <div className="col-12 col-lg-3">
              <label className="form-label" htmlFor="newDeckScaffold">Template</label>
              <select className="form-select" id="newDeckScaffold" value={selectedScaffold} onChange={(event) => setScaffold(event.target.value)} disabled={!scaffolds.length}>
                {scaffolds.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
              </select>
            </div>
            <div className="col-12 col-lg-2">
              <label className="form-label" htmlFor="newDeckAudience">Audience</label>
              <input className="form-control" id="newDeckAudience" value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="Leadership or client team" />
            </div>
            <div className="col-12 col-lg-2">
              <label className="form-label" htmlFor="newDeckGoal">Goal</label>
              <input className="form-control" id="newDeckGoal" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Decision this supports" />
            </div>
            <div className="col-12 col-lg-2">
              <button className="btn btn-primary w-100" disabled={busy || !selectedScaffold} type="submit">Create</button>
            </div>
          </form>
          <div className="border-top pt-3 mt-4">
            <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none d-inline-flex align-items-center gap-2" aria-expanded={showImport} onClick={() => setShowImport((value) => !value)}>
              <Icon name="upload" size={16} />
              {showImport ? 'Hide PowerPoint import' : 'Have an existing PowerPoint? Import it'}
            </button>
            {showImport ? (
              <form
                className="row g-3 align-items-end mt-1"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!importFile) return;
                  setImporting(true);
                  try {
                    await onImport({ file: importFile, title: importTitle });
                    setImportTitle('');
                    setImportFile(null);
                    event.currentTarget.reset();
                  } finally {
                    setImporting(false);
                  }
                }}
              >
                <div className="col-12">
                  <p className="text-body-secondary small mb-0">Imports create a rough draft from the PowerPoint content; expect to refine layout and copy with the agent afterwards.</p>
                </div>
                <div className="col-12 col-lg-4">
                  <label className="form-label" htmlFor="importTitle">Deck title</label>
                  <input className="form-control" id="importTitle" value={importTitle} onChange={(event) => setImportTitle(event.target.value)} placeholder="Use file name" />
                </div>
                <div className="col-12 col-lg-5">
                  <label className="form-label" htmlFor="importPptx">PowerPoint file</label>
                  <input className="form-control" id="importPptx" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} required />
                </div>
                <div className="col-12 col-lg-3">
                  <button className="btn btn-outline-primary w-100" disabled={importing || !importFile} type="submit">{importing ? 'Importing...' : 'Import PPTX'}</button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      </div>

      <DashboardSummary user={user} decks={decks} scaffolds={scaffolds} />

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
        <div>
          <h3 className="h5 mb-1">{user?.role === 'admin' ? 'Recent deck activity' : 'Recent work'}</h3>
          <p className="text-body-secondary small mb-0">{user?.role === 'admin' ? 'Latest decks visible across the workspace.' : 'Your latest visible decks and shared work.'}</p>
        </div>
      </div>
      <div className="deck-grid" data-tour="recent-decks">
        {loading ? <div className="card shadow-sm"><div className="card-body text-body-secondary">Loading decks...</div></div> : null}
        {!loading && !decks.length ? (
          <div className="card shadow-sm empty-state">
            <div className="card-body text-center py-5">
              <Icon name="presentation" size={40} className="text-body-secondary mb-3" />
              <h4 className="h5 mb-2">No decks yet</h4>
              <p className="text-body-secondary small mb-0 mx-auto" style={{ maxWidth: '24rem' }}>Start your first deck above — give it a title, pick a template, and the agent drafts the opening slides for you.</p>
            </div>
          </div>
        ) : null}
        {recentDecks.map((deck) => (
          <article className="card shadow-sm deck-card" key={deck.id}>
            <div className="card-body d-flex flex-column">
              <div className="d-flex align-items-center gap-2 mb-1">
                <span className={`status-dot ${deckStatusDot(deck)}`} aria-hidden="true"></span>
                <span className="text-body-secondary small text-capitalize">{deck.status}</span>
              </div>
              <h3 className="h5 mb-1">
                <button className="btn btn-link p-0 text-start text-body text-decoration-none stretched-link h5 mb-0" type="button" onClick={() => onSelectDeck(deck.id)}>{deck.title}</button>
              </h3>
              <p className="text-body-secondary small mb-2">Updated {formatDate(deck.updatedAt)}</p>
              <div className="d-flex flex-wrap gap-2 mt-auto">
                {deck.shares?.length ? <span className="badge text-bg-light border">{deck.shares.length} client link{deck.shares.length === 1 ? '' : 's'}</span> : null}
                {deck.activeEditorUserId ? <span className="badge text-bg-warning">Locked</span> : null}
                {deck.pptx?.status ? <span className={`badge ${exportStatusClass(deck.pptx.status)}`}>PPTX {formatExportStatus(deck.pptx.status)}</span> : null}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!loading && decks.length > recentDecks.length ? <p className="text-body-secondary small mt-3 mb-0">Showing {recentDecks.length} of {decks.length} decks. Use the sidebar search to open older decks.</p> : null}
    </section>
  );
}

function DashboardSummary({ user, decks, scaffolds }) {
  const stats = dashboardStats(decks, scaffolds);
  const admin = user?.role === 'admin';
  return (
    <section className="dashboard-summary mb-4" aria-label="Workspace summary" data-tour="summary">
      <article>
        <span className="page-eyebrow d-inline-flex align-items-center gap-1"><Icon name="presentation" size={14} />{admin ? 'Workspace decks' : 'Visible decks'}</span>
        <div className="summary-value">{stats.totalDecks}</div>
        <p className="text-body-secondary small mb-0">{stats.publishedDecks} published · {stats.draftDecks} draft</p>
      </article>
      <article>
        <span className="page-eyebrow d-inline-flex align-items-center gap-1"><Icon name="link" size={14} />{admin ? 'Client exposure' : 'Client links'}</span>
        <div className="summary-value">{stats.shareLinks}</div>
        <p className="text-body-secondary small mb-0">{stats.editLinks} editable · {stats.passwordLinks} password protected</p>
      </article>
      <article>
        <span className="page-eyebrow d-inline-flex align-items-center gap-1"><Icon name="timer" size={14} />{admin ? 'Operations' : 'In progress'}</span>
        <div className="summary-value">{admin ? stats.lockedDecks : stats.exportingDecks}</div>
        <p className="text-body-secondary small mb-0">{admin ? `${stats.exportingDecks} exporting · ${stats.failedExports} failed exports` : `${stats.lockedDecks} locked · ${stats.failedExports} failed exports`}</p>
      </article>
      <article>
        <span className="page-eyebrow d-inline-flex align-items-center gap-1"><Icon name="palette" size={14} />Templates</span>
        <div className="summary-value">{stats.activeTemplates}</div>
        <p className="text-body-secondary small mb-0">{stats.adminTemplates} admin-only · {stats.defaultTemplate || 'No default'} default</p>
      </article>
    </section>
  );
}

function DeckDetail({ deck, currentUser, loading, exportJob, onWork, onPublish, onExport, onShare, onRevokeShare, collaborators = [], collaboratorsLoading = false, onSaveCollaborator, onRemoveCollaborator, onAdminTool, onLoadDeckAgentSettings, onSaveDeckAgentSettings }) {
  const [shareName, setShareName] = useState('');
  const [shareEmail, setShareEmail] = useState('');
  const [sharePermission, setSharePermission] = useState('view');
  const [sharePassword, setSharePassword] = useState('');
  const [collaboratorEmail, setCollaboratorEmail] = useState('');
  const [collaboratorRole, setCollaboratorRole] = useState('viewer');
  const [exporting, setExporting] = useState(false);
  const previewBuildQuery = useQuery({
    queryKey: queryKeys.previewBuild(deck?.id ?? ''),
    queryFn: () => getPreviewBuild(deck.id),
    enabled: Boolean(deck?.id) && !isCustomRuntimeDeck(deck),
    refetchInterval: (query) => query.state.data?.status === 'building' ? 2000 : false,
  });

  if (loading) return <p className="text-body-secondary">Loading deck...</p>;
  if (!deck) return <p className="text-body-secondary">Select a deck from the list.</p>;
  const currentExport = exportJob ?? deck.pptx ?? null;
  const exportStatus = currentExport?.status ?? 'not_exported';
  const exportInProgress = exporting || ['queued', 'running'].includes(String(exportStatus).toLowerCase());
  const previewBuild = previewBuildQuery.data ?? deck.previewBuild ?? null;
  const customRuntime = isCustomRuntimeDeck(deck);

  return (
    <section>
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-4">
        <div>
          <p className="page-eyebrow mb-1 d-flex align-items-center gap-2">
            <span className={`status-dot ${deckStatusDot(deck)}`} aria-hidden="true"></span>
            {deck.status} · Updated {formatDate(deck.updatedAt)}
          </p>
          <h2 className="h3 mb-1">{deck.title}</h2>
          <p className="text-body-secondary small mb-0">{deck.owner} · <span className="text-mono">{deck.id}</span></p>
        </div>
        <div className="btn-toolbar gap-2" role="toolbar" aria-label="Deck actions">
          <button className="btn btn-primary" type="button" onClick={onWork}>Work on this</button>
          <a className="btn btn-outline-secondary" href={deck.previewUrl || '#'} target="_blank" rel="noreferrer">Open preview</a>
          <button className="btn btn-outline-secondary" type="button" onClick={onPublish}>Publish</button>
          <button
            className="btn btn-outline-secondary"
            type="button"
            disabled={exportInProgress}
            onClick={async () => {
              setExporting(true);
              try {
                await onExport?.();
              } finally {
                setExporting(false);
              }
            }}
          >
            {exportInProgress ? 'Exporting...' : 'Export PPTX'}
          </button>
        </div>
      </div>

      <div className="row g-3 align-items-start">
        <section className="col-12 col-xl-8">
          <section className="card shadow-sm">
            <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
              <h3 className="h5 mb-0">Preview</h3>
              <div className="btn-toolbar gap-2">
                {customRuntime ? <span className="badge text-bg-success">Custom runtime</span> : null}
                {!customRuntime && previewBuild ? <span className={`badge ${previewBuildStatusClass(previewBuild.status)}`}>{formatPreviewBuildStatus(previewBuild.status)}</span> : null}
                {!customRuntime ? <button className="btn btn-outline-secondary btn-sm" type="button" disabled={previewBuildQuery.isFetching} onClick={() => previewBuildQuery.refetch()}>Refresh status</button> : null}
              </div>
            </div>
            {previewBuild?.error ? <section className="alert alert-danger m-3 mb-0 py-2" role="alert">{previewBuild.error}</section> : null}
            <PreviewFrame src={deck.previewUrl} />
          </section>
        </section>

        <section className="col-12 col-xl-4">
          <section className="card shadow-sm mb-3">
            <div className="card-header">
              <h3 className="h5 mb-1">Client share links</h3>
              <p className="text-body-secondary small mb-0">Create named client links with view/edit access.</p>
            </div>
            <div className="card-body border-bottom">
              <form
                className="d-grid gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await onShare({
                    name: shareName,
                    email: shareEmail,
                    permission: sharePermission,
                    password: sharePassword,
                  });
                  setShareName('');
                  setShareEmail('');
                  setSharePermission('view');
                  setSharePassword('');
                }}
              >
                <input className="form-control" value={shareName} onChange={(event) => setShareName(event.target.value)} placeholder="Client name" required />
                <input className="form-control" value={shareEmail} onChange={(event) => setShareEmail(event.target.value)} type="email" placeholder="client@example.com" required />
                <select className="form-select" value={sharePermission} onChange={(event) => setSharePermission(event.target.value)}>
                  <option value="view">View only</option>
                  <option value="edit">Can request edits</option>
                </select>
                <input className="form-control" value={sharePassword} onChange={(event) => setSharePassword(event.target.value)} type="password" placeholder="Optional password" />
                <button className="btn btn-outline-secondary" type="submit">Create link</button>
              </form>
            </div>
            <ul className="list-group list-group-flush">
              {deck.shares?.length ? deck.shares.map((share) => (
                <li className="list-group-item" key={share.id ?? share.url}>
                  <div className="d-flex align-items-start justify-content-between gap-2">
                    <span>
                      <strong className="d-block">{share.name ?? 'Client'}</strong>
                      <span className="d-block small text-body-secondary">{share.email ?? 'Email not provided'}</span>
                    </span>
                    <button className="btn btn-outline-danger btn-sm" type="button" onClick={() => onRevokeShare?.(share.id)}>Revoke</button>
                  </div>
                  <span className="d-block small text-body-secondary">{share.permission === 'edit' ? 'Can request edits' : 'View only'}{share.hasPassword ? ' · Password protected' : ''}</span>
                  <a className="d-block small" href={share.url} target="_blank" rel="noreferrer">{share.url}</a>
                </li>
              )) : <li className="list-group-item text-body-secondary small">No client links yet.</li>}
            </ul>
          </section>

          <section className="card shadow-sm mb-3">
            <div className="card-header">
              <h3 className="h5 mb-1">Internal collaborators</h3>
              <p className="text-body-secondary small mb-0">Grant existing teammates deck-level view or edit access.</p>
            </div>
            <div className="card-body border-bottom">
              <form
                className="d-grid gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await onSaveCollaborator?.({
                    email: collaboratorEmail,
                    role: collaboratorRole,
                  });
                  setCollaboratorEmail('');
                  setCollaboratorRole('viewer');
                }}
              >
                <input className="form-control" value={collaboratorEmail} onChange={(event) => setCollaboratorEmail(event.target.value)} type="email" placeholder="teammate@example.com" required />
                <select className="form-select" value={collaboratorRole} onChange={(event) => setCollaboratorRole(event.target.value)}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <button className="btn btn-outline-secondary" type="submit">Add collaborator</button>
              </form>
            </div>
            <ul className="list-group list-group-flush">
              {collaboratorsLoading ? <li className="list-group-item text-body-secondary small">Loading collaborators...</li> : null}
              {!collaboratorsLoading && collaborators.length ? collaborators.map((collaborator) => (
                <li className="list-group-item" key={collaborator.id}>
                  <div className="d-flex align-items-start justify-content-between gap-2">
                    <span>
                      <strong className="d-block">{collaborator.user?.name ?? collaborator.user?.email ?? collaborator.userId}</strong>
                      <span className="d-block small text-body-secondary">{collaborator.user?.email ?? collaborator.userId}</span>
                    </span>
                    <button className="btn btn-outline-danger btn-sm" type="button" onClick={() => onRemoveCollaborator?.(collaborator.userId)}>Remove</button>
                  </div>
                  <div className="d-flex align-items-center justify-content-between gap-2 mt-2">
                    <span className="badge text-bg-light">{collaborator.role}</span>
                    <select
                      className="form-select form-select-sm collaborator-role-select"
                      value={collaborator.role}
                      onChange={(event) => onSaveCollaborator?.({ userId: collaborator.userId, role: event.target.value })}
                      aria-label="Collaborator role"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                  </div>
                </li>
              )) : null}
              {!collaboratorsLoading && !collaborators.length ? <li className="list-group-item text-body-secondary small">No internal collaborators yet.</li> : null}
            </ul>
          </section>

          <section className="card shadow-sm">
            <div className="card-header">
              <div className="d-flex align-items-center justify-content-between gap-2">
                <div>
                  <h3 className="h5 mb-1">PPTX export</h3>
                  <p className="text-body-secondary small mb-0">Latest job {currentExport?.id ? currentExport.id.slice(0, 8) : 'not started'}</p>
                </div>
                <span className={`badge ${exportStatusClass(exportStatus)}`}>{formatExportStatus(exportStatus)}</span>
              </div>
            </div>
            <div className="card-body export-card">
              {exportInProgress ? <div className="progress mb-3" role="progressbar" aria-label="PPTX export running"><div className="progress-bar progress-bar-striped progress-bar-animated" style={{ width: '100%' }} /></div> : null}
              {currentExport?.updatedAt ? <p className="text-body-secondary small mb-2">Updated {formatDate(currentExport.updatedAt)}</p> : null}
              {currentExport?.error ? <section className="alert alert-danger py-2 mb-3" role="alert">{currentExport.error}</section> : null}
              {currentExport?.downloadUrl ? <a className="btn btn-outline-primary btn-sm" href={currentExport.downloadUrl} target="_blank" rel="noreferrer">Download PPTX</a> : <span className="text-body-secondary">Use Export PPTX to start a new export.</span>}
              {currentExport?.verification ? (
                <p className="text-body-secondary small mb-0 mt-2">Verified {currentExport.verification.slideCount} slides and {currentExport.verification.imageCount} images.</p>
              ) : null}
            </div>
          </section>
          {currentUser?.role === 'admin' ? <DeckAdminTools deck={deck} onAdminTool={onAdminTool} onLoadAgentSettings={onLoadDeckAgentSettings} onSaveAgentSettings={onSaveDeckAgentSettings} /> : null}
        </section>
      </div>
    </section>
  );
}

function DeckAdminTools({ deck, onAdminTool, onLoadAgentSettings, onSaveAgentSettings }) {
  const [componentName, setComponentName] = useState('');
  const [layoutName, setLayoutName] = useState('');
  const [dependencyName, setDependencyName] = useState('');
  const [dependencyVersion, setDependencyVersion] = useState('');
  const [installDependency, setInstallDependency] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const [agentBaseUrl, setAgentBaseUrl] = useState('');
  const [agentMemberModel, setAgentMemberModel] = useState('');
  const [agentAdminModel, setAgentAdminModel] = useState('');
  const [agentTimeoutMs, setAgentTimeoutMs] = useState('');

  React.useEffect(() => {
    let ignore = false;
    onLoadAgentSettings?.().then((agent) => {
      if (ignore || !agent) return;
      setAgentBaseUrl(agent.baseUrl ?? deck?.agent?.baseUrl ?? '');
      setAgentMemberModel(agent.memberModel ?? deck?.agent?.memberModel ?? '');
      setAgentAdminModel(agent.adminModel ?? deck?.agent?.adminModel ?? '');
      setAgentTimeoutMs(agent.timeoutMs ? String(agent.timeoutMs) : '');
    }).catch(() => null);
    return () => { ignore = true; };
  }, [deck?.id]);

  const run = async (action, input, success) => {
    setBusy(action);
    setStatus('');
    try {
      await onAdminTool?.(action, input);
      setStatus(success);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Admin tool failed.');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="card shadow-sm mt-3">
      <div className="card-header">
        <h3 className="h5 mb-1">Admin deck tools</h3>
        <p className="text-body-secondary small mb-0">Create deck-local Vue files, manage dependencies, and rebuild the draft preview.</p>
      </div>
      <div className="card-body">
        {status ? <section className="alert alert-info py-2" role="status">{status}</section> : null}
        <form
          className="d-grid gap-2 mb-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy('agentSettings');
            setStatus('');
            try {
              await onSaveAgentSettings?.({
                baseUrl: agentBaseUrl,
                memberModel: agentMemberModel,
                adminModel: agentAdminModel,
                timeoutMs: agentTimeoutMs ? Number(agentTimeoutMs) : undefined,
              });
              setStatus('Deck agent settings saved.');
            } catch (error) {
              setStatus(error instanceof Error ? error.message : 'Agent settings failed.');
            } finally {
              setBusy('');
            }
          }}
        >
          <label className="form-label" htmlFor="deckAgentBaseUrl">Deck agent overrides</label>
          <input className="form-control" id="deckAgentBaseUrl" value={agentBaseUrl} onChange={(event) => setAgentBaseUrl(event.target.value)} placeholder="Model provider base URL" />
          <input className="form-control" value={agentMemberModel} onChange={(event) => setAgentMemberModel(event.target.value)} placeholder="Employee model" />
          <input className="form-control" value={agentAdminModel} onChange={(event) => setAgentAdminModel(event.target.value)} placeholder="Admin model" />
          <input className="form-control" value={agentTimeoutMs} onChange={(event) => setAgentTimeoutMs(event.target.value)} inputMode="numeric" placeholder="Timeout ms" />
          <button className="btn btn-outline-secondary" disabled={busy === 'agentSettings'} type="submit">Save agent settings</button>
        </form>
        <form
          className="d-grid gap-2 mb-3"
          onSubmit={async (event) => {
            event.preventDefault();
            await run('component', { name: componentName }, 'Component created.');
            setComponentName('');
          }}
        >
          <label className="form-label" htmlFor="adminComponentName">Component</label>
          <div className="input-group">
            <input className="form-control" id="adminComponentName" value={componentName} onChange={(event) => setComponentName(event.target.value)} placeholder="MetricBadge" required />
            <button className="btn btn-outline-secondary" disabled={busy === 'component'} type="submit">Create</button>
          </div>
        </form>
        <form
          className="d-grid gap-2 mb-3"
          onSubmit={async (event) => {
            event.preventDefault();
            await run('layout', { name: layoutName }, 'Layout created.');
            setLayoutName('');
          }}
        >
          <label className="form-label" htmlFor="adminLayoutName">Layout</label>
          <div className="input-group">
            <input className="form-control" id="adminLayoutName" value={layoutName} onChange={(event) => setLayoutName(event.target.value)} placeholder="metric-grid" required />
            <button className="btn btn-outline-secondary" disabled={busy === 'layout'} type="submit">Create</button>
          </div>
        </form>
        <form
          className="d-grid gap-2 mb-3"
          onSubmit={async (event) => {
            event.preventDefault();
            await run('dependency', { name: dependencyName, version: dependencyVersion, install: installDependency }, 'Dependency saved.');
            setDependencyName('');
            setDependencyVersion('');
            setInstallDependency(false);
          }}
        >
          <label className="form-label" htmlFor="adminDependencyName">Dependency</label>
          <input className="form-control" id="adminDependencyName" value={dependencyName} onChange={(event) => setDependencyName(event.target.value)} placeholder="@slidev/client" required />
          <input className="form-control" value={dependencyVersion} onChange={(event) => setDependencyVersion(event.target.value)} placeholder="Version or dist tag" />
          <div className="form-check">
            <input className="form-check-input" id="adminDependencyInstall" type="checkbox" checked={installDependency} onChange={(event) => setInstallDependency(event.target.checked)} />
            <label className="form-check-label" htmlFor="adminDependencyInstall">Run npm install</label>
          </div>
          <button className="btn btn-outline-secondary" disabled={busy === 'dependency'} type="submit">Add dependency</button>
        </form>
        <button className="btn btn-outline-secondary w-100" disabled={busy === 'restartPreview'} type="button" onClick={() => run('restartPreview', {}, 'Draft rebuild started. Reload the preview frame in a moment.')}>Rebuild draft preview</button>
      </div>
    </section>
  );
}

function Workbench({ deck, currentUser, onBack, onSend, onCancel }) {
  const [instruction, setInstruction] = useState('');
  const [sendError, setSendError] = useState('');
  const [streamStatus, setStreamStatus] = useState('');
  const [streamText, setStreamText] = useState('');
  const [currentRunId, setCurrentRunId] = useState('');
  const [sending, setSending] = useState(false);
  const [previewReload, setPreviewReload] = useState(0);
  const livePreview = useQuery({
    queryKey: queryKeys.livePreview(deck?.id ?? ''),
    queryFn: () => startLivePreview(deck.id),
    enabled: Boolean(deck?.id),
    staleTime: 30_000,
    retry: 1,
  });
  useEffect(() => {
    if (!deck?.id || !shouldAutoStartWorkbenchTour()) return undefined;
    const timer = setTimeout(() => startWorkbenchTour(), 800);
    return () => clearTimeout(timer);
  }, [deck?.id]);
  if (!deck) return <p className="text-body-secondary">Select a deck first.</p>;

  const customRuntime = isCustomRuntimeDeck(deck);
  const previewUrl = livePreview.data?.url ?? deck.previewUrl;
  const lockedByOther = Boolean(deck.activeEditorUserId && deck.activeEditorUserId !== currentUser?.id);
  const previewStatus = customRuntime ? 'custom' : livePreview.isError ? 'fallback' : livePreview.isFetching ? 'starting' : 'draft';

  return (
    <section>
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-4">
        <div>
          <p className="page-eyebrow mb-1">Workbench</p>
          <h2 className="h3 mb-0">{deck.title}</h2>
        </div>
        <button className="btn btn-outline-secondary" type="button" onClick={onBack}>Back to deck</button>
      </div>

      <div className="workbench-grid">
        <section className="card shadow-sm" data-tour="workbench-preview">
          <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-3">
            <div>
              <h3 className="h5 mb-1">Deck preview</h3>
              <span className={`badge ${previewStatusClass(previewStatus)}`}>{formatPreviewStatus(previewStatus)}</span>
            </div>
            <div className="btn-toolbar gap-2">
              <button className="btn btn-outline-secondary btn-sm" type="button" disabled={livePreview.isFetching} onClick={() => livePreview.refetch()}>Refresh preview</button>
              <button className="btn btn-outline-secondary btn-sm" type="button" onClick={() => setPreviewReload((value) => value + 1)}>Reload frame</button>
            </div>
          </div>
          <PreviewFrame src={previewUrl} workbench reloadToken={previewReload} />
        </section>
        <section className="card shadow-sm workbench-chat" data-tour="workbench-chat">
          <div className="card-header d-flex align-items-center gap-2">
            <Icon name="chat" size={18} className="text-primary" />
            <div>
              <h3 className="h5 mb-0">Chat</h3>
              <p className="text-body-secondary small mb-0">The agent edits the slide files directly; the preview updates as it works.</p>
            </div>
          </div>
          <div className="card-body border-bottom instruction-stream">
            {deck.messages?.length ? deck.messages.map((message, index) => (
              <article className={`chat-msg ${message.role === 'user' ? 'is-user' : 'is-agent'}`} key={`${message.role}-${index}`}>
                <span className="chat-role">{message.role === 'user' ? 'You' : 'Agent'}</span>
                {message.content}
              </article>
            )) : (
              <div className="chat-empty">
                <p className="text-body-secondary small mb-2">Tell the agent what this deck should say — it drafts, restyles, and reorders slides on request. Try one of these:</p>
                <div className="d-flex flex-wrap gap-2">
                  {[
                    'Add an agenda slide after the cover',
                    'Rewrite the results slide for a C-level audience',
                    'Tighten the copy across all slides',
                    'Add a closing slide with next steps and owners',
                  ].map((suggestion) => (
                    <button key={suggestion} type="button" className="btn btn-outline-secondary btn-sm suggestion-chip" onClick={() => setInstruction(suggestion)}>{suggestion}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="card-body">
            {sendError ? <section className="alert alert-danger" role="alert">{sendError}</section> : null}
            {lockedByOther ? <section className="alert alert-warning" role="alert">This deck is locked by another editor. You can view the preview, but edits are disabled.</section> : null}
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const value = instruction.trim();
                if (!value || lockedByOther) return;
                setSending(true);
                setSendError('');
                setStreamStatus('starting');
                setStreamText('');
                setCurrentRunId('');
                setInstruction('');
                try {
	                  await onSend(value, (event) => {
	                    if (event.event === 'run') setCurrentRunId(event.data?.run?.id ?? '');
	                    if (event.event === 'status') setStreamStatus(event.data?.status ?? '');
	                    if (event.event === 'token') setStreamText((current) => `${current}${event.data?.token ?? ''}`.slice(-2000));
	                    if (event.event === 'file_change') setStreamStatus('preview updating');
	                    if (event.event === 'done') setStreamStatus('done');
	                  });
                } catch (error) {
                  setInstruction(value);
                  setSendError(error instanceof Error ? error.message : 'Instruction failed.');
	                } finally {
	                  setSending(false);
	                  setStreamStatus('');
	                  setStreamText('');
	                  setCurrentRunId('');
	                }
              }}
            >
              <label className="form-label" htmlFor="instructionInput">Instruction</label>
	              <textarea className="form-control" id="instructionInput" rows={6} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Ask the agent to revise the deck." disabled={sending || lockedByOther} />
	              {streamText ? <pre className="agent-stream-preview mt-3 mb-0">{streamText}</pre> : null}
	              <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3">
                <span className="text-body-secondary small">{sending ? `Agent: ${formatStreamStatus(streamStatus)}` : 'Changes are applied to the selected deck thread.'}</span>
                <div className="btn-toolbar gap-2">
                  {sending && currentRunId ? (
                    <button className="btn btn-outline-danger" type="button" onClick={() => onCancel?.(currentRunId)}>Cancel</button>
                  ) : null}
                  <button className="btn btn-primary" disabled={sending || lockedByOther} type="submit">{sending ? 'Sending...' : 'Send'}</button>
                </div>
              </div>
            </form>
          </div>
        </section>
      </div>
    </section>
  );
}

function PreviewFrame({ src, workbench = false, reloadToken = 0 }) {
  const [loaded, setLoaded] = useState(false);
  const href = src ? new URL(src, window.location.origin).href : 'about:blank';
  React.useEffect(() => {
    setLoaded(false);
  }, [href, reloadToken]);
  return (
    <div className={`preview-frame-wrap${workbench ? ' workbench-preview' : ''}`}>
      {src ? <iframe key={`${href}:${reloadToken}`} src={href} title="Slidev preview" onLoad={() => setLoaded(true)} /> : null}
      {!src || !loaded ? (
        <div className="empty-preview">
          {src ? (
            <span className="spinner-border text-light" role="status">
              <span className="visually-hidden">Loading preview...</span>
            </span>
          ) : (
            <span>No preview loaded</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TemplatesView({ scaffolds, loading }) {
  return (
    <section>
      <p className="page-eyebrow mb-1">Workspace</p>
      <h2 className="h3 mb-1">Templates</h2>
      <p className="text-body-secondary mb-4" style={{ maxWidth: '44rem' }}>Every deck starts from a template: it carries the brand — fonts, colors, slide layouts — so the agent designs within your identity instead of from a blank page. Admins curate which templates are available.</p>
      <div className="row g-3">
        {loading ? <div className="col-12"><div className="card shadow-sm"><div className="card-body text-body-secondary">Loading templates...</div></div></div> : null}
        {!loading && !scaffolds.length ? <div className="col-12"><div className="card shadow-sm"><div className="card-body text-body-secondary">No templates found.</div></div></div> : null}
        {scaffolds.map((scaffold) => (
          <article className="col-12 col-lg-6" key={scaffold.key}>
            <div className="card shadow-sm h-100">
              <div className="card-body d-flex gap-3">
                <span className="hero-step-icon template-icon" aria-hidden="true"><Icon name="palette" size={20} /></span>
                <div>
                  <div className="d-flex align-items-start justify-content-between gap-2 mb-2">
                    <h3 className="h5 mb-0">{scaffold.name}</h3>
                    {scaffold.isDefault ? <span className="badge text-bg-primary">Default</span> : null}
                  </div>
                  <p className="text-body-secondary small mb-0">{scaffold.description || scaffold.key}</p>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AdminView({ scaffolds, onInvite, onSettingsSaved }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('employee');
  const [status, setStatus] = useState('');
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: getAdminSettings });
  const queryClient = useQueryClient();
  const updateUserMutation = useMutation({
    mutationFn: ({ userId, patch }) => updateUser(userId, patch),
    onSuccess: () => {
      setStatus('User updated.');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => {
      setStatus(error instanceof Error ? error.message : 'Could not update user.');
    },
  });
  return (
    <section>
      <p className="page-eyebrow mb-1">Admin</p>
      <h2 className="h3 mb-4">Users</h2>
      {status ? <section className="alert alert-info py-2" role="status">{status}</section> : null}
      <div className="card shadow-sm">
        <div className="card-body">
          <form
            className="row g-3 align-items-end"
            onSubmit={async (event) => {
              event.preventDefault();
              await onInvite({ email, name, role });
              await queryClient.invalidateQueries({ queryKey: ['users'] });
              setEmail('');
              setName('');
              setRole('employee');
            }}
          >
            <div className="col-12 col-lg-4">
              <label className="form-label" htmlFor="inviteEmail">Email</label>
              <input className="form-control" id="inviteEmail" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="teammate@company.com" required />
            </div>
            <div className="col-12 col-lg-3">
              <label className="form-label" htmlFor="inviteName">Name</label>
              <input className="form-control" id="inviteName" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
            </div>
            <div className="col-12 col-lg-3">
              <label className="form-label" htmlFor="inviteRole">Role</label>
              <select className="form-select" id="inviteRole" value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="col-12 col-lg-2">
              <button className="btn btn-primary w-100" type="submit">Invite</button>
            </div>
          </form>
        </div>
      </div>
      <AdminSettings
        settings={settingsQuery.data}
        loading={settingsQuery.isLoading}
        onSave={async (input) => {
          await updateAdminSettings(input);
          await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
          onSettingsSaved?.();
        }}
      />
      <AdminTemplates
        scaffolds={scaffolds}
        settings={settingsQuery.data}
        loading={settingsQuery.isLoading}
        onSave={async (input) => {
          await updateAdminSettings(input);
          await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
          await queryClient.invalidateQueries({ queryKey: queryKeys.scaffolds });
          onSettingsSaved?.();
        }}
      />
      <div className="card shadow-sm mt-3">
        <div className="card-header"><h3 className="h5 mb-0">Existing users</h3></div>
        <ul className="list-group list-group-flush">
          {usersQuery.isLoading ? <li className="list-group-item text-body-secondary">Loading users...</li> : null}
          {usersQuery.data?.map((user) => (
            <li className="list-group-item d-flex flex-wrap align-items-center justify-content-between gap-2" key={user.id}>
              <span>
                <strong className="d-block">{user.name || user.email}</strong>
                <span className="text-body-secondary small">{user.email}</span>
              </span>
              <span className="d-flex align-items-center gap-2">
                <select
                  className="form-select form-select-sm"
                  value={user.role}
                  disabled={updateUserMutation.isPending}
                  onChange={(event) => updateUserMutation.mutate({ userId: user.id, patch: { role: event.target.value } })}
                  aria-label={`Role for ${user.email}`}
                >
                  <option value="employee">Employee</option>
                  <option value="admin">Admin</option>
                </select>
                <select
                  className="form-select form-select-sm"
                  value={user.status}
                  disabled={updateUserMutation.isPending}
                  onChange={(event) => updateUserMutation.mutate({ userId: user.id, patch: { status: event.target.value } })}
                  aria-label={`Status for ${user.email}`}
                >
                  <option value="invited">Invited</option>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </span>
            </li>
          ))}
          {!usersQuery.isLoading && !usersQuery.data?.length ? <li className="list-group-item text-body-secondary">No users found.</li> : null}
        </ul>
      </div>
    </section>
  );
}

function AdminSettings({ settings, loading, onSave }) {
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState('');
  const [memberModel, setMemberModel] = useState('');
  const [adminModel, setAdminModel] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('120000');
  const [dirty, setDirty] = useState(false);
  const providerBaseUrl = baseUrl.trim();
  const modelsQuery = useQuery({
    queryKey: queryKeys.agentModels(providerBaseUrl),
    queryFn: () => listAgentModels(providerBaseUrl),
    enabled: Boolean(providerBaseUrl),
    staleTime: 60_000,
    retry: 1,
  });
  const modelOptions = useMemo(() => {
    const values = new Set([memberModel, adminModel, ...(modelsQuery.data ?? [])].filter(Boolean));
    return [...values].sort((left, right) => left.localeCompare(right));
  }, [memberModel, adminModel, modelsQuery.data]);

  React.useEffect(() => {
    if (!settings || dirty) return;
    setBaseUrl(settings.agent?.baseUrl ?? '');
    setMemberModel(settings.agent?.memberModel ?? '');
    setAdminModel(settings.agent?.adminModel ?? '');
    setTimeoutMs(String(settings.agent?.timeoutMs ?? 120000));
  }, [settings, dirty]);

  return (
    <div className="card shadow-sm mt-3">
      <div className="card-header">
        <h3 className="h5 mb-1">Agent settings</h3>
        <p className="text-body-secondary small mb-0">Configure deepagents and its OpenAI-compatible tool-calling model provider.</p>
      </div>
      <div className="card-body">
        {loading ? <p className="text-body-secondary">Loading settings...</p> : null}
        <form
          className="row g-3 align-items-end"
          onSubmit={async (event) => {
            event.preventDefault();
            await onSave?.({
              agent: {
                baseUrl,
                memberModel,
                adminModel,
                timeoutMs: Number(timeoutMs),
              },
            });
            setDirty(false);
          }}
        >
          <div className="col-12 col-lg-5">
            <label className="form-label" htmlFor="agentBaseUrl">Model provider base URL</label>
            <input className="form-control" id="agentBaseUrl" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setDirty(true); }} placeholder="http://127.0.0.1:3033/v1" />
          </div>
          <div className="col-12 col-lg-2">
            <label className="form-label" htmlFor="memberModel">Employee model</label>
            <select className="form-select" id="memberModel" value={memberModel} onChange={(event) => { setMemberModel(event.target.value); setDirty(true); }}>
              <option value="">Select model</option>
              {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </div>
          <div className="col-12 col-lg-2">
            <label className="form-label" htmlFor="adminModel">Admin model</label>
            <select className="form-select" id="adminModel" value={adminModel} onChange={(event) => { setAdminModel(event.target.value); setDirty(true); }}>
              <option value="">Select model</option>
              {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </div>
          <div className="col-12 col-lg-3">
            <label className="form-label" htmlFor="agentTimeout">Timeout ms</label>
            <input className="form-control" id="agentTimeout" value={timeoutMs} onChange={(event) => { setTimeoutMs(event.target.value); setDirty(true); }} inputMode="numeric" />
          </div>
          <div className="col-12 col-lg-3">
            <button className="btn btn-primary w-100" type="submit">Save settings</button>
          </div>
          <div className="col-12 col-lg-3">
            <button
              className="btn btn-outline-secondary w-100"
              type="button"
              disabled={!providerBaseUrl || modelsQuery.isFetching}
              onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.agentModels(providerBaseUrl) })}
            >
              {modelsQuery.isFetching ? 'Loading models...' : 'Refresh models'}
            </button>
          </div>
          <div className="col-12 col-lg-3">
            <span className="text-body-secondary small">
              SMTP {settings?.smtp?.enabled ? 'configured' : 'not configured'} · Database {settings?.database?.enabled ? 'enabled' : 'not enabled'}
            </span>
          </div>
          <div className="col-12">
            {modelsQuery.isError ? <section className="alert alert-warning py-2 mb-0" role="alert">{modelsQuery.error instanceof Error ? modelsQuery.error.message : 'Could not load model provider models.'}</section> : null}
            {!modelsQuery.isError && providerBaseUrl ? <span className="text-body-secondary small">Deepagents will use models loaded from {providerBaseUrl.replace(/\/$/, '')}/models.</span> : null}
          </div>
        </form>
      </div>
    </div>
  );
}


function AdminTemplates({ scaffolds, settings, loading, onSave }) {
  const [defaultKey, setDefaultKey] = useState('');
  const [items, setItems] = useState({});
  const [dirty, setDirty] = useState(false);
  const templateSettings = settings?.scaffolds ?? {};

  React.useEffect(() => {
    if (dirty || !scaffolds?.length) return;
    setDefaultKey(templateSettings.defaultKey ?? scaffolds.find((item) => item.isDefault)?.key ?? scaffolds[0]?.key ?? '');
    setItems(Object.fromEntries(scaffolds.map((scaffold) => {
      const persisted = templateSettings.items?.[scaffold.key] ?? {};
      return [scaffold.key, {
        name: persisted.name ?? scaffold.name ?? '',
        description: persisted.description ?? scaffold.description ?? '',
        isActive: persisted.isActive ?? scaffold.isActive ?? true,
        minRole: persisted.minRole ?? scaffold.minRole ?? 'employee',
      }];
    })));
  }, [scaffolds, templateSettings, dirty]);

  const updateItem = (key, patch) => {
    setItems((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? {}),
        ...patch,
      },
    }));
    setDirty(true);
  };

  return (
    <div className="card shadow-sm mt-3">
      <div className="card-header">
        <h3 className="h5 mb-1">Templates</h3>
        <p className="text-body-secondary small mb-0">Curate scaffold folders that employees can use when creating decks.</p>
      </div>
      <div className="card-body">
        {loading ? <p className="text-body-secondary">Loading templates...</p> : null}
        {!loading && !scaffolds.length ? <p className="text-body-secondary mb-0">No scaffold folders found.</p> : null}
        {scaffolds.length ? (
          <form
            className="d-grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              await onSave?.({
                scaffolds: {
                  defaultKey,
                  items,
                },
              });
              setDirty(false);
            }}
          >
            <div className="row g-3 align-items-end">
              <div className="col-12 col-lg-6">
                <label className="form-label" htmlFor="defaultScaffold">Default template</label>
                <select className="form-select" id="defaultScaffold" value={defaultKey} onChange={(event) => { setDefaultKey(event.target.value); setDirty(true); }}>
                  {scaffolds.map((scaffold) => <option key={scaffold.key} value={scaffold.key}>{items[scaffold.key]?.name || scaffold.name}</option>)}
                </select>
              </div>
              <div className="col-12 col-lg-3">
                <button className="btn btn-primary w-100" type="submit">Save templates</button>
              </div>
            </div>
            <div className="list-group">
              {scaffolds.map((scaffold) => {
                const item = items[scaffold.key] ?? {};
                return (
                  <section className="list-group-item" key={scaffold.key}>
                    <div className="row g-3 align-items-end">
                      <div className="col-12 col-lg-3">
                        <label className="form-label" htmlFor={`templateName-${scaffold.key}`}>Name</label>
                        <input className="form-control" id={`templateName-${scaffold.key}`} value={item.name ?? ''} onChange={(event) => updateItem(scaffold.key, { name: event.target.value })} />
                      </div>
                      <div className="col-12 col-lg-4">
                        <label className="form-label" htmlFor={`templateDescription-${scaffold.key}`}>Description</label>
                        <input className="form-control" id={`templateDescription-${scaffold.key}`} value={item.description ?? ''} onChange={(event) => updateItem(scaffold.key, { description: event.target.value })} />
                      </div>
                      <div className="col-6 col-lg-2">
                        <label className="form-label" htmlFor={`templateRole-${scaffold.key}`}>Minimum role</label>
                        <select className="form-select" id={`templateRole-${scaffold.key}`} value={item.minRole ?? 'employee'} onChange={(event) => updateItem(scaffold.key, { minRole: event.target.value })}>
                          <option value="employee">Employee</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div className="col-6 col-lg-2">
                        <div className="form-check form-switch">
                          <input className="form-check-input" id={`templateActive-${scaffold.key}`} type="checkbox" checked={item.isActive ?? true} onChange={(event) => updateItem(scaffold.key, { isActive: event.target.checked })} />
                          <label className="form-check-label" htmlFor={`templateActive-${scaffold.key}`}>Active</label>
                        </div>
                      </div>
                      <div className="col-12 col-lg-1">
                        <span className="badge text-bg-light">{scaffold.key}</span>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}

async function pollExport(queryClient, deckId, jobId, setExportJobs) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const job = await getExport(jobId).catch(() => null);
    if (!job) return;
    setExportJobs?.((current) => ({ ...current, [deckId]: job }));
    await queryClient.invalidateQueries({ queryKey: queryKeys.deck(deckId) });
    if (['succeeded', 'failed'].includes(String(job.status).toLowerCase())) return;
  }
}

function formatDate(value) {
  if (!value) return 'No updates yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function dashboardStats(decks, scaffolds) {
  const statuses = decks.reduce((counts, deck) => {
    counts[deck.status] = (counts[deck.status] ?? 0) + 1;
    return counts;
  }, {});
  const shareLinks = decks.flatMap((deck) => deck.shares ?? []);
  const pptxStatuses = decks.map((deck) => String(deck.pptx?.status ?? '').toLowerCase());
  return {
    totalDecks: decks.length,
    draftDecks: statuses.draft ?? 0,
    publishedDecks: statuses.published ?? 0,
    shareLinks: shareLinks.length,
    editLinks: shareLinks.filter((share) => share.permission === 'edit').length,
    passwordLinks: shareLinks.filter((share) => share.hasPassword).length,
    lockedDecks: decks.filter((deck) => deck.activeEditorUserId).length,
    exportingDecks: pptxStatuses.filter((status) => status === 'queued' || status === 'running').length,
    failedExports: pptxStatuses.filter((status) => status === 'failed').length,
    activeTemplates: scaffolds.filter((scaffold) => scaffold.isActive !== false).length,
    adminTemplates: scaffolds.filter((scaffold) => scaffold.minRole === 'admin').length,
    defaultTemplate: scaffolds.find((scaffold) => scaffold.isDefault)?.name ?? '',
  };
}

function formatStreamStatus(value) {
  if (!value) return 'working';
  return value.replaceAll('_', ' ');
}

function formatExportStatus(value) {
  if (!value || value === 'not_exported') return 'Not exported';
  return String(value).replaceAll('_', ' ');
}

function exportStatusClass(value) {
  const status = String(value ?? '').toLowerCase();
  if (status === 'succeeded') return 'text-bg-success';
  if (status === 'failed') return 'text-bg-danger';
  if (status === 'queued' || status === 'running') return 'text-bg-warning';
  return 'text-bg-secondary';
}

function formatPreviewStatus(value) {
  if (value === 'custom') return 'Custom runtime';
  if (value === 'starting') return 'Preparing preview';
  if (value === 'fallback') return 'Draft fallback';
  return 'Draft build';
}

function previewStatusClass(value) {
  if (value === 'custom') return 'text-bg-success';
  if (value === 'starting') return 'text-bg-warning';
  if (value === 'fallback') return 'text-bg-danger';
  return 'text-bg-secondary';
}

function formatPreviewBuildStatus(value) {
  if (value === 'fresh') return 'Cached';
  if (value === 'building') return 'Building';
  if (value === 'stale') return 'Cached, rebuilding';
  if (value === 'failed') return 'Preview failed';
  return 'Not built';
}

function previewBuildStatusClass(value) {
  if (value === 'fresh') return 'text-bg-success';
  if (value === 'building' || value === 'stale') return 'text-bg-warning';
  if (value === 'failed') return 'text-bg-danger';
  return 'text-bg-secondary';
}

function isCustomRuntimeDeck(deck) {
  return Boolean(deck?.previewUrl?.startsWith('/runtime/')) || deck?.scaffoldKey === 'custom-html';
}

function clientShareTokenFromPath(pathname) {
  const match = pathname.match(/^\/client\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function topbarContext(view, deck) {
  if (view === 'templates') return 'Templates';
  if (view === 'admin') return 'Admin';
  if ((view === 'detail' || view === 'workbench') && deck) return deck.title;
  return 'Decks';
}

function deckStatusDot(deck) {
  const exporting = ['queued', 'running'].includes(String(deck.pptx?.status ?? '').toLowerCase());
  if (exporting) return 'is-busy';
  return deck.status === 'published' ? 'is-published' : 'is-draft';
}
