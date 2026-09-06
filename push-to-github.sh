#!/usr/bin/env bash
# تریدبان — push به گیت‌هاب
# این اسکریپت را روی سیستم خودتان (بعد از دانلود پروژه) اجرا کنید:
#   bash push-to-github.sh
set -euo pipefail

REMOTE="git@github.com:ali3529/trader.git"

# ایمنی: کلیدهای رمزنگاری‌شده و env هرگز push نشوند
if git ls-files 2>/dev/null | grep -E '^\.tradeban/|^\.env$'; then
  echo "❌ فایل محرک ردیابی‌شده در git پیدا شد؛ اول حذف کنید:"
  echo "   git rm -r --cached .tradeban .env"
  exit 1
fi
if [ -d .tradeban ] || [ -f .env ]; then
  echo "⚠️  پوشه .tradeban یا فایل .env وجود دارد ولی در git ignore شده‌اند — push نمی‌شوند. ✔"
fi

if [ ! -d .git ]; then
  echo "→ مقداردهی اولیه مخزن محلی..."
  git init
  git add .
  git commit -m "تریدبان — ربات معامله‌گر نوبیتکس (paper-first)"
fi

git branch -M main
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE"
else
  git remote add origin "$REMOTE"
fi

echo "→ push به $REMOTE ..."
git push -u origin main
echo "✅ انجام شد: $REMOTE"
