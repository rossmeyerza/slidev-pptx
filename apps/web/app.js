const state = {
  user: null,
  hasUsers: true,
  decks: [],
  selectedDeck: null,
  selectedView: "dashboard",
  busy: false,
  exportJob: null,
};

const els = {
  authScreen: document.querySelector("#authScreen"),
  appShell: document.querySelector("#appShell"),
  authNotice: document.querySelector("#authNotice"),
  apiNotice: document.querySelector("#apiNotice"),
  authStatus: document.querySelector("#authStatus"),
  loginForm: document.querySelector("#loginForm"),
  bootstrapForm: document.querySelector("#bootstrapForm"),
  logoutButton: document.querySelector("#logoutButton"),
  navDecksButton: document.querySelector("#navDecksButton"),
  navTemplatesButton: document.querySelector("#navTemplatesButton"),
  navAdminButton: document.querySelector("#navAdminButton"),
  dashboardView: document.querySelector("#dashboardView"),
  deckDetailView: document.querySelector("#deckDetailView"),
  workbenchView: document.querySelector("#workbenchView"),
  templatesView: document.querySelector("#templatesView"),
  adminView: document.querySelector("#adminView"),
  deckList: document.querySelector("#deckList"),
  deckCards: document.querySelector("#deckCards"),
  deckSearch: document.querySelector("#deckSearch"),
  refreshDecksButton: document.querySelector("#refreshDecksButton"),
  newDeckButton: document.querySelector("#newDeckButton"),
  createDeckForm: document.querySelector("#createDeckForm"),
  deckTitle: document.querySelector("#deckTitle"),
  selectedStatus: document.querySelector("#selectedStatus"),
  deckMeta: document.querySelector("#deckMeta"),
  workOnDeckButton: document.querySelector("#workOnDeckButton"),
  previewFrame: document.querySelector("#previewFrame"),
  emptyPreview: document.querySelector("#emptyPreview"),
  previewMeta: document.querySelector("#previewMeta"),
  previewLink: document.querySelector("#previewLink"),
  reloadPreviewButton: document.querySelector("#reloadPreviewButton"),
  publishButton: document.querySelector("#publishButton"),
  exportButton: document.querySelector("#exportButton"),
  exportStatus: document.querySelector("#exportStatus"),
  exportOutput: document.querySelector("#exportOutput"),
  shareForm: document.querySelector("#shareForm"),
  shareName: document.querySelector("#shareName"),
  shareEmail: document.querySelector("#shareEmail"),
  createShareButton: document.querySelector("#createShareButton"),
  shareList: document.querySelector("#shareList"),
  workbenchTitle: document.querySelector("#workbenchTitle"),
  workbenchFrame: document.querySelector("#workbenchFrame"),
  workbenchEmpty: document.querySelector("#workbenchEmpty"),
  backToDetailButton: document.querySelector("#backToDetailButton"),
  instructionStream: document.querySelector("#instructionStream"),
  instructionForm: document.querySelector("#instructionForm"),
  instructionInput: document.querySelector("#instructionInput"),
  instructionHint: document.querySelector("#instructionHint"),
  sendInstructionButton: document.querySelector("#sendInstructionButton"),
  inviteForm: document.querySelector("#inviteForm"),
};

const endpoints = {
  me: [{ method: "GET", path: "/api/auth/me" }],
  login: [{ method: "POST", path: "/api/auth/login" }],
  bootstrap: [{ method: "POST", path: "/api/auth/bootstrap" }],
  logout: [{ method: "POST", path: "/api/auth/logout" }],
  invite: [{ method: "POST", path: "/api/users/invite" }],
  listDecks: [{ method: "GET", path: "/api/decks" }],
  createDeck: [{ method: "POST", path: "/api/decks" }],
  getDeck: (id) => [{ method: "GET", path: `/api/decks/${encodeURIComponent(id)}` }],
  instruct: (id) => [
    { method: "POST", path: `/api/decks/${encodeURIComponent(id)}/instructions` },
    { method: "POST", path: `/api/decks/${encodeURIComponent(id)}/chat` },
  ],
  publish: (id) => [{ method: "POST", path: `/api/decks/${encodeURIComponent(id)}/publish` }],
  share: (id) => [{ method: "POST", path: `/api/decks/${encodeURIComponent(id)}/shares` }],
  exportPptx: (id) => [{ method: "POST", path: `/api/decks/${encodeURIComponent(id)}/export` }],
  exportStatus: (_id, jobId) => [{ method: "GET", path: `/api/exports/${encodeURIComponent(jobId)}` }],
};

