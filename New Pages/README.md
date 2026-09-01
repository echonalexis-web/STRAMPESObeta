# STRAMPESO Front-End Project

This project is a static front-end prototype for a PESO-style employment portal. The workspace is organized by page section so different interfaces can be developed and previewed separately while sharing the same assets.

## Overview

The project includes:

- a job applicant dashboard
- an employer dashboard
- an admin user management interface
- a public news/feed page
- an about page for the Marinduque employment portal
- a tutorial/landing page with a branded footer and carousel

## Current Structure

```text
home-tutorial-footer/
├── About-Page/
│   └── about-page.html
├── Admin-User-Management/
│   ├── admin-user-management.css
│   └── admin-user-management.html
├── Landing-Page-Footer-Additional-design/
│   ├── home-tutorial-footer.css
│   └── home-tutorial-footer.html
├── News-Feed/
│   ├── admin-news-feed.html
│   └── news-feed.html
├── images/
│   ├── Picture 1.jpg
│   ├── Picture 2.png
│   ├── Picture 3.png
│   ├── Picture 4.png
│   ├── BOOKEEPER.png
│   ├── footer.png
│   ├── peso-logo.png
│   ├── provincial-seal.png
│   └── provincial-building.jpg
├── index.html
├── styles.css
├── README.md
└── ...
```

## Important Asset Fix

The page folders are intentionally separated, but the shared image files live in the root `images` folder. Because of that, each HTML or CSS file in a subfolder must use a relative path such as:

- `../images/peso-logo.png`
- `../images/footer.png`
- `../images/Picture 1.jpg`

This prevents broken image loads when a page is opened from its own folder.

## Pages Included

- `index.html` – applicant dashboard prototype
- `About-Page/about-page.html` – about page for the service office
- `Admin-User-Management/admin-user-management.html` – admin management dashboard
- `Landing-Page-Footer-Additional-design/home-tutorial-footer.html` – tutorial/final footer layout
- `News-Feed/news-feed.html` – public announcement/news feed
- `News-Feed/admin-news-feed.html` – admin-side announcement management

## Tech Stack

- HTML5
- CSS3
- Vanilla JavaScript
- Static image assets

## How to Run

Because this is a static website, you can open the pages directly in a browser or serve the project locally.

### Option 1: Open directly
- Open `index.html` or any page in its folder in a browser.

### Option 2: Local server
```bash
python -m http.server 8000
```
Then open:

```text
http://localhost:8000
```

## Notes

This is a front-end prototype and does not yet connect to a backend or database. The current goal is to showcase the design and layout for a local employment portal.

## Status

The project is structured in separate folders for organization, and the shared asset references have been corrected so the pages can load their images properly.
