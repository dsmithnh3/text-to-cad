# Private Vector Studio library

`supacad-equipment-svg-library.zip` is third-party SupaCAD-derived SVG
equipment art. Extracted files land in `apps/web/src/vector/assets/`
(gitignored). `.cursor/install.sh` imports the ZIP before the Viewer build
when the archive is present.

**Canonical private host:** commit the ZIP only on
[`dsmithnh3/text-to-cad-cloud`](https://github.com/dsmithnh3/text-to-cad-cloud)
(private, not a public fork). Point Cursor Cloud Agents at that repo so
Library assets exist after install.

On public remotes (`dsmithnh3/text-to-cad`, `earthtojake/text-to-cad`) keep
the ZIP untracked. Never open a PR to public upstream that adds this archive.
