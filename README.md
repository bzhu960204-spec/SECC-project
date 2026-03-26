# SEC Filings Downloader

This project is a React + Vite web app that searches SEC companies by ticker or name and lists recent 10-K and 10-Q filings for direct download.

## What It Does

- Loads the SEC company ticker directory from the public SEC dataset.
- Searches companies by ticker symbol or company name.
- Fetches recent filing metadata from the SEC submissions API.
- Filters results to 10-K and 10-Q forms only.
- Opens or downloads the filing document directly from the SEC archive.

## Run Locally

```bash
npm.cmd install
npm.cmd run dev
```

If PowerShell blocks `npm`, use `npm.cmd` or run through `cmd /c`.

## Notes

- This app is client-side only and does not use a backend.
- SEC responses can be sensitive to automated traffic rules. If requests are blocked with HTTP 403 in the browser or terminal, a lightweight backend proxy will be needed.
- Download behavior depends on browser support and SEC response headers. The app always provides the direct filing URL.
