import argparse
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile

DOMAIN = "com.superlogical.rex"
SNAPSHOT = Path(__file__).with_name("appearance.plist")
RUNTIME_KEYS = {"Workspace.lastFocusedSession", "Workspace.programActivitySeen"}


def appearance(values):
    return {
        key: value
        for key, value in values.items()
        if key.startswith("Workspace.") and key not in RUNTIME_KEYS
    }


def current():
    return plistlib.loads(subprocess.check_output(["defaults", "export", DOMAIN, "-"]))


def main():
    parser = argparse.ArgumentParser(description="Back up or restore Rex appearance without session or connection data")
    parser.add_argument("action", choices=["capture", "check", "restore"])
    args = parser.parse_args()
    values = current()
    if args.action == "capture":
        SNAPSHOT.write_bytes(plistlib.dumps(appearance(values)))
        print(f"Saved Rex appearance to {SNAPSHOT}")
        return
    saved = plistlib.loads(SNAPSHOT.read_bytes())
    if saved != appearance(saved):
        raise ValueError("Snapshot contains non-appearance preferences")
    if args.action == "check":
        if appearance(values) != saved:
            raise ValueError("Rex appearance differs from the dotfiles snapshot")
        print("Rex appearance matches the dotfiles snapshot")
        return
    values.update(saved)
    fd, path = tempfile.mkstemp(suffix=".plist")
    try:
        with os.fdopen(fd, "wb") as file:
            plistlib.dump(values, file)
        subprocess.run(["defaults", "import", DOMAIN, path], check=True)
    finally:
        os.unlink(path)
    print("Restored Rex appearance. Reopen Rex when convenient; no sessions were stopped.")


if __name__ == "__main__":
    main()
