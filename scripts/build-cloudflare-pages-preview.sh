#!/usr/bin/env bash
set -euo pipefail

# Isolated smart-exam preview only. Never publish the full school portal here.
rm -rf _site
mkdir -p _site/assets
cp smart-exam-designer.html _site/
cp assets/school-logo.svg _site/assets/
# Force this dedicated preview hostname to use the test Supabase project,
# even if someone opens the exam page without the explicit query parameter.
python3 - <<'PY'
from pathlib import Path
page = Path("_site/smart-exam-designer.html")
source = page.read_text(encoding="utf-8")
needle = 'const isTestMode=new URLSearchParams(window.location.search).get("frahoosh-env")==="test";'
replacement = 'const isTestMode=location.hostname.endsWith(".frahoosh-novin-preview.pages.dev")||new URLSearchParams(window.location.search).get("frahoosh-env")==="test";'
if needle not in source:
    raise SystemExit("Expected test-mode selector was not found; refusing to publish an unisolated preview.")
page.write_text(source.replace(needle, replacement, 1), encoding="utf-8")
PY
cat > _site/index.html <<'HTML'
<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>پیش‌نمایش آزمایشی طراحی آزمون هوشمند فراهوش</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07152d;color:#f4f7ff;font-family:Tahoma,sans-serif;padding:24px;box-sizing:border-box}
main{width:min(560px,100%);padding:28px;border:1px solid #536d91;border-radius:22px;background:#102744;text-align:center;box-sizing:border-box}
h1{font-size:24px;color:#f2d991}p{line-height:2;color:#d7e2f2}
a{display:inline-block;margin-top:16px;padding:14px 22px;border-radius:12px;background:#e5c16d;color:#07152d;text-decoration:none;font-weight:bold}
small{display:block;margin-top:18px;color:#9fb3cf}
</style>
</head>
<body><main>
<h1>پیش‌نمایش آزمایشی فراهوش نوین</h1>
<p>این نشانی فقط برای آزمایش طراحی آزمون هوشمند و کتابخانهٔ خصوصی کتاب‌های درسی است؛ به نسخهٔ اصلی مدرسه متصل نیست.</p>
<a href="smart-exam-designer.html?frahoosh-env=test">ورود به محیط آزمایشی</a>
<small>نسخهٔ آزمایشی · بدون دسترسی به پنل‌های عملیاتی مدرسه</small>
</main></body>
</html>
HTML
touch _site/.nojekyll
python3 - <<'PY'
import json, os
from datetime import datetime, timezone
commit = os.environ.get("CF_PAGES_COMMIT_SHA") or os.environ.get("GITHUB_SHA") or ""
metadata = {
    "commit": commit[:12] if commit else "",
    "built_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "scope": "smart-exam-preview-only",
}
with open("_site/build-info.json", "w", encoding="utf-8") as output:
    json.dump(metadata, output, ensure_ascii=False)
PY
