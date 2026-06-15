{
  description = "SpecLink development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { nixpkgs, ... }:
    let
      supportedSystems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];

      forAllSystems = function:
        nixpkgs.lib.genAttrs supportedSystems
          (system: function nixpkgs.legacyPackages.${system});
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
            pkgs.bun
            pkgs.direnv
            pkgs.git
            pkgs.just
          ];
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixpkgs-fmt);
    };
}
