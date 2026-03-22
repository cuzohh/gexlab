---
wave: 1
depends_on: []
files_modified:
  - frontend/package.json
  - frontend/index.html
  - frontend/src/main.tsx
  - frontend/src/App.tsx
  - frontend/src/index.css
autonomous: true
---

# Phase 1, Plan 2: Frontend Setup & Boilerplate

## Objective
Initialize the Vite + React frontend app with a glassmorphic dark theme and a connection to the backend `/api/health` and `/api/theta-status` endpoints.

## Tasks

<task type="auto">
  <name>Initialize Vite React App</name>
  <files>frontend/package.json</files>
  <action>
    Run `npm create vite@latest frontend -- --template react-ts` equivalent logic.
    Since we are executing directly, initialize a standard `package.json` with React 18, Vite, and typescript in `frontend/`. 
    Include Tailwind CSS if preferred, or vanilla CSS. For now, rely on vanilla CSS variables for max performance:
    ```
    react, react-dom
    lucide-react
    ```
  </action>
  <acceptance_criteria>
    `frontend/package.json` exists and includes `react`.
  </acceptance_criteria>
  <read_first>
    .planning/ROADMAP.md
  </read_first>
</task>

<task type="auto">
  <name>Setup Dark Theme CSS Variables</name>
  <files>frontend/src/index.css</files>
  <action>
    Create `frontend/src/index.css` with a sleek dark theme root configuration:
    ```css
    :root {
      --bg-base: #0a0a0c;
      --bg-panel: #16161a;
      --border: #26262f;
      --text-main: #ededf0;
      --text-muted: #8a8a93;
      --accent: #5e6ad2;
      --positive: #10b981;
      --negative: #ef4444;
      --panel-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
    body {
      background-color: var(--bg-base);
      color: var(--text-main);
      font-family: 'Inter', -apple-system, sans-serif;
      margin: 0;
      padding: 0;
    }
    ```
  </action>
  <acceptance_criteria>
    `frontend/src/index.css` contains `--bg-base:` and `--positive:` color definitions.
  </acceptance_criteria>
  <read_first>
    frontend/src/index.css
  </read_first>
</task>

<task type="auto">
  <name>Build App Component with Health Checks</name>
  <files>frontend/src/App.tsx</files>
  <action>
    Create `frontend/src/App.tsx`.
    Implement a simple dashboard scaffold:
    - Navbar indicating "GEX Dashboard".
    - `useEffect` fetching `http://localhost:8000/api/theta-status` and `http://localhost:8000/api/health`.
    - Display "Backend: OK | ThetaTerminal: OK/Disconnected" in the top corner using `--positive` or `--negative` colors depending on the status.
  </action>
  <acceptance_criteria>
    `frontend/src/App.tsx` contains `fetch("http://localhost:8000/api/theta-status")` and renders a live badge.
  </acceptance_criteria>
  <read_first>
    frontend/src/index.css
  </read_first>
</task>

## Verification
- `npm run dev` starts the frontend cleanly.
- Dark theme CSS is successfully applied.
- Frontend App successfully sends GET requests to the backend.

## Must Haves
- Visually clean dark theme skeleton.
- Status checks matching ThetaData integration.