async function apiTry(candidates, body) {
  const errors = [];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.path, {
        method: candidate.method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(payload.error ?? `${response.status} ${response.statusText}`);
      clearNotice();
      clearAuthNotice();
      return payload;
    } catch (error) {
      errors.push(`${candidate.method} ${candidate.path}: ${error.message}`);
    }
  }
  throw new Error(errors.join("; "));
}

function normalizeDeck(raw) {
  const id = raw.id ?? raw.deckId ?? crypto.randomUUID();
  return {
    ...raw,
    id,
    title: raw.title ?? "Untitled deck",
    owner: raw.owner ?? raw.createdBy ?? "Internal",
    status: raw.status ?? "draft",
    updatedAt: raw.updatedAt ?? null,
    previewUrl: raw.previewUrl ?? raw.draftUrl ?? "",
    publishedUrl: raw.publishedUrl ?? "",
    shares: raw.shares ?? [],
    messages: raw.messages ?? [],
    pptx: raw.pptx ?? null,
  };
}

function normalizeDecks(payload) {
  return (payload.decks ?? payload.items ?? payload.data ?? payload ?? []).map(normalizeDeck);
}

function showNotice(message) {
  els.apiNotice.hidden = false;
  els.apiNotice.textContent = message;
}

function clearNotice() {
  els.apiNotice.hidden = true;
  els.apiNotice.textContent = "";
}

function showAuthNotice(message) {
  els.authNotice.hidden = false;
  els.authNotice.textContent = message;
}

function clearAuthNotice() {
  els.authNotice.hidden = true;
  els.authNotice.textContent = "";
}

function showDevLink(result, label) {
  const url = result.loginUrl ?? result.inviteUrl;
  if (!url) return;
  const suffix = result.sent ? "Email sent." : "SMTP is not configured; use this dev link:";
  const message = `${label}: ${suffix} ${url}`;
  state.user ? showNotice(message) : showAuthNotice(message);
}

function formatDate(value) {
  if (!value) return "No updates yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function setBusy(isBusy) {
  state.busy = isBusy;
  updateControls();
}

function renderShell() {
  const signedIn = Boolean(state.user);
  els.authScreen.hidden = signedIn;
  els.appShell.hidden = !signedIn;
  els.bootstrapForm.hidden = signedIn || state.hasUsers;
  els.loginForm.hidden = signedIn;
  if (!signedIn) return;

  els.authStatus.textContent = `${state.user.name} · ${state.user.role}`;
  els.navAdminButton.hidden = state.user.role !== "admin";
  renderView();
  renderDeckList();
  renderDeckCards();
  updateControls();
}

function setView(view) {
  state.selectedView = view;
  renderView();
}

function renderView() {
  const isAdmin = state.user?.role === "admin";
  const view = state.selectedView === "admin" && !isAdmin ? "dashboard" : state.selectedView;
  els.dashboardView.hidden = view !== "dashboard";
  els.deckDetailView.hidden = view !== "detail";
  els.workbenchView.hidden = view !== "workbench";
  els.templatesView.hidden = view !== "templates";
  els.adminView.hidden = view !== "admin";

  els.navDecksButton.classList.toggle("active", view === "dashboard" || view === "detail" || view === "workbench");
  els.navTemplatesButton.classList.toggle("active", view === "templates");
  els.navAdminButton.classList.toggle("active", view === "admin");
}

