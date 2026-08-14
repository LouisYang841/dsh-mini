#!/bin/sh
# dsh-mini one-line installer.
#   curl -fsSL https://github.com/LouisYang841/dsh-mini/raw/main/scripts/install.sh | sh
# Requires: Node >= 22.15 (zstd in node:zlib), curl. On Termux: pkg install nodejs.
set -e

BASE="${DSH_HOME:-$HOME/.dsh-mini}"
VERSION="${DSH_VERSION:-latest}"
BUNDLE="$BASE/dsh-mini.mjs"

mkdir -p "$BASE" "$BASE/bin"

echo "dsh-mini: downloading $VERSION artifact..."
curl -fL "https://github.com/LouisYang841/dsh-mini/releases/${VERSION}/download/dsh-mini.mjs" -o "$BUNDLE"
chmod 644 "$BUNDLE"

cat > "$BASE/bin/dsh-mini" <<'EOF'
#!/bin/sh
# dsh-mini launcher: exec node against the self-contained bundle.
BUNDLE="${DSH_HOME:-$HOME/.dsh-mini}/dsh-mini.mjs"
if [ ! -f "$BUNDLE" ]; then
	echo "dsh-mini: bundle not found at $BUNDLE — rerun the installer" >&2
	exit 1
fi
exec node "$BUNDLE" "$@"
EOF
chmod 755 "$BASE/bin/dsh-mini"

case ":$PATH:" in
	*":$BASE/bin:"*) ;;
	*)
		for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
			if [ -f "$rc" ] && ! grep -q "$BASE/bin" "$rc" 2>/dev/null; then
				echo "export PATH=\"$BASE/bin:\$PATH\"" >> "$rc"
				echo "dsh-mini: added $BASE/bin to $rc"
			fi
		done
		;;
esac

echo ""
echo "installed: $BASE/bin/dsh-mini"
echo "run:       dsh-mini            (new shell, or: export PATH=\"$BASE/bin:\$PATH\")"
echo "usage:     dsh-mini [model] [--provider <id>] [--mode <id>] [--resume <id>] [--sessions]"
