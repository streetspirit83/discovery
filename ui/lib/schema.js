/**
 * Schema constants and mock data for Discovery Workspace UI.
 * Mock data is used when no backend is configured (development mode).
 */

export const SCHEMA_VERSION = 'discovery-1.0';

export const WORKSPACE_STATES = ['new', 'reviewed', 'promoted', 'dismissed', 'imported'];

export const BLOB_TYPES = ['inbox', 'archive', 'export'];

export const SIGNAL_TYPES = [
  'insider_buy',
  'trend_breakout',
  'etf_addition',
  'etf_weight_increase',
];

export const REGIONS = ['US', 'DE', 'EU', 'other'];

export const MARKET_CAP_BUCKETS = ['large', 'mid', 'small', 'micro'];

export const EXCHANGES = [
  'NASDAQ', 'NYSE', 'AMEX',
  'XETR', 'FWB', 'MUN',
  'EURONEXT', 'LSE', 'MIL', 'BME',
  'SIX', 'VIE', 'OMXSTO', 'OMXCOP', 'OMXHEX', 'OSE',
];

/** Mock inbox blob for UI development without a backend */
export const MOCK_INBOX = {
  schema_version: SCHEMA_VERSION,
  blob_type: 'inbox',
  updated_at: '2026-05-27T10:00:00Z',
  candidates: [
    {
      id: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
      symbol: 'NVDA',
      exchange: 'NASDAQ',
      yahoo_symbol: 'NVDA',
      isin: 'US67066G1040',
      name: 'NVIDIA Corporation',
      sources: [
        {
          adapter: 'openinsider',
          source_url: 'https://openinsider.com/screener?s=NVDA',
          discovered_at: '2026-05-27T06:00:00Z',
          signal_type: 'insider_buy',
          raw_signal: {
            insider_name: 'Jensen Huang',
            title: 'CEO',
            trade_date: '2026-05-24',
            filing_date: '2026-05-26',
            shares: 25000,
            price_usd: 880.0,
            value_usd: 22000000,
          },
          info_snippet: 'Jensen Huang (CEO) bought 25,000 shares at $880 ($22M)',
        },
      ],
      links: {
        tradingview: 'https://www.tradingview.com/symbols/NASDAQ-NVDA/',
        stocktwits: 'https://stocktwits.com/symbol/NVDA',
        yahoo: 'https://finance.yahoo.com/quote/NVDA',
      },
      workspace_state: 'new',
      notes: '',
      enrichment: null,
      first_discovered_at: '2026-05-27T06:00:00Z',
      last_updated_at: '2026-05-27T06:00:00Z',
    },
    {
      id: 'b2c3d4e5-f6a7-4890-bcde-f01234567890',
      symbol: 'SAP',
      exchange: 'XETR',
      yahoo_symbol: 'SAP.DE',
      isin: 'DE0007164600',
      name: 'SAP SE',
      sources: [
        {
          adapter: 'boerse-frankfurt',
          source_url: 'https://api.boerse-frankfurt.de/v1/search/stocks',
          discovered_at: '2026-05-27T06:15:00Z',
          signal_type: 'trend_breakout',
          raw_signal: {
            list: 'Trend',
            rank: 3,
            price: 245.5,
            change_1w_pct: 4.8,
            trend_indicator: 85,
          },
          info_snippet: '#3 in Trend – +4.8% (1W)',
        },
      ],
      links: {
        tradingview: 'https://www.tradingview.com/symbols/XETR-SAP/',
        stocktwits: 'https://stocktwits.com/symbol/SAP',
        yahoo: 'https://finance.yahoo.com/quote/SAP.DE',
      },
      workspace_state: 'reviewed',
      notes: 'Starker AI-Momentum, Cloud-Transition läuft gut',
      enrichment: null,
      first_discovered_at: '2026-05-27T06:15:00Z',
      last_updated_at: '2026-05-27T09:00:00Z',
    },
    {
      id: 'c3d4e5f6-a7b8-4901-abcd-012345678901',
      symbol: 'ENPH',
      exchange: 'NASDAQ',
      yahoo_symbol: 'ENPH',
      isin: 'US29355A1079',
      name: 'Enphase Energy Inc.',
      sources: [
        {
          adapter: 'etf-holdings',
          source_url: 'https://www.ishares.com/us/products/239726/ICLN/holdings',
          discovered_at: '2026-05-26T07:00:00Z',
          signal_type: 'etf_addition',
          raw_signal: {
            etf: 'iShares Global Clean Energy ETF (ICLN)',
            weight_pct: 8.4,
          },
          info_snippet: '8.40% weight in iShares Clean Energy ETF (ICLN)',
        },
        {
          adapter: 'openinsider',
          source_url: 'https://openinsider.com/screener?s=ENPH',
          discovered_at: '2026-05-27T06:00:00Z',
          signal_type: 'insider_buy',
          raw_signal: {
            insider_name: 'Badri Kothandaraman',
            title: 'CEO',
            trade_date: '2026-05-22',
            shares: 10000,
            price_usd: 95.5,
            value_usd: 955000,
          },
          info_snippet: 'Badri Kothandaraman (CEO) bought 10,000 shares at $95.50 ($1M)',
        },
      ],
      links: {
        tradingview: 'https://www.tradingview.com/symbols/NASDAQ-ENPH/',
        stocktwits: 'https://stocktwits.com/symbol/ENPH',
        yahoo: 'https://finance.yahoo.com/quote/ENPH',
      },
      workspace_state: 'new',
      notes: '',
      enrichment: {
        enriched_at: '2026-05-27T10:00:00Z',
        model: 'claude-sonnet-4-6',
        sector: 'Technology',
        industry: 'Solar Energy',
        market_cap_bucket: 'mid',
        region: 'US',
        thesis_short: 'Enphase dominiert den US-Heimspeicher-Markt mit starkem IRA-Rückenwind und einem Cluster-Signal aus CEO-Kauf + ETF-Gewichtung.',
        thesis_long: 'Enphase Energy ist der führende Anbieter von Mikro-Wechselrichtersystemen. Nach einer deutlichen Korrektur zeigen Insider-Käufe und hohe ETF-Gewichtung im ICLN ein attraktives Cluster-Signal. Das Unternehmen profitiert vom Inflation Reduction Act.',
        risks: ['Zinssensitivität US-Wohnimmobilienmarkt', 'Konkurrenz durch SolarEdge', 'Lagerabbau-Zyklus'],
        catalysts: ['IRA-Fördermittel 2026-2028', 'Europa-Expansion', 'Battery-Storage-Wachstum'],
        confidence: 'medium',
      },
      first_discovered_at: '2026-05-26T07:00:00Z',
      last_updated_at: '2026-05-27T10:00:00Z',
    },
    {
      id: 'd4e5f6a7-b8c9-4012-abcd-123456789012',
      symbol: 'SMCI',
      exchange: 'NASDAQ',
      yahoo_symbol: 'SMCI',
      isin: null,
      name: 'Super Micro Computer Inc.',
      sources: [
        {
          adapter: 'openinsider',
          source_url: 'https://openinsider.com/screener',
          discovered_at: '2026-05-27T06:00:00Z',
          signal_type: 'insider_buy',
          raw_signal: {
            insider_name: 'Charles Liang',
            title: 'CEO',
            trade_date: '2026-05-23',
            shares: 30000,
            price_usd: 42.5,
            value_usd: 1275000,
          },
          info_snippet: 'Charles Liang (CEO) bought 30,000 shares at $42.50 ($1.3M)',
        },
      ],
      links: {
        tradingview: 'https://www.tradingview.com/symbols/NASDAQ-SMCI/',
        stocktwits: 'https://stocktwits.com/symbol/SMCI',
        yahoo: 'https://finance.yahoo.com/quote/SMCI',
      },
      workspace_state: 'new',
      notes: '',
      enrichment: null,
      first_discovered_at: '2026-05-27T06:00:00Z',
      last_updated_at: '2026-05-27T06:00:00Z',
    },
    {
      id: 'e5f6a7b8-c9d0-4123-abcd-234567890123',
      symbol: 'SIE',
      exchange: 'XETR',
      yahoo_symbol: 'SIE.DE',
      isin: 'DE0007236101',
      name: 'Siemens AG',
      sources: [
        {
          adapter: 'boerse-frankfurt',
          source_url: 'https://api.boerse-frankfurt.de/v1/search/stocks',
          discovered_at: '2026-05-27T06:15:00Z',
          signal_type: 'trend_breakout',
          raw_signal: {
            list: 'Gewinner 1W',
            rank: 1,
            price: 185.2,
            change_1w_pct: 6.1,
            trend_indicator: 92,
          },
          info_snippet: '#1 in Gewinner 1W – +6.1% (1W)',
        },
      ],
      links: {
        tradingview: 'https://www.tradingview.com/symbols/XETR-SIE/',
        stocktwits: 'https://stocktwits.com/symbol/SIE',
        yahoo: 'https://finance.yahoo.com/quote/SIE.DE',
      },
      workspace_state: 'dismissed',
      notes: 'Zu zyklisch für aktuelles Umfeld',
      enrichment: null,
      first_discovered_at: '2026-05-27T06:15:00Z',
      last_updated_at: '2026-05-27T09:30:00Z',
    },
  ],
};

export const MOCK_ARCHIVE = {
  schema_version: SCHEMA_VERSION,
  blob_type: 'archive',
  updated_at: '2026-05-26T15:00:00Z',
  candidates: [],
};

export const MOCK_EXPORT = {
  schema_version: SCHEMA_VERSION,
  blob_type: 'export',
  updated_at: '2026-05-26T15:00:00Z',
  candidates: [],
};
