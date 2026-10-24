# Alabama Governor 2026 according to current polling

A static, interactive view of the October 24, 2026 Jones–Tuberville model.
GitHub Pages address: <https://jacksonahannan.github.io/alabama-governor-2026-polling/>.
Switch between proportional and equal undecided allocation; inspect counties,
precincts, State House districts, and State Senate districts; drill into the
precincts of a county or district; search by name or HD/SD number. Selection,
scenario, and drilldown context are shareable through the URL fragment.

This is a published model snapshot, not a live election feed or an automatically
updated polling average. Statewide polling is matched exactly; demographic
crosstabs are soft constraints. The substantial age18–29 mismatch is disclosed
on the page and in `methodology.html`. District counts refer to the governor
vote, not legislative winners. District drilldown clips precinct shapes to the
selected House or Senate district. Each candidate's modeled vote weight is
scaled by the portion's share of the precinct's 2020 block VAP, with no land-area
weighting. Both candidates use the same fraction, retaining the model's uniform
within-precinct preference assumption. The pieces sum to the existing district
totals in both scenarios. Population counts and allocated vote weights are
shown; historical and demographic percentages are labeled whole-precinct context.

The page needs no server application, API key, map-tile service, or external
JavaScript/font request. Leaflet and licensed fonts are included locally.

## Local preview

From this directory, run `python -m http.server 8790` and open
`http://127.0.0.1:8790/`. A static HTTP server is required for JSON requests;
opening the HTML as a filesystem file is insufficient.

The browser data exporter and scoped publisher live in the private working
project as `scripts/build-alabama-governor-poll-dashboard.py` and
`scripts/publish-alabama-governor-poll-dashboard.py`. The publisher copies only
an explicit static-file allowlist into this public deployment repository.
No model fitting occurs in the browser or during publication.

From that project's root, rebuild browser data with
`.venv/bin/python scripts/build-alabama-governor-poll-dashboard.py` when the
saved model changes. Preview an allowlisted publication bundle with
`.venv/bin/python scripts/publish-alabama-governor-poll-dashboard.py --output /tmp/alabama-governor-public-preview`
(choose a new or empty directory). Publish a reviewed update with
`.venv/bin/python scripts/publish-alabama-governor-poll-dashboard.py --publish`.
GitHub Pages serves `main` at the root of the dedicated public repository.

See `ATTRIBUTION.md` for data/software rights and `data/provenance.json` for
source hashes and display-geometry processing.
