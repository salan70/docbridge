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
      # The vNext CLI, built from Rust source. Only the Cargo workspace is
      # copied into the build so unrelated repository changes do not rebuild it.
      packages = forAllSystems (pkgs: rec {
        docbridge = pkgs.rustPlatform.buildRustPackage {
          pname = "docbridge";
          inherit ((nixpkgs.lib.importTOML ./crates/docbridge/Cargo.toml).package) version;
          src = nixpkgs.lib.fileset.toSource {
            root = ./.;
            fileset = nixpkgs.lib.fileset.unions [
              ./Cargo.toml
              ./Cargo.lock
              ./crates
            ];
          };
          cargoLock.lockFile = ./Cargo.lock;
          cargoBuildFlags = [
            "--package"
            "docbridge"
          ];
          cargoTestFlags = [ "--workspace" ];
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
        # `mkShellNoCC` avoids exporting `SDKROOT`/`DEVELOPER_DIR` from nixpkgs'
        # Apple SDK on macOS. That SDK is built with an older Swift than the
        # system toolchain and breaks `swift build` for the bundled scanner.
        # The Rust toolchain is supplied explicitly below instead.
        default = pkgs.mkShellNoCC {
          packages = [
            pkgs.actionlint
            pkgs.bun
            pkgs.dart
            pkgs.deadnix
            pkgs.go
            # Runtime-backed scanner workers: the Java worker builds with the JDK;
            # the Python and Ruby workers run on these interpreters; ruff formats
            # and lints the Python worker.
            pkgs.jdk17_headless
            pkgs.python3
            pkgs.ruby
            pkgs.ruff
            # The related-gate CI recipe test executes the documented step,
            # which validates the gate's JSON report with jq.
            pkgs.jq
            pkgs.just
            # The npm package targets the Node.js runtime; verify-dist and
            # pack-smoke execute the built CLI with Node.
            pkgs.nodejs
            pkgs.nixfmt
            pkgs.rumdl
            (pkgs.rust-bin.fromRustupToolchainFile ./packages/rust-scanner/rust-toolchain.toml)
            pkgs.shellcheck
            pkgs.shfmt
            pkgs.statix
          ];
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
