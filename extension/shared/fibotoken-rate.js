// fibotoken-rate.js: the FiboToken exchange rate in the popup's Settings.
//
// The numbers between the markers are a generated copy of
// app/src/config/fiboTokenRate.json, written by scripts/sync-fibotoken-rate.js.
// Change the rate in that file and run the script, never here. The wording
// matches the dashboard's (app/src/lib/fiboTokenRate.ts), and the script's
// --check pins the disclaimer to it.
(function(root) {
  'use strict';

  // FIBOTOKEN_RATE:BEGIN (generated from app/src/config/fiboTokenRate.json by scripts/sync-fibotoken-rate.js, do not edit)
  var RATE = {"euroPerFiboToken":0.01,"exampleEuros":25,"rateSetOn":"2026-10-28","packsFrom":"2027-01-01"};
  // FIBOTOKEN_RATE:END

  var DISCLAIMER = 'Like a currency, the FiboToken rate is variable: it can change over time and move with the market. A new rate applies to new packs only. FiboTokens you already own keep their value: one FiboToken, one use.';
  var PRICING_URL = 'https://fibonax.com/pricing/';

  function longDate(iso) {
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    });
  }

  // What the Settings card shows at a given moment. packsNote is null from the
  // first day of sale in Italy (UTC+01:00 in winter), whatever the clock's zone.
  function view(nowMs) {
    var price = '€' + RATE.euroPerFiboToken.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    var tokens = Math.round(RATE.exampleEuros / RATE.euroPerFiboToken);
    var onSale = nowMs >= Date.parse(RATE.packsFrom + 'T00:00:00+01:00');
    return {
      rate: price,
      worth: '1 FiboToken is worth ' + price,
      example: '€' + RATE.exampleEuros.toLocaleString('en-US') + ' = ' + tokens.toLocaleString('en-US') + ' FiboTokens',
      setOnDate: longDate(RATE.rateSetOn),
      packsNote: onSale ? null : 'FiboToken packs go on sale on ' + longDate(RATE.packsFrom) + '.'
    };
  }

  root.SBFiboTokenRate = { DISCLAIMER: DISCLAIMER, PRICING_URL: PRICING_URL, view: view };
}(typeof globalThis !== 'undefined' ? globalThis : this));
