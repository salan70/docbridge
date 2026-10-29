# Draft Nixpkgs package for the DocBridge vNext CLI (pkgs/by-name/do/docbridge/package.nix).
#
# Pending: the first vNext release (v0.17.0) and the maintainer's submission
# from their own account. Nothing here has been submitted to or accepted by
# Nixpkgs. Before submitting:
#   - confirm `version` matches the published tag;
#   - replace both `lib.fakeHash` values with the hashes Nix reports on the
#     first build (`src.hash`, then `cargoHash`);
#   - add the maintainer who consented to `meta.maintainers`.
# See docs/contributing/releasing.md#nixpkgs-packaging-pending and PR.md.
#
# It builds from the tagged Rust source with the repository's Cargo.lock and
# never reuses the published release binaries.
{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:

rustPlatform.buildRustPackage (finalAttrs: {
  pname = "docbridge";
  version = "0.17.0"; # The first vNext release; pending publication.

  src = fetchFromGitHub {
    owner = "salan70";
    repo = "docbridge";
    tag = "v${finalAttrs.version}";
    hash = lib.fakeHash; # Pending: filled in from the first build of the tag.
  };

  cargoHash = lib.fakeHash; # Pending: filled in from the first build of the tag.

  cargoBuildFlags = [
    "--package"
    "docbridge"
  ];
  cargoTestFlags = [ "--workspace" ];

  # The CLI has no --version flag; run the offline commands the release smoke uses.
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    $out/bin/docbridge --help >/dev/null
    $out/bin/docbridge docs list | grep -q getting-started
    runHook postInstallCheck
  '';

  meta = {
    description = "Keep Markdown design docs and the code they describe linked";
    homepage = "https://github.com/salan70/docbridge";
    changelog = "https://github.com/salan70/docbridge/blob/v${finalAttrs.version}/CHANGELOG.md";
    license = lib.licenses.mit;
    maintainers = [ ]; # Pending: the consenting Nixpkgs maintainer.
    mainProgram = "docbridge";
    platforms = lib.platforms.unix;
  };
})
