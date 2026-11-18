import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { startPageTranslation } from '@/lib/pageTranslate';
import './index.css';
import { rememberReferralCode } from '@/lib/referral';

// A friend's invite link opens the sign-up page with ?ref=…: kept before the
// first render, so it survives the email step and the trip to Google.
rememberReferralCode(window.location.search);

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found in index.html');
}

// Before the first render, so a person who picked a language has the guard in
// place for every word the dashboard draws. Does nothing in English.
startPageTranslation();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
