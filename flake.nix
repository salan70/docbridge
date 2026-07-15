{
  description = "DocBridge development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      supportedSystems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];

      forAllSystems =
        function: nixpkgs.lib.genAttrs supportedSystems (system: function nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        # `mkShellNoCC` avoids pulling in a C compiler the project does not need
        # (it is pure Bun/TypeScript). On macOS the default `mkShell` stdenv
        # exports `SDKROOT`/`DEVELOPER_DIR` pointing at nixpkgs' Apple SDK, which
        # is built with an older Swift than the system toolchain and breaks
        # `swift build` for the bundled Swift scanner. Dropping the CC wrapper
        # leaves those variables unset so the system Swift toolchain works.
        default = pkgs.mkShellNoCC {
          packages = [
            pkgs.actionlint
            pkgs.bun
            pkgs.dart
            pkgs.deadnix
            pkgs.direnv
            pkgs.git
            pkgs.just
            # The npm package targets the Node.js runtime; verify-dist and
            # pack-smoke execute the built CLI with Node.
            pkgs.nodejs
            pkgs.nixfmt
            pkgs.rumdl
            pkgs.shellcheck
            pkgs.shfmt
            pkgs.statix
          ];
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
