#!/bin/bash
# Installs PostgreSQL client tools (pg_dump, pg_restore, psql) that match your Neon database version
# into your home folder (~/pgclientNN). No admin rights needed; nothing outside ~/pgclientNN is changed.
# Packages come from the official PostgreSQL apt repository and are checked against its SHA256 checksums.
# Usage:  bash ~/pb-sync/backend/install_pg_client.sh          (version is detected from the database)
#         bash ~/pb-sync/backend/install_pg_client.sh 18       (force a version)
set -u
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
REPO="${PGDG_MIRROR:-https://apt.postgresql.org/pub/repos/apt}"
fail() { echo "FAILED: $*"; exit 1; }

# 1) Which version does the database run?
VER="${1:-}"
if [ -z "$VER" ]; then
  DATABASE_URL=$(grep '^DATABASE_URL=' "$API/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
  [ -n "$DATABASE_URL" ] || fail "DATABASE_URL not found in $API/.env (or pass the version, e.g. 18)"
  NUM=$(psql "$DATABASE_URL" -tAc 'SHOW server_version_num' 2>/dev/null | tr -d '[:space:]')
  [ -n "$NUM" ] || fail "could not ask the database for its version (or pass the version, e.g. 18)"
  VER=$((NUM / 10000))
fi
case "$VER" in ''|*[!0-9]*) fail "bad version '$VER'";; esac
DEST=~/pgclient$VER
echo "Database is PostgreSQL $VER → installing client tools into $DEST"
if [ -x "$DEST/bin/pg_dump" ] && "$DEST/bin/pg_dump" --version 2>/dev/null | grep -q " $VER\."; then
  echo "Already installed: $("$DEST/bin/pg_dump" --version)"; exit 0
fi

# 2) Find the packages for this Ubuntu release
. /etc/os-release
CODENAME="${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}"; [ -n "$CODENAME" ] || fail "cannot tell which Ubuntu/Debian release this is"
ARCH=$(dpkg --print-architecture 2>/dev/null || echo amd64)
command -v dpkg-deb >/dev/null || fail "dpkg-deb is missing"
TMP=$(mktemp -d) || fail "mktemp"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL -m 120 "$REPO/dists/$CODENAME-pgdg/main/binary-$ARCH/Packages.gz" -o "$TMP/Packages.gz" || fail "could not download the package list for $CODENAME/$ARCH"
gunzip -c "$TMP/Packages.gz" > "$TMP/Packages" || fail "package list is damaged"
pick() {  # newest version of a package → "version<TAB>filename<TAB>sha256"
  awk -v want="$1" 'BEGIN{RS="";FS="\n"} { p="";v="";f="";h=""; for(i=1;i<=NF;i++){ if($i~/^Package: /)p=substr($i,10); else if($i~/^Version: /)v=substr($i,10); else if($i~/^Filename: /)f=substr($i,11); else if($i~/^SHA256: /)h=substr($i,9) } if(p==want && f!="" && h!="") print v"\t"f"\t"h }' "$TMP/Packages" \
    | sort -t "$(printf '\t')" -k1,1V | tail -1
}
rm -rf "$DEST.new"; mkdir -p "$DEST.new/root" || fail "cannot create $DEST.new"
for P in "postgresql-client-$VER" libpq5; do
  L=$(pick "$P"); [ -n "$L" ] || { rm -rf "$DEST.new"; fail "package $P not found for $CODENAME/$ARCH"; }
  V=$(printf '%s' "$L" | cut -f1); F=$(printf '%s' "$L" | cut -f2); H=$(printf '%s' "$L" | cut -f3)
  echo "  downloading $P $V"
  curl -fsSL -m 300 "$REPO/$F" -o "$TMP/$P.deb" || { rm -rf "$DEST.new"; fail "download of $P failed"; }
  echo "$H  $TMP/$P.deb" | sha256sum -c --quiet - || { rm -rf "$DEST.new"; fail "checksum mismatch for $P — not installing"; }
  dpkg-deb -x "$TMP/$P.deb" "$DEST.new/root" || { rm -rf "$DEST.new"; fail "could not unpack $P"; }
done

# 3) Small wrappers so the tools find their own libpq
REAL="$DEST/root/usr/lib/postgresql/$VER/bin"
LIBF=$(find "$DEST.new/root" -name 'libpq.so.5*' | head -1); [ -n "$LIBF" ] || { rm -rf "$DEST.new"; fail "libpq not found in package"; }
LIBDIR=$(dirname "$LIBF" | sed "s#^$DEST.new#$DEST#")
mkdir -p "$DEST.new/bin"
for T in pg_dump pg_restore psql; do
  [ -x "$DEST.new/root/usr/lib/postgresql/$VER/bin/$T" ] || continue
  printf '#!/bin/bash\nexport LD_LIBRARY_PATH="%s${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"\nexec "%s/%s" "$@"\n' "$LIBDIR" "$REAL" "$T" > "$DEST.new/bin/$T"
  chmod 755 "$DEST.new/bin/$T"
done
rm -rf "$DEST.old"; [ -e "$DEST" ] && mv "$DEST" "$DEST.old"; mv "$DEST.new" "$DEST" && rm -rf "$DEST.old"

# 4) Check it runs
if OUT=$("$DEST/bin/pg_dump" --version 2>&1) && printf '%s' "$OUT" | grep -q " $VER\."; then
  echo "Installed: $OUT"
  echo "Now run the backup:  bash ~/pb-sync/backend/backup_db.sh"
else
  echo "Installed, but pg_dump does not start:"; echo "$OUT"
  echo "Missing system libraries (if any):"; LD_LIBRARY_PATH="$LIBDIR" ldd "$REAL/pg_dump" 2>/dev/null | grep 'not found' || echo "  (none reported)"
  exit 1
fi
