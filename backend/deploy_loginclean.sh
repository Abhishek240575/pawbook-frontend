#!/bin/bash
# Login page: remove the "Continue with Facebook" and "Continue with Apple" buttons.
# Only email + password and "Continue with Google" remain. Frontend only — no restart needed.
# Usage:  bash ~/pb-sync/backend/deploy_loginclean.sh
set -u
PREV=6d81b9d            # 01_login.html as last deployed (Google redirect sign-in)
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-loginclean-$(date +%Y%m%d-%H%M%S)
F=01_login.html
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
T1=$(mktemp); T2=$(mktemp)   # temp files (this server has no /dev/fd)
git show "$PREV:$F" | norm > "$T1"; norm < "$WEB/$F" > "$T2"
if ! cmp -s "$T1" "$T2"; then norm < "$REPO/$F" > "$T1"; cmp -s "$T1" "$T2" && { rm -f "$T1" "$T2"; echo "Already done — nothing to change."; exit 0; }
  rm -f "$T1" "$T2"; echo "STOPPED: the live $F is not what was deployed ($PREV). Nothing was changed. Send me this output."; exit 1; fi
rm -f "$T1" "$T2"
mkdir -p "$BK" && cp -p "$WEB/$F" "$BK/" || { echo "Backup failed"; exit 1; }
cp "$REPO/$F" "$WEB/$F" || { echo "Copy failed — restoring"; cp -p "$BK/$F" "$WEB/"; exit 1; }
echo "DONE: the login page now shows only email/password and Continue with Google. No restart needed."
echo "Undo (if ever needed): cp $BK/$F $WEB/"
