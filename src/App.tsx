import { useEffect, useMemo, useState } from 'react'
import './App.css'
type SecCompanyEntry = {
  cik_str: number
  ticker: string
  title: string
}

type SecCompany = {
  cik: string
  ticker: string
  name: string
}

type SecSubmissionResponse = {
  filings?: {
    recent?: {
      accessionNumber?: string[]
      filingDate?: string[]
      form?: string[]
      primaryDocument?: string[]
      primaryDocDescription?: string[]
      reportDate?: string[]
    }
  }
}

type FilingRecord = {
  accessionNumber: string
  filingDate: string
  form: string
  primaryDocument: string
  description: string
  reportDate: string
  filingUrl: string
}

// Requests go through Vite's dev proxy (vite.config.ts) which sets User-Agent server-side.
const TICKER_LOOKUP_URL = '/api/sec/files/company_tickers.json'
const SEC_DATA_URL = '/api/sec-data/submissions'
const SEC_ARCHIVES_URL = 'https://www.sec.gov/Archives/edgar/data'
const CONTACT_EMAIL_STORAGE_KEY = 'sec-downloader-contact-email'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function buildSecHeaders(): HeadersInit {
  return { 'Accept': 'application/json' }
}

function describeSecError(context: string, error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error'

  if (message.includes('403')) {
    return `${context} The SEC endpoint is rejecting requests from this environment with HTTP 403. This is usually a bot-protection or corporate network policy issue, not a local typing mistake.`
  }

  if (message.includes('Failed to fetch')) {
    return `${context} The browser could not reach the SEC endpoint. This can be caused by proxy restrictions, CORS, VPN filtering, or blocked outbound traffic.`
  }

  return `${context} ${message}`
}

function normalizeCompany(entry: SecCompanyEntry): SecCompany {
  return {
    cik: entry.cik_str.toString().padStart(10, '0'),
    ticker: entry.ticker,
    name: entry.title,
  }
}

function buildFilingUrl(cik: string, accessionNumber: string, primaryDocument: string) {
  return `${SEC_ARCHIVES_URL}/${Number(cik)}/${accessionNumber.replaceAll('-', '')}/${primaryDocument}`
}

const QUARTERS = [1, 2, 3, 4] as const
type Quarter = typeof QUARTERS[number]

function quarterStartDate(year: number, quarter: Quarter): Date {
  return new Date(year, (quarter - 1) * 3, 1)
}

function quarterEndDate(year: number, quarter: Quarter): Date {
  // day 0 of the month after the quarter = last day of the quarter
  return new Date(year, quarter * 3, 0)
}

function quarterLabel(q: Quarter) {
  const labels: Record<Quarter, string> = { 1: 'Q1 (Jan–Mar)', 2: 'Q2 (Apr–Jun)', 3: 'Q3 (Jul–Sep)', 4: 'Q4 (Oct–Dec)' }
  return labels[q]
}

function formatDate(date: string) {
  if (!date) {
    return 'Not available'
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
  }).format(new Date(date))
}