function updateControls() {
  const hasDeck = Boolean(state.selectedDeck);
  const hasPreview = Boolean(state.selectedDeck?.previewUrl);
  els.workOnDeckButton.disabled = !hasDeck || state.busy;
  els.publishButton.disabled = !hasDeck || state.busy;
  els.exportButton.disabled = !hasDeck || state.busy;
  els.reloadPreviewButton.disabled = !hasPreview;
  els.shareName.disabled = !hasDeck || state.busy;
  els.shareEmail.disabled = !hasDeck || state.busy;
  els.createShareButton.disabled = !hasDeck || state.busy;
  els.instructionInput.disabled = !hasDeck || state.busy;
  els.sendInstructionButton.disabled = !hasDeck || state.busy;
  els.previewLink.classList.toggle("disabled", !hasPreview);
  els.previewLink.setAttribute("aria-disabled", String(!hasPreview));
}

function filteredDecks() {
  const query = els.deckSearch.value.trim().toLowerCase();
  return state.decks.filter((deck) => !query || deck.title.toLowerCase().includes(query) || deck.owner.toLowerCase().includes(query));
}

function renderDeckList() {
  els.deckList.replaceChildren();
  const decks = filteredDecks();
  if (!decks.length) {
    const empty = document.createElement("li");
    empty.className = "list-group-item text-body-secondary small";
    empty.textContent = "No decks found.";
    els.deckList.append(empty);
    return;
  }

  for (const deck of decks) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = `list-group-item list-group-item-action deck-item${deck.id === state.selectedDeck?.id ? " is-active" : ""}`;
    button.innerHTML = "<strong class=\"d-block text-truncate\"></strong><span class=\"d-block small text-body-secondary\"></span>";
    button.querySelector("strong").textContent = deck.title;
    button.querySelector("span").textContent = `${deck.status} · ${formatDate(deck.updatedAt)}`;
    button.addEventListener("click", () => selectDeck(deck.id));
    item.append(button);
    els.deckList.append(item);
  }
}

function renderDeckCards() {
  els.deckCards.replaceChildren();
  const decks = filteredDecks();
  if (!decks.length) {
    const empty = document.createElement("div");
    empty.className = "card shadow-sm";
    empty.innerHTML = "<div class=\"card-body text-body-secondary\">No decks yet. Create one from the scaffold.</div>";
    els.deckCards.append(empty);
    return;
  }

  for (const deck of decks) {
    const card = document.createElement("article");
    card.className = "card shadow-sm deck-card";
    card.innerHTML = `
      <div class="card-body">
        <div class="d-flex align-items-start justify-content-between gap-2 mb-2">
          <h3 class="h5 mb-0"></h3>
          <span class="badge text-bg-secondary"></span>
        </div>
        <p class="text-body-secondary small mb-3"></p>
        <button class="btn btn-outline-primary btn-sm" type="button">Open deck</button>
      </div>
    `;
    card.querySelector("h3").textContent = deck.title;
    card.querySelector(".badge").textContent = deck.status;
    card.querySelector("p").textContent = `Updated ${formatDate(deck.updatedAt)}`;
    card.querySelector("button").addEventListener("click", () => selectDeck(deck.id));
    els.deckCards.append(card);
  }
}

function renderSelectedDeck() {
  const deck = state.selectedDeck;
  els.deckTitle.textContent = deck?.title ?? "Choose a deck";
  els.selectedStatus.textContent = deck ? `${deck.status} · Updated ${formatDate(deck.updatedAt)}` : "No deck selected";
  els.deckMeta.textContent = deck ? `${deck.owner} · ${deck.id}` : "Select a deck from the list.";
  els.previewLink.href = deck?.previewUrl ?? "#";
  els.workbenchTitle.textContent = deck?.title ?? "Deck";
  renderPreview(deck, els.previewFrame, els.emptyPreview);
  renderShares(deck);
  renderExport(deck);
  renderMessages(deck);
  updateControls();
  renderDeckList();
}

