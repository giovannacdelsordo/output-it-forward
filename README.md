# output-it-forward
OIF (Output It Forward) is a Chrome extension that helps researchers detect and document open data indicators in scholarly articles while they browse. As you read a paper, OIF automatically scans the page for phrases and repository links commonly associated with open data practices, and logs matches to a running CSV file for systematic documentation.
OIF is designed with adaptability in mind: its phrase list and repository domain list are plain, editable text files, so tailoring the extension to your discipline requires no programming expertise, just edit a list.

# Overview
When reviewing large volumes of scholarly literature, manually identifying open data indicators is time-consuming and error-prone. OIF automates this process by scanning article pages (including PDFs) for:

  Key phrases associated with open data practices: including formal section headers (e.g., "Data Availability Statement"), open-science badge language (e.g., "Open Data", "Open Materials"), generic sharing language (e.g., "openly available", "upon reasonable request"), and pre-registration terms (e.g., "preregistered", "Registered Report")
  Plain-text URLs found anywhere on the page
  Repository domain links pointing to known data-sharing platforms (OSF, Zenodo, Figshare, GitHub, Dryad, Dataverse, PsychArchives, OpenICPSR, OpenNeuro, Mendeley Data, and others)
  Trigger sentences: sentences that contain both a data-related term and a URL or repository reference, which are most likely to describe data availability

OIF works on both HTML article pages and PDFs (via a built-in PDF viewer). Detected indicators are logged automatically to a cumulative record stored in your browser, which you can download at any time as a CSV file with the following columns: article title, page URL, trigger sentences, repository tokens, and all plain-text URLs. The log accumulates across sessions, making OIF suitable for systematic reviews, meta-science studies, and audits of open data compliance.

# Installation

  Option 1: Chrome Web Store (recommended)
  Install OIF directly from the Chrome Web Store:
    Install OIF on the Chrome Web Store
    The OIF icon will appear in your Chrome toolbar once installed.
    
  Option 2: Manual installation (for developers)
    Download or clone this repository to your computer.
    Open Chrome and go to chrome://extensions/.
    Enable Developer mode using the toggle in the top-right corner.
    Click Load unpacked and select the folder containing this repository.
    The OIF icon will appear in your Chrome toolbar. You're ready to go.

Note: Because OIF is loaded as an unpacked extension, you will need to reload it manually after any updates by returning to chrome://extensions/ and clicking the reload icon next to OIF.

# How to Use

Navigate to any scholarly article page (HTML or PDF) in Chrome.
Click the OIF icon in your toolbar to open the popup.

On HTML pages, OIF will scan the page immediately and display results in the popup.
On PDF pages, the popup will offer an "Open in OIF PDF Viewer" button. Click it to reopen the PDF in OIF's built-in viewer, which renders the document alongside a results sidebar.

The popup (and PDF viewer sidebar) display:

Trigger sentences: sentences containing both a data-related term and a URL or repository reference
Repository tokens: URLs pointing to known data repositories
Key statements: matched phrases highlighted in the page
Plain-text URLs: all raw URLs detected on the page

Use the Download All URLs (CSV) button to export your full log. Your log accumulates across browsing sessions, so you can document indicators across many articles before downloading.
Use Clear Stored Links to reset the log at any time.

Local PDFs: To scan PDFs opened from your computer, you must first enable Allow access to file URLs for OIF in chrome://extensions → OIF → Details.

Customizing the phrase and domain lists
Both lists live in content.js as plain text, so no programming knowledge is required to edit them.

Phrase list: Find the phrases array near the top of content.js. Add, remove, or edit entries as needed. Each entry is a quoted string on its own line.
Repository domain list: Find the REPO_PATTERN regular expression in content.js. Add new domains by inserting them into the pattern (e.g., |mynewrepo\.org).
After editing, reload the extension in chrome://extensions/ by clicking the reload icon next to OIF.

# How to Contribute

Community contributions are warmly welcomed and are essential to keeping OIF's coverage broad and current.
If you come across a phrase or repository domain that OIF is missing, you can:

Open an issue on this repository describing the phrase or domain and the context in which it appears.
Submit a pull request with your proposed addition to the phrases array or REPO_PATTERN in content.js.

We will review and incorporate suggestions into periodic updates of the extension. This collaborative model is intentional: OIF is built around the same open science values it is designed to support.

# Citation
If you use OIF in your research, please cite:

Coming soon!

A preprint or DOI link will be added here upon publication.

# License
This project is licensed under the MIT License.
