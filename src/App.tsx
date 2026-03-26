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

const TICKER_LOOKUP_URL = 'https://www.sec.gov/files/company_tickers.json'
const SEC_DATA_URL = 'https://data.sec.gov/submissions'
const SEC_ARCHIVES_URL = 'https://www.sec.gov/Archives/edgar/data'
const SEC_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'SECC Project SEC Filings Downloader (client-side demo)',
} satisfies HeadersInit

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
  const [query, setQuery] = useState('AAPL')
  const [selectedCompany, setSelectedCompany] = useState<SecCompany | null>(null)
  const [filings, setFilings] = useState<FilingRecord[]>([])
  const [directoryStatus, setDirectoryStatus] = useState('Loading SEC company directory...')
  const [filingsStatus, setFilingsStatus] = useState('Search for a company to load 10-K and 10-Q filings.')
  const [loadingCompanies, setLoadingCompanies] = useState(true)
  const [loadingFilings, setLoadingFilings] = useState(false)

  useEffect(() => {
    let ignore = false

    async function loadCompanies() {
      try {
        const response = await fetch(TICKER_LOOKUP_URL, {
          headers: SEC_HEADERS,
        })

        if (!response.ok) {
          throw new Error(`SEC company directory request failed with ${response.status}`)
        }

        const data = (await response.json()) as Record<string, SecCompanyEntry>
        const normalizedCompanies = Object.values(data)
          .map(normalizeCompany)
          .sort((left, right) => left.ticker.localeCompare(right.ticker))

        if (ignore) {
          return
        }

        setCompanies(normalizedCompanies)
        setDirectoryStatus(`Loaded ${normalizedCompanies.length} SEC-listed companies.`)
      } catch (error) {
        if (ignore) {
          return
        }

        setDirectoryStatus(describeSecError('Unable to load the SEC company directory.', error))
      } finally {
        if (!ignore) {
          setLoadingCompanies(false)
        }
      }
    }

    void loadCompanies()

    return () => {
      ignore = true
    }
  }, [])

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

  async function loadFilings(company: SecCompany) {
    setSelectedCompany(company)
    setLoadingFilings(true)
    setFilings([])
    setFilingsStatus(`Loading recent filings for ${company.ticker}...`)

    try {
      const response = await fetch(`${SEC_DATA_URL}/CIK${company.cik}.json`, {
        headers: SEC_HEADERS,
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
          <label className="field-label" htmlFor="company-search">
            Company search
          </label>
          <input
            id="company-search"
            className="search-input"
            type="search"
            placeholder="Try AAPL, MSFT, NVIDIA, or a company name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <p className="status-text">{loadingCompanies ? 'Loading...' : directoryStatus}</p>

          {!loadingCompanies && companies.length === 0 ? (
            <div className="notice-panel">
              <strong>Why search is failing</strong>
              <p>
                Direct calls to SEC endpoints from this machine are being blocked with HTTP 403.
                The issue is upstream of the UI, so the app cannot fetch the company directory from
                the browser in the current network environment.
              </p>
              <p>
                The usual fix is to route SEC requests through a small backend proxy that adds an
                approved User-Agent and runs from a network the SEC accepts.
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
          </div>

          <p className="status-text">{loadingFilings ? 'Loading filings...' : filingsStatus}</p>

          {filings.length > 0 ? (
            <div className="filing-grid">
              {filings.map((filing) => (
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
              ))}
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
