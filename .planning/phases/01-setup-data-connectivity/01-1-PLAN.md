---
wave: 1
depends_on: []
files_modified:
  - backend/requirements.txt
  - backend/main.py
  - backend/api/thetadata_client.py
autonomous: true
---

# Phase 1, Plan 1: Backend Setup & ThetaData Connection

## Objective
Initialize the FastAPI backend server and create a Python client wrapper to interface with the local ThetaTerminal instance on port 25510.

## Tasks

<task type="auto">
  <name>Initialize Python Backend</name>
  <files>backend/requirements.txt</files>
  <action>
    Create a `backend` directory.
    Create `backend/requirements.txt` containing exact dependencies:
    ```
    fastapi==0.111.0
    uvicorn==0.30.1
    httpx==0.27.0
    pandas==2.2.2
    scipy==1.13.1
    pydantic==2.7.4
    ```
  </action>
  <acceptance_criteria>
    `backend/requirements.txt` exists and contains `fastapi` and `pandas`.
  </acceptance_criteria>
  <read_first>
    .planning/ROADMAP.md
  </read_first>
</task>

<task type="auto">
  <name>Create FastAPI Scaffold</name>
  <files>backend/main.py</files>
  <action>
    Create `backend/main.py` configuring a FastAPI app with CORS middleware allowing all origins `[*]`.
    Add a `/api/health` GET endpoint that returns `{"status": "ok", "service": "gexlab-backend"}`.
  </action>
  <acceptance_criteria>
    `backend/main.py` contains `app = FastAPI()` and `@app.get("/api/health")`.
  </acceptance_criteria>
  <read_first>
    .planning/ROADMAP.md
  </read_first>
</task>

<task type="auto">
  <name>ThetaData Client Base</name>
  <files>backend/api/thetadata_client.py</files>
  <action>
    Create `backend/api/thetadata_client.py`.
    Implement an async `ThetaClient` Python class using `httpx.AsyncClient` that connects to `http://127.0.0.1:25510/v2/`.
    Add an async `check_connection()` method that hits `http://127.0.0.1:25510/v2/hist/stock/quote` to verify ThetaTerminal is running, catching connection errors and returning a boolean status.
  </action>
  <acceptance_criteria>
    `backend/api/thetadata_client.py` contains `class ThetaClient` and `async def check_connection(`.
  </acceptance_criteria>
  <read_first>
    backend/main.py
  </read_first>
</task>

<task type="auto">
  <name>Expose ThetaData Health</name>
  <files>backend/main.py</files>
  <action>
    Update `backend/main.py` to import `ThetaClient` from `api.thetadata_client`.
    Create a `/api/theta-status` GET endpoint that instantiates `ThetaClient` and calls `check_connection()`.
    Return `{"terminal_connected": True/False}` based on the result.
  </action>
  <acceptance_criteria>
    `backend/main.py` contains `@app.get("/api/theta-status")` and returns a JSON response containing `terminal_connected`.
  </acceptance_criteria>
  <read_first>
    backend/api/thetadata_client.py
  </read_first>
</task>

## Verification
- HTTP GET `http://localhost:8000/api/health` returns status "ok".
- HTTP GET `http://localhost:8000/api/theta-status` correctly identifies if ThetaTerminal is accessible.
- Dependencies install cleanly.

## Must Haves
- FastAPI server running successfully.
- ThetaData connection logic isolated into its own class.
