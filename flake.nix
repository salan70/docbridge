{
  description = "DocBridge development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, rust-overlay, ... }:
    let
      supportedSystems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];

      forAllSystems =
        function:
        nixpkgs.lib.genAttrs supportedSystems (
          system:
          function (
            import nixpkgs {
              inherit system;
              overlays = [ (import rust-overlay) ];
            }
          )
        );
    in
    {
      # The CLI, built from Rust source. Only the Cargo workspace, and the CLI
      # public contract used by CLI tests, are copied into the
      # build so unrelated repository changes do not rebuild it.
      packages = forAllSystems (pkgs: rec {
        docbridge = pkgs.rustPlatform.buildRustPackage {
          pname = "docbridge";
          inherit ((nixpkgs.lib.importTOML ./Cargo.toml).workspace.package) version;
          src = nixpkgs.lib.fileset.toSource {
            root = ./.;
            fileset = nixpkgs.lib.fileset.unions [
              ./Cargo.toml
              ./Cargo.lock
              ./crates
              ./docs/specs/vnext-contracts.md
            ];
          };
          cargoLock.lockFile = ./Cargo.lock;
          cargoBuildFlags = [
            "--package"
            "docbridge"
          ];
          # Test the crate that the executable is built from; `just verify` and
          # CI run the rest of the workspace tests.
          cargoTestFlags = [
            "--package"
            "docbridge"
          ];
          meta = {
            description = "Keep Markdown design docs and the code they describe linked";
            homepage = "https://github.com/salan70/docbridge";
            license = nixpkgs.lib.licenses.mit;
            mainProgram = "docbridge";
          };
        };
        default = docbridge;
      });

      devShells = forAllSystems (pkgs: {
        # `mkShellNoCC` keeps nixpkgs' C toolchain and Apple SDK variables out of
        # the shell; the Rust toolchain pinned by rust-toolchain.toml is supplied
        # explicitly and links with the host's system compiler.
        default = pkgs.mkShellNoCC {
          packages = [
            pkgs.actionlint
            pkgs.deadnix
            pkgs.just
            pkgs.nixfmt
            # Formats Markdown, JSON, and YAML.
            pkgs.oxfmt
            pkgs.rumdl
            (pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml)
            pkgs.shellcheck
            pkgs.shfmt
            pkgs.statix
          ];
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
