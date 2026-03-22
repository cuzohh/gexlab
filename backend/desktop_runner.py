import os
import sys
from pathlib import Path

import uvicorn


def main() -> None:
    backend_dir = Path(__file__).resolve().parent
    os.chdir(backend_dir)

    port = 8000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])

    uvicorn.run('main:app', host='127.0.0.1', port=port, reload=False)


if __name__ == '__main__':
    main()