function renderPreview(deck, frame, placeholder) {
  const url = deck?.previewUrl ?? "";
  const nextSrc = url ? new URL(url, window.location.origin).href : "about:blank";
  frame.hidden = !url;
  if ((frame.src || "about:blank") === nextSrc && url) {
    placeholder.hidden = true;
    return;
  }
  placeholder.hidden = false;
  placeholder.textContent = url ? "Loading preview..." : "No preview loaded";
  frame.onload = () => {
    if (frame.src !== "about:blank") placeholder.hidden = true;
  };
  frame.src = nextSrc;
  els.previewMeta.textContent = url ? "Draft preview for this deck." : "Select a deck to load a preview.";
}

function renderMessages(deck) {
  els.instructionStream.replaceChildren();
  const messages = deck?.messages?.length
    ? deck.messages
    : [{ role: "agent", content: "Ready for instructions once you start working on this deck." }];

  for (const message of messages) {
    const role = message.role ?? "agent";
    const item = document.createElement("article");
    item.className = `card message${role === "user" ? " is-user border-primary-subtle bg-primary-subtle" : ""}`;
    const label = document.createElement("b");
    label.className = "card-header py-2 small text-uppercase text-body-secondary";
    label.textContent = role === "user" ? "You" : "Agent";
    const copy = document.createElement("p");
    copy.className = "card-body mb-0 py-2";
    copy.textContent = message.content ?? "";
    item.append(label, copy);
    els.instructionStream.append(item);
  }
}

function renderShares(deck) {
  els.shareList.replaceChildren();
  const shares = deck?.shares ?? [];
  if (!shares.length) {
    const empty = document.createElement("li");
    empty.className = "list-group-item text-body-secondary small";
    empty.textContent = "No client links yet.";
    els.shareList.append(empty);
    return;
  }
  for (const share of shares) {
    const item = document.createElement("li");
    item.className = "list-group-item";
    const link = share.url ?? share.link ?? "#";
    item.innerHTML = "<strong class=\"d-block\"></strong><span class=\"d-block small text-body-secondary\"></span><a class=\"d-block small\" target=\"_blank\" rel=\"noreferrer\"></a>";
    item.querySelector("strong").textContent = share.name ?? "Client";
    item.querySelector("span").textContent = share.email ?? "Email not provided";
    item.querySelector("a").href = link;
    item.querySelector("a").textContent = link;
    els.shareList.append(item);
  }
}

function renderExport(deck) {
  els.exportOutput.replaceChildren();
  if (!deck) {
    els.exportStatus.textContent = "Select a deck to export.";
    return;
  }
  const pptx = deck.pptx;
  const status = pptx?.status ?? "Not exported";
  els.exportStatus.textContent = `Latest status: ${status}`;
  const line = document.createElement(pptx?.downloadUrl ? "a" : "span");
  line.className = pptx?.downloadUrl ? "d-block" : "text-body-secondary";
  line.textContent = pptx?.downloadUrl ? "Download PPTX" : "Use Export PPTX to start a new export.";
  if (pptx?.downloadUrl) {
    line.href = pptx.downloadUrl;
    line.target = "_blank";
    line.rel = "noreferrer";
  }
  els.exportOutput.append(line);
}

async function loadSession() {
  try {
    const payload = await apiTry(endpoints.me);
    state.user = payload.user ?? null;
    state.hasUsers = payload.hasUsers ?? true;
  } catch {
    state.user = null;
    state.hasUsers = true;
  }
  renderShell();
  if (state.user) await loadDecks();
}

async function loadDecks() {
  try {
    const payload = await apiTry(endpoints.listDecks);
    state.decks = normalizeDecks(payload);
    renderDeckList();
    renderDeckCards();
  } catch (error) {
    if (String(error.message).includes("Authentication required")) {
      state.user = null;
      renderShell();
      return;
    }
    showNotice(`Deck list failed. ${error.message}`);
  }
}

