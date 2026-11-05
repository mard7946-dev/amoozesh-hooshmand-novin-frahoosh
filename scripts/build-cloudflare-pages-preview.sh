#!/usr/bin/env bash
set -euo pipefail

# Build only the public school portal files. Do not publish server/, android/,
# supabase/, tests/, or repository configuration files to the static site.
rm -rf _site
mkdir -p _site

cp index.html manifest.webmanifest service-worker.js portal.html student-module.html platform-admin.html settings.html reports.html parent-management.html parent-meetings.html messages.html users.html bulletin.html directory.html counseling.html exam-center.html finance.html about.html classroom.html _site/
cp jalali-date.js reports-utils.js _site/

mkdir -p _site/icons
cp icons/frahoosh-192.svg icons/frahoosh-512.svg _site/icons/

python3 -m pip install --quiet cairosvg
python3 - <<'PY'
import cairosvg
for size in (192, 512):
    cairosvg.svg2png(
        url=f'icons/frahoosh-{size}.svg',
        write_to=f'_site/icons/frahoosh-{size}.png',
        output_width=size,
        output_height=size,
    )
PY

mkdir -p _site/classroom
cp classroom/index.html classroom/schedule.html classroom/management.html _site/classroom/
touch _site/.nojekyll
# Publish non-sensitive metadata for the exact preview build.
python3 - <<'PY'
import json, os
from datetime import datetime, timezone
commit = os.environ.get("CF_PAGES_COMMIT_SHA") or os.environ.get("GITHUB_SHA") or ""
build_id = os.environ.get("CF_PAGES_BUILD_ID") or commit[:8] or "preview"
metadata = {
    "build": build_id,
    "commit": commit[:12] if commit else "",
    "built_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
}
with open("_site/build-info.json", "w", encoding="utf-8") as output:
    json.dump(metadata, output, ensure_ascii=False)
PY

