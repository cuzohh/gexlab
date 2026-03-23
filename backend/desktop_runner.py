import os
import sys
from pathlib import Path

import uvicorn

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from main import app as backend_app


def main() -> None:
    os.chdir(BACKEND_DIR)

    port = 8000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])

    uvicorn.run(backend_app, host='127.0.0.1', port=port, reload=False)


if __name__ == '__main__':
    main()
