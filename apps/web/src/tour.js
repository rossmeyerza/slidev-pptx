// @ts-check
// Guided onboarding tours built on driver.js. Two short tours: the dashboard
// tour (what the product is, how to start) and a workbench mini-tour (live
// preview + chat) that fires on the first workbench visit. Both are
// re-runnable; auto-start is remembered per browser in localStorage.
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const DASHBOARD_KEY = 'slidev-agent-tour-dashboard-v1';
const WORKBENCH_KEY = 'slidev-agent-tour-workbench-v1';

function seen(key) {
  try {
    return window.localStorage.getItem(key) === 'done';
  } catch {
    return true;
  }
}

function markSeen(key) {
  try {
    window.localStorage.setItem(key, 'done');
  } catch {
    /* private mode: tours simply re-offer next session */
  }
}

function baseConfig() {
  return {
    showProgress: true,
    overlayOpacity: 0.55,
    stagePadding: 6,
    stageRadius: 10,
    popoverClass: 'app-tour',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Got it',
  };
}

function present(selector) {
  return Boolean(document.querySelector(selector));
}

export function shouldAutoStartDashboardTour() {
  return !seen(DASHBOARD_KEY);
}

export function shouldAutoStartWorkbenchTour() {
  return !seen(WORKBENCH_KEY);
}

export function startDashboardTour() {
  const steps = [
    {
      element: '[data-tour="hero"]',
      popover: {
        title: 'Welcome to Deckhand',
        description: 'Decks here are written by an AI agent you brief in plain language. This 30-second tour shows the workflow.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="start-deck"]',
      popover: {
        title: 'Start a deck',
        description: 'Give it a title, pick a branded template, and add a one-line brief. The agent drafts the opening slides for you — usually in under a minute.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="summary"]',
      popover: {
        title: 'Your workspace at a glance',
        description: 'Decks, client links, exports in flight, and the templates available to you.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="recent-decks"]',
      popover: {
        title: 'Pick up where you left off',
        description: 'Open any deck to work on it with the agent, share a client link, or export a pixel-perfect PPTX. That’s the whole loop — enjoy!',
        side: 'top',
        align: 'start',
      },
    },
  ].filter((step) => present(step.element));
  if (!steps.length) {
    markSeen(DASHBOARD_KEY);
    return;
  }
  const tour = driver({
    ...baseConfig(),
    steps,
    onDestroyed: () => markSeen(DASHBOARD_KEY),
  });
  tour.drive();
}

export function startWorkbenchTour() {
  const steps = [
    {
      element: '[data-tour="workbench-preview"]',
      popover: {
        title: 'The live deck',
        description: 'This is the real deck, not a thumbnail. It updates in place while the agent edits — styles restyle and slides patch in without a refresh.',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '[data-tour="workbench-chat"]',
      popover: {
        title: 'Brief the agent',
        description: 'Describe the change you want — add slides, rewrite copy, restyle. If you’re not sure where to start, tap one of the suggestions.',
        side: 'left',
        align: 'start',
      },
    },
  ].filter((step) => present(step.element));
  if (!steps.length) {
    markSeen(WORKBENCH_KEY);
    return;
  }
  const tour = driver({
    ...baseConfig(),
    steps,
    onDestroyed: () => markSeen(WORKBENCH_KEY),
  });
  tour.drive();
}
