{
  description = "Scribble — Supernote scribble-erase plugin";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      pkgsFor = system: import nixpkgs { inherit system; };

      # Toolchain the plugin needs: node (metro bundler), zip (packaging),
      # jq (PluginConfig.json), python3 (buildPlugin.sh fallbacks),
      # android-tools (adb push to the device, optional), bash (the repo's
      # buildPlugin.sh has a #!/bin/bash shebang — no /bin/bash inside a
      # Nix shell, so it's invoked as `bash buildPlugin.sh`).
      buildTools = pkgs: with pkgs; [ nodejs_22 zip jq python3 android-tools bash ];

      # JS-only plugin build as an embedded bash script — no buildPlugin.sh
      # needed (and no zip-in-PATH requirement: everything is referenced by
      # store path). Usage from the repo root:
      #   nix run .# -- .
      buildScript = pkgs:
        let
          node = "${pkgs.nodejs_22}/bin";
          ziptool = "${pkgs.zip}/bin";
          jqtool = "${pkgs.jq}/bin";
        in
        pkgs.writeShellScriptBin "build-scribble" ''
          set -euo pipefail
          ROOT="''${1:-$PWD}"
          cd "$ROOT"
          ROOT="$PWD"
          export PATH="${node}:${ziptool}:${jqtool}:$PATH"

          NAME="$(jq -r '.name' package.json)"
          GEN="$ROOT/build/generated"
          OUT="$ROOT/build/outputs"
          mkdir -p "$GEN" "$OUT"

          echo "==> Bundling JS ($NAME)..."
          npx react-native bundle \
            --entry-file index.js \
            --bundle-output "$GEN/$NAME.bundle" \
            --platform android \
            --assets-dest "$GEN" \
            --dev false

          echo "==> Config + icon..."
          cp PluginConfig.json "$GEN/PluginConfig.json"
          if [[ -f assets/icon.png ]]; then
            cp assets/icon.png "$GEN/icon.png"
            jq --arg p "/icon.png" '.iconPath = $p' \
              "$GEN/PluginConfig.json" > "$GEN/PluginConfig.json.tmp" \
              && mv "$GEN/PluginConfig.json.tmp" "$GEN/PluginConfig.json"
          fi

          echo "==> Packaging -> $OUT/$NAME.snplg"
          rm -f "$OUT/$NAME.snplg"
          (cd "$GEN" && zip -r "$OUT/$NAME.snplg" .)
          echo "==> Done: $OUT/$NAME.snplg"
        '';
    in
    {
      devShells = forAllSystems (system: {
        default = (pkgsFor system).mkShell {
          name = "scribble-dev";
          packages = buildTools (pkgsFor system);
          shellHook = ''
            echo "Scribble dev shell: node/npx, zip, jq, python3, adb, bash ready."
            echo "Build with: bash buildPlugin.sh   (or)   nix run .# -- ."
          '';
        };
      });

      packages = forAllSystems (system: {
        default = buildScript (pkgsFor system);
      });

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${buildScript (pkgsFor system)}/bin/build-scribble";
        };
      });
    };
}
