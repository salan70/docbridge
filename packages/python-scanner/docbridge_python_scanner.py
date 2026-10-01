"""DocBridge Python scanner worker entrypoint.

The core runs this file as ``python3 -I -S <absolute path>``. Isolated mode
drops the script directory from ``sys.path``, so the directory is inserted
explicitly before the package import; nothing else is ever added.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from docbridge_python_scanner.protocol import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