async function selectDeck(id) {
  const listDeck = state.decks.find((deck) => deck.id === id) ?? null;
  state.selectedDeck = listDeck;
  setView("detail");
  renderSelectedDeck();
  try {
    const payload = await apiTry(endpoints.getDeck(id));
    state.selectedDeck = normalizeDeck(payload.deck ?? payload.data ?? payload);
    upsertDeck(state.selectedDeck);
    renderSelectedDeck();
  } catch (error) {
    showNotice(`Using list data for this deck. ${error.message}`);
  }
}

function upsertDeck(deck) {
  const index = state.decks.findIndex((item) => item.id === deck.id);
  if (index >= 0) state.decks[index] = deck;
  else state.decks.unshift(deck);
  renderDeckCards();
}

async function createDeck(formData) {
  setBusy(true);
  try {
    const payload = await apiTry(endpoints.createDeck, {
      title: formData.get("title"),
      audience: formData.get("audience"),
      goal: formData.get("goal"),
      scaffold: "single",
      source: "web-v1",
    });
    const deck = normalizeDeck(payload.deck ?? payload.data ?? payload);
    upsertDeck(deck);
    els.createDeckForm.reset();
    await selectDeck(deck.id);
  } catch (error) {
    showNotice(`Create deck failed. ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function sendInstruction(text) {
  const deck = state.selectedDeck;
  if (!deck || !text.trim()) return;
  deck.messages = [...(deck.messages ?? []), { role: "user", content: text.trim() }];
  renderMessages(deck);
  els.instructionInput.value = "";
  setBusy(true);
  try {
    const payload = await apiTry(endpoints.instruct(deck.id), { deckId: deck.id, instruction: text.trim() });
    state.selectedDeck = normalizeDeck(payload.deck ?? payload.data ?? { ...deck, ...payload });
    upsertDeck(state.selectedDeck);
    renderSelectedDeck();
  } catch (error) {
    deck.messages = [...(deck.messages ?? []), { role: "agent", content: `Instruction could not be sent: ${error.message}` }];
    renderMessages(deck);
  } finally {
    setBusy(false);
  }
}

async function publishDeck() {
  if (!state.selectedDeck) return;
  setBusy(true);
  try {
    const payload = await apiTry(endpoints.publish(state.selectedDeck.id), { deckId: state.selectedDeck.id });
    state.selectedDeck = normalizeDeck(payload.deck ?? payload.data ?? { ...state.selectedDeck, status: "published" });
    upsertDeck(state.selectedDeck);
    renderSelectedDeck();
  } catch (error) {
    showNotice(`Publish failed. ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function createShare(formData) {
  if (!state.selectedDeck) return;
  setBusy(true);
  try {
    const payload = await apiTry(endpoints.share(state.selectedDeck.id), {
      deckId: state.selectedDeck.id,
      name: formData.get("name"),
      email: formData.get("email"),
    });
    state.selectedDeck.shares = [...(state.selectedDeck.shares ?? []), payload.share ?? payload.data ?? payload];
    upsertDeck(state.selectedDeck);
    els.shareForm.reset();
    renderSelectedDeck();
  } catch (error) {
    showNotice(`Share link failed. ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function exportPptx() {
  if (!state.selectedDeck) return;
  setBusy(true);
  try {
    const payload = await apiTry(endpoints.exportPptx(state.selectedDeck.id), { deckId: state.selectedDeck.id, format: "pptx" });
    const pptx = payload.export ?? payload.pptx ?? payload.data ?? payload;
    state.exportJob = pptx.id ?? pptx.jobId ?? null;
    state.selectedDeck = normalizeDeck({ ...state.selectedDeck, pptx });
    upsertDeck(state.selectedDeck);
    renderSelectedDeck();
    if (state.exportJob) pollExportStatus(state.selectedDeck.id, state.exportJob);
  } catch (error) {
    showNotice(`PPTX export failed. ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function pollExportStatus(deckId, jobId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      const payload = await apiTry(endpoints.exportStatus(deckId, jobId));
      const pptx = payload.export ?? payload.data ?? payload;
      if (state.selectedDeck?.id === deckId) {
        state.selectedDeck = normalizeDeck({ ...state.selectedDeck, pptx });
        upsertDeck(state.selectedDeck);
        renderSelectedDeck();
      }
      if (["succeeded", "failed"].includes(String(pptx.status).toLowerCase())) return;
    } catch {
      return;
    }
  }
}

async function requestLogin(formData) {
  try {
    const payload = await apiTry(endpoints.login, { email: formData.get("email") });
    showDevLink(payload, "Sign-in");
    els.loginForm.reset();
  } catch (error) {
    showAuthNotice(`Sign-in failed. ${error.message}`);
  }
}

async function bootstrapAdmin(formData) {
  try {
    const payload = await apiTry(endpoints.bootstrap, {
      email: formData.get("email"),
      name: formData.get("name"),
    });
    showDevLink(payload, "Bootstrap admin");
    els.bootstrapForm.reset();
    state.hasUsers = true;
    renderShell();
  } catch (error) {
    showAuthNotice(`Bootstrap failed. ${error.message}`);
  }
}

async function inviteUser(formData) {
  try {
    const payload = await apiTry(endpoints.invite, {
      email: formData.get("email"),
      name: formData.get("name"),
      role: formData.get("role"),
    });
    showDevLink(payload, "Invite");
    els.inviteForm.reset();
  } catch (error) {
    showNotice(`Invite failed. ${error.message}`);
  }
}

async function logout() {
  await apiTry(endpoints.logout).catch(() => null);
  state.user = null;
  state.selectedDeck = null;
  state.decks = [];
  renderShell();
}

function openWorkbench() {
  if (!state.selectedDeck) return;
  setView("workbench");
  renderPreview(state.selectedDeck, els.workbenchFrame, els.workbenchEmpty);
  renderMessages(state.selectedDeck);
}

els.loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  requestLogin(new FormData(event.currentTarget));
});
els.bootstrapForm.addEventListener("submit", (event) => {
  event.preventDefault();
  bootstrapAdmin(new FormData(event.currentTarget));
});
els.logoutButton.addEventListener("click", logout);
els.navDecksButton.addEventListener("click", () => setView("dashboard"));
els.navTemplatesButton.addEventListener("click", () => setView("templates"));
els.navAdminButton.addEventListener("click", () => setView("admin"));
els.refreshDecksButton.addEventListener("click", loadDecks);
els.deckSearch.addEventListener("input", () => {
  renderDeckList();
  renderDeckCards();
});
els.newDeckButton.addEventListener("click", () => {
  setView("dashboard");
  document.querySelector("#newDeckTitle").focus();
});
els.createDeckForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createDeck(new FormData(event.currentTarget));
});
els.workOnDeckButton.addEventListener("click", openWorkbench);
els.backToDetailButton.addEventListener("click", () => setView("detail"));
els.reloadPreviewButton.addEventListener("click", () => {
  if (!state.selectedDeck?.previewUrl) return;
  els.previewFrame.src = new URL(state.selectedDeck.previewUrl, window.location.origin).href;
});
els.previewLink.addEventListener("click", (event) => {
  if (!state.selectedDeck?.previewUrl) event.preventDefault();
});
els.publishButton.addEventListener("click", publishDeck);
els.exportButton.addEventListener("click", exportPptx);
els.shareForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createShare(new FormData(event.currentTarget));
});
els.instructionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendInstruction(els.instructionInput.value);
});
els.inviteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  inviteUser(new FormData(event.currentTarget));
});

renderShell();
loadSession();
