#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EDITOR_DIR="$ROOT/editors/vscode"
VERSION="$(bun -e "console.log(require('$EDITOR_DIR/package.json').version)")"
OUT="$ROOT/.tmp/speclink-vscode-$VERSION.vsix"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/speclink-vsix.XXXXXX")"

trap 'rm -rf "$WORK"' EXIT

mkdir -p "$ROOT/.tmp" "$WORK/extension"

cp "$EDITOR_DIR/package.json" "$WORK/extension/package.json"
cp "$EDITOR_DIR/README.md" "$WORK/extension/README.md"
cp -R "$EDITOR_DIR/out" "$WORK/extension/out"
cp -R "$EDITOR_DIR/node_modules" "$WORK/extension/node_modules"
mkdir -p "$WORK/extension/server"
cp "$ROOT/package.json" "$WORK/extension/server/package.json"
cp -R "$ROOT/src" "$WORK/extension/server/src"
mkdir -p "$WORK/extension/server/node_modules"
cp -R "$EDITOR_DIR/node_modules/typescript" "$WORK/extension/server/node_modules/typescript"

cat > "$WORK/[Content_Types].xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="ts" ContentType="application/typescript"/>
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
  <Default Extension="xml" ContentType="text/xml"/>
</Types>
XML

cat > "$WORK/extension.vsixmanifest" <<XML
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="speclink-vscode" Version="$VERSION" Publisher="speclink"/>
    <DisplayName>SpecLink</DisplayName>
    <Description xml:space="preserve">Minimal VS Code-compatible client that launches the SpecLink language server.</Description>
    <Tags>__MSG_@@extension</Tags>
    <Categories>Other</Categories>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
  </Assets>
</PackageManifest>
XML

(cd "$WORK" && zip -qr "$OUT" .)

echo "$OUT"