function App() {
  const [companies, setCompanies] = useState<SecCompany[]>([])
  const [query, setQuery] = useState('')
  const [contactEmail, setContactEmail] = useState(() => localStorage.getItem(CONTACT_EMAIL_STORAGE_KEY) ?? '')
  const [selectedCompany, setSelectedCompany] = useState<SecCompany | null>(null)
  const [filings, setFilings] = useState<FilingRecord[]>([])
  const [directoryStatus, setDirectoryStatus] = useState('Enter a ticker and click Fetch to search.')
  const [filingsStatus, setFilingsStatus] = useState('Search for a company to load 10-K and 10-Q filings.')
  const [loadingCompanies, setLoadingCompanies] = useState(false)
  const [loadingFilings, setLoadingFilings] = useState(false)
  const [fetchAttempted, setFetchAttempted] = useState(false)
  const [filterStartYear, setFilterStartYear] = useState<number | ''>('')
  const [filterStartQuarter, setFilterStartQuarter] = useState<Quarter | ''>('')
  const [filterEndYear, setFilterEndYear] = useState<number | ''>('')
  const [filterEndQuarter, setFilterEndQuarter] = useState<Quarter | ''>('')
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number; errors: number } | null>(null)
  const trimmedContactEmail = contactEmail.trim()
  const isContactEmailValid = trimmedContactEmail.length === 0 || EMAIL_PATTERN.test(trimmedContactEmail)

  useEffect(() => {
    localStorage.setItem(CONTACT_EMAIL_STORAGE_KEY, contactEmail)
  }, [contactEmail])

  async function fetchCompanies(): Promise<SecCompany[]> {
    if (companies.length > 0) return companies
    setLoadingCompanies(true)
    setFetchAttempted(true)
    setDirectoryStatus('Loading SEC company directory...')
    try {
      const response = await fetch(TICKER_LOOKUP_URL, {
        headers: buildSecHeaders(),
      })
      if (!response.ok) {
        throw new Error(`SEC company directory request failed with ${response.status}`)
      }
      const data = (await response.json()) as Record<string, SecCompanyEntry>
      const normalizedCompanies = Object.values(data)
        .map(normalizeCompany)
        .sort((left, right) => left.ticker.localeCompare(right.ticker))
      setCompanies(normalizedCompanies)
      setDirectoryStatus(`Loaded ${normalizedCompanies.length} SEC-listed companies.`)
      return normalizedCompanies
    } catch (error) {
      setDirectoryStatus(describeSecError('Unable to load the SEC company directory.', error))
      return []
    } finally {
      setLoadingCompanies(false)
    }
  }

  const searchResults = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase()

    if (!trimmedQuery) {
      return []
    }

    return companies
      .filter((company) => {
        const matchesTicker = company.ticker.toLowerCase().includes(trimmedQuery)
        const matchesName = company.name.toLowerCase().includes(trimmedQuery)

        return matchesTicker || matchesName
      })
      .slice(0, 8)
  }, [companies, query])

  const CURRENT_YEAR = new Date().getFullYear()
  const yearOptions = Array.from({ length: CURRENT_YEAR - 1993 + 1 }, (_, i) => CURRENT_YEAR - i)

  const filteredFilings = useMemo(() => {
    return filings.filter((filing) => {
      const date = new Date(filing.filingDate)
      if (isNaN(date.getTime())) return true
      if (filterStartYear !== '' && filterStartQuarter !== '') {
        if (date < quarterStartDate(filterStartYear, filterStartQuarter)) return false
      }
      if (filterEndYear !== '' && filterEndQuarter !== '') {
        if (date > quarterEndDate(filterEndYear, filterEndQuarter)) return false
      }
      return true
    })
  }, [filings, filterStartYear, filterStartQuarter, filterEndYear, filterEndQuarter])

  function clearDateFilter() {
    setFilterStartYear('')
    setFilterStartQuarter('')
    setFilterEndYear('')
    setFilterEndQuarter('')
  }

  async function downloadAll() {
    if (filteredFilings.length === 0) return
    setDownloadProgress({ done: 0, total: filteredFilings.length, errors: 0 })
    let errors = 0
    for (let i = 0; i < filteredFilings.length; i++) {
      const filing = filteredFilings[i]
      try {
        // Fetch through the Vite proxy (same-origin) so the blob URL triggers a real download
        const proxyUrl = filing.filingUrl.replace('https://www.sec.gov', '/api/sec')
        const response = await fetch(proxyUrl)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)
        const safeName = `${filing.form}_${filing.filingDate}_${filing.primaryDocument}`.replace(/[/\\:*?"<>|]/g, '_')
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = safeName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        // Revoke after a tick so the browser has time to start the download
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
      } catch {
        errors++
      }
      setDownloadProgress({ done: i + 1, total: filteredFilings.length, errors })
    }
  }

  async function handleFetch() {
    const q = query.trim()
    if (!q) return
    const pool = await fetchCompanies()
    if (pool.length === 0) return
    const lower = q.toLowerCase()
    const results = pool
      .filter((c) => c.ticker.toLowerCase().includes(lower) || c.name.toLowerCase().includes(lower))
      .slice(0, 8)
    if (results.length === 0) {
      setFilingsStatus(`No companies found matching "${q}". Try a different ticker or name.`)
      return
    }
    const exact = results.find((c) => c.ticker.toLowerCase() === lower)
    void loadFilings(exact ?? results[0])
  }

  async function loadFilings(company: SecCompany) {
    setSelectedCompany(company)
    setLoadingFilings(true)
    setFilings([])
    setDownloadProgress(null)
    setFilingsStatus(`Loading recent filings for ${company.ticker}...`)

    try {
      const response = await fetch(`${SEC_DATA_URL}/CIK${company.cik}.json`, {
        headers: buildSecHeaders(),
      })

      if (!response.ok) {
        throw new Error(`SEC submissions request failed with ${response.status}`)
      }

      const data = (await response.json()) as SecSubmissionResponse
      const recent = data.filings?.recent

      if (!recent?.accessionNumber || !recent.form || !recent.primaryDocument || !recent.filingDate) {
        setFilingsStatus(`No recent filing data is available for ${company.ticker}.`)
        return
      }

      const recentFilings = recent.form
        .map((form, index) => {
          const accessionNumber = recent.accessionNumber?.[index] ?? ''
          const primaryDocument = recent.primaryDocument?.[index] ?? ''

          return {
            accessionNumber,
            filingDate: recent.filingDate?.[index] ?? '',
            form,
            primaryDocument,
            description: recent.primaryDocDescription?.[index] ?? 'SEC filing document',
            reportDate: recent.reportDate?.[index] ?? '',
            filingUrl: buildFilingUrl(company.cik, accessionNumber, primaryDocument),
          }
        })
        .filter((filing) => filing.form === '10-K' || filing.form === '10-Q')
        .filter((filing) => filing.accessionNumber && filing.primaryDocument)

      setFilings(recentFilings)
      setFilingsStatus(
        recentFilings.length > 0
          ? `Showing ${recentFilings.length} recent annual and quarterly filings for ${company.name}.`
          : `No recent 10-K or 10-Q filings were found for ${company.name}.`,
      )
    } catch (error) {
      setFilingsStatus(describeSecError(`Unable to load filings for ${company.ticker}.`, error))
    } finally {
      setLoadingFilings(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">SEC EDGAR filing retrieval</p>
        <h1>Find and download a company&apos;s 10-K and 10-Q filings.</h1>
        <p className="hero-copy">
          Search by ticker or company name, pull the latest submission feed from the SEC,
          and open the filing document directly from the browser.
        </p>
        <div className="hero-notes">
          <span>Client-side only</span>
          <span>Live SEC data</span>
          <span>No backend required</span>
        </div>
      </section>

      <section className="workspace-panel">
        <div className="search-panel">
          <label className="field-label" htmlFor="contact-email">
            Contact email (for SEC request identification)
          </label>
          <input
            id="contact-email"
            className={`search-input ${!isContactEmailValid ? 'invalid' : ''}`}
            type="email"
            placeholder="name@company.com"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
          />
          <p className="field-help">
            Set <code>SEC_CONTACT_EMAIL</code> in your environment before running <code>npm run dev</code> and the Vite proxy will forward it to SEC servers in the <code>User-Agent</code> header.
          </p>
          {!isContactEmailValid ? (
            <p className="validation-error" role="alert">Enter a valid email address format.</p>
          ) : null}

          <label className="field-label" htmlFor="company-search">
            Company search
          </label>
          <div className="search-input-row">
            <input
              id="company-search"
              className="search-input"
              type="search"
              placeholder="Try AAPL, MSFT, NVIDIA, or a company name"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') handleFetch() }}
            />
            <button
              type="button"
              className="fetch-btn"
              onClick={handleFetch}
              disabled={loadingFilings || !query.trim()}
            >
              Fetch
            </button>
          </div>
          <p className="status-text">{directoryStatus}</p>

          <label className="field-label">Date range filter</label>
          <div className="date-filter">
            <div className="date-filter-group">
              <span className="filter-label">From</span>
              <select
                className="filter-select"
                value={filterStartYear}
                onChange={(e) => setFilterStartYear(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Year</option>
                {yearOptions
                  .filter((y) => filterEndYear === '' || y <= filterEndYear)
                  .map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <select
                className="filter-select"
                value={filterStartQuarter}
                onChange={(e) => setFilterStartQuarter(e.target.value ? Number(e.target.value) as Quarter : '')}
              >
                <option value="">Quarter</option>
                {QUARTERS.map((q) => <option key={q} value={q}>{quarterLabel(q)}</option>)}
              </select>
            </div>
            <div className="date-filter-group">
              <span className="filter-label">To</span>
              <select
                className="filter-select"
                value={filterEndYear}
                onChange={(e) => setFilterEndYear(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Year</option>
                {yearOptions
                  .filter((y) => filterStartYear === '' || y >= filterStartYear)
                  .map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <select
                className="filter-select"
                value={filterEndQuarter}
                onChange={(e) => setFilterEndQuarter(e.target.value ? Number(e.target.value) as Quarter : '')}
              >
                <option value="">Quarter</option>
                {QUARTERS.map((q) => <option key={q} value={q}>{quarterLabel(q)}</option>)}
              </select>
            </div>
            {(filterStartYear !== '' || filterEndYear !== '') ? (
              <button type="button" className="filter-clear-btn" onClick={clearDateFilter}>
                Clear
              </button>
            ) : null}
          </div>

          {fetchAttempted && !loadingCompanies && companies.length === 0 ? (
            <div className="notice-panel">
              <strong>Why search is failing</strong>
              <p>
                Direct calls to SEC endpoints from this machine are being blocked with HTTP 403.
                The issue is upstream of the UI, so the app cannot fetch the company directory from
                the browser in the current network environment.
              </p>
              <p>
                Browser apps cannot reliably control or override the real network User-Agent header,
                so this UI can only include contact info while constructing request headers in
                JavaScript. For dependable SEC compliance and access, route requests through a
                backend proxy that sets headers server-side.
              </p>
            </div>
          ) : null}

          <div className="results-list" aria-live="polite">
            {searchResults.length > 0 ? (
              searchResults.map((company) => (
                <button
                  key={company.cik}
                  className={`result-card ${selectedCompany?.cik === company.cik ? 'selected' : ''}`}
                  onClick={() => void loadFilings(company)}
                  type="button"
                >
                  <span className="result-ticker">{company.ticker}</span>
                  <span className="result-name">{company.name}</span>
                  <span className="result-cik">CIK {company.cik}</span>
                </button>
              ))
            ) : (
              <div className="empty-state small">
                {query.trim() ? 'No matching companies found.' : 'Start typing to search the SEC directory.'}
              </div>
            )}
          </div>
        </div>

        <div className="filings-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Recent filings</p>
              <h2>
                {selectedCompany
                  ? `${selectedCompany.name} (${selectedCompany.ticker})`
                  : 'Select a company'}
              </h2>
            </div>
            {filteredFilings.length > 0 ? (
              <div className="download-all-wrap">
                {downloadProgress ? (
                  <span className="download-progress">
                    {downloadProgress.done < downloadProgress.total
                      ? `Downloading ${downloadProgress.done} / ${downloadProgress.total}…`
                      : downloadProgress.errors > 0
                        ? `Done — ${downloadProgress.errors} file(s) failed`
                        : `Downloaded ${downloadProgress.total} file(s)`}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="download-all-btn"
                  onClick={() => void downloadAll()}
                  disabled={(downloadProgress !== null && downloadProgress.done < downloadProgress.total)}
                  title=""
                >
                  Download all ({filteredFilings.length})
                </button>
              </div>
            ) : null}
          </div>

          <p className="status-text">
            {loadingFilings
              ? 'Loading filings...'
              : filteredFilings.length !== filings.length
                ? `Showing ${filteredFilings.length} of ${filings.length} filings for ${selectedCompany?.name}.`
                : filingsStatus}
          </p>

          {filings.length > 0 ? (
            <div className="filing-grid">
              {filteredFilings.length > 0 ? filteredFilings.map((filing) => (
                <article key={`${filing.accessionNumber}-${filing.primaryDocument}`} className="filing-card">
                  <div className="filing-card-header">
                    <span className="filing-form">{filing.form}</span>
                    <span className="filing-date">Filed {formatDate(filing.filingDate)}</span>
                  </div>
                  <h3>{filing.description}</h3>
                  <p>
                    Report period: <strong>{formatDate(filing.reportDate)}</strong>
                  </p>
                  <p className="filing-doc">Document: {filing.primaryDocument}</p>
                  <div className="filing-actions">
                    <a href={filing.filingUrl} target="_blank" rel="noreferrer" className="primary-action">
                      Open filing
                    </a>
                    <a href={filing.filingUrl} download className="secondary-action">
                      Download link
                    </a>
                  </div>
                </article>
              )) : (
                <div className="empty-state">
                  No filings match the selected date range.
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state">
              10-K and 10-Q filings will appear here after you select a company.
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
