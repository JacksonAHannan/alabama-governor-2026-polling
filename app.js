import {
  GEOGRAPHIES, formatPercent, escapeHTML, marginLabel, marginColor,
  unitLabel, matchesParent, precinctPortion, resultsForUnit,
  parseState, stateFragment, searchIndex, findMatches,
} from './model.mjs?v=20261024-vap-clipped';

const $ = selector => document.querySelector(selector);
const mapElement = $('#map');
const statusElement = $('#map-status');
const geometryCache = new Map();
let model, state, map, index, featureGroup, parentOutline;
let renderVersion = 0;
let matches = [];
let activeSearch = -1;
const weightFormatter = new Intl.NumberFormat('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const populationFormatter = new Intl.NumberFormat('en-US', {maximumFractionDigits: 0});
const formatWeight = value => Number.isFinite(value) ? weightFormatter.format(value) : 'Unavailable';
const formatPopulation = value => Number.isFinite(value) ? populationFormatter.format(value) : 'Unavailable';

function clippedContext() {
  return state.layer === 'precinct' && ['house', 'senate'].includes(state.parent?.layer);
}

function currentResult(unit, layer = state.layer) {
  return resultsForUnit(model, layer, unit.id, state.scenario, state.parent);
}

async function getJSON(path) {
  const response = await fetch(path, {cache: 'no-cache'});
  if (!response.ok) throw new Error(`The file ${path} could not be loaded (${response.status}).`);
  return response.json();
}

function geometry(layer) {
  if (!geometryCache.has(layer)) {
    geometryCache.set(layer, getJSON(`data/${layer}.geojson`).catch(error => {
      geometryCache.delete(layer);
      throw error;
    }));
  }
  return geometryCache.get(layer);
}

function showError(error) {
  mapElement.dataset.ready = 'false';
  statusElement.hidden = false;
  statusElement.textContent = `The map could not load. ${error.message} Reload this page to try again.`;
  statusElement.setAttribute('role', 'alert');
}

function currentUnit() {
  return state.unit ? model.units[state.layer][state.unit] : null;
}

function parentUnit() {
  return state.parent ? model.units[state.parent.layer][state.parent.id] : null;
}

function publishState(replace = false) {
  const fragment = stateFragment(state);
  if (location.hash !== fragment) history[replace ? 'replaceState' : 'pushState'](null, '', fragment);
}

function transition(next, fit = 'preserve') {
  state = {...state, ...next};
  publishState();
  hideSearch();
  render(fit).catch(showError);
}

function selectUnit(layer, id) {
  const unit = Object.hasOwn(model.units[layer] ?? {}, id) ? model.units[layer][id] : null;
  if (!unit) return;
  const parent = layer === 'precinct' && matchesParent(unit, state.parent, model) ? state.parent : null;
  transition({layer, unit: id, parent}, 'unit');
}

function drillDown() {
  if (!currentUnit() || state.layer === 'precinct') return;
  transition({parent: {layer: state.layer, id: state.unit}, layer: 'precinct', unit: null}, 'context');
}

function goStatewide() {
  transition({unit: null, parent: null}, 'state');
}

function breadcrumb() {
  const parts = ['<button type="button" data-nav="state">Alabama</button>'];
  if (state.parent) {
    parts.push(`<span aria-hidden="true">/</span><button type="button" data-nav="parent">${escapeHTML(unitLabel(state.parent.layer, parentUnit()))}</button>`);
  }
  parts.push(`<span aria-hidden="true">/</span><span>${escapeHTML(GEOGRAPHIES[state.layer].plural)}</span>`);
  if (currentUnit()) parts.push(`<span aria-hidden="true">/</span><span aria-current="location">${escapeHTML(unitLabel(state.layer, currentUnit()))}</span>`);
  $('#breadcrumb').innerHTML = parts.join('');
}

function resultRows(unit, layer = state.layer) {
  const result = currentResult(unit, layer);
  if (!result) return '<p>No modeled estimate is available for this area.</p>';
  return `<div class="result-row"><span>Doug Jones <small>Democrat</small></span><span class="result-numbers"><strong class="jones-text">${formatPercent(result.jones_share)}</strong><small><span id="selection-jones-weight" data-value="${result.jones_vote_weight}">${formatWeight(result.jones_vote_weight)}</span> weight units</small></span></div>
    <div class="result-row"><span>Tommy Tuberville <small>Republican</small></span><span class="result-numbers"><strong class="tuberville-text">${formatPercent(result.tuberville_share)}</strong><small><span id="selection-tuberville-weight" data-value="${result.tuberville_vote_weight}">${formatWeight(result.tuberville_vote_weight)}</span> weight units</small></span></div>
    <p class="selection-margin">${marginLabel(result.margin)}</p>
    <p class="vote-weight-note">Modeled vote weights follow 2024 turnout. They are not predicted 2026 vote counts.</p>`;
}

function inspection() {
  const unit = currentUnit();
  $('#selection-title').textContent = unit ? unitLabel(state.layer, unit)
    : state.parent ? unitLabel(state.parent.layer, parentUnit()) : 'Explore Alabama';
  $('#selection-subtitle').textContent = unit
    ? state.layer === 'precinct' ? clippedContext() ? 'Clipped precinct portion · modeled governor vote' : 'Whole-precinct modeled governor vote' : 'Modeled governor vote'
    : state.parent ? 'District total; select a precinct portion to inspect its estimate.' : 'Select an area or use search.';
  if (!unit && state.parent?.layer === 'county') $('#selection-subtitle').textContent = 'County total; select a precinct to inspect its estimate.';
  $('#selection-results').innerHTML = unit ? resultRows(unit)
    : state.parent ? resultRows(parentUnit(), state.parent.layer)
    : '<p class="selection-instruction">Select an area on the map or use search to inspect candidate support. Counties and legislative districts can be explored by precinct.</p>';
  const notes = [];
  if (clippedContext()) {
    notes.push(`<p class="boundary-note"><strong>Precincts clipped to ${escapeHTML(unitLabel(state.parent.layer, parentUnit()))}.</strong> Candidate vote weights use the portion’s share of each precinct’s 2020 voting-age population. Both candidates receive the same fraction, so support percentages retain the whole-precinct assumption.</p>`);
    const portion = unit && precinctPortion(model, state.parent, unit.id);
    if (portion) notes.push(`<h3>Precinct portion in this district</h3><dl class="context-list portion-context">
      <dt>2020 voting-age population inside</dt><dd id="portion-vap" data-value="${portion.vap}">${formatPopulation(portion.vap)}</dd>
      <dt>Whole-precinct voting-age population</dt><dd id="portion-precinct-vap" data-value="${portion.precinct_vap}">${formatPopulation(portion.precinct_vap)}</dd>
      <dt>Share allocated to this district</dt><dd id="portion-allocation-weight" data-value="${portion.allocation_weight}">${formatPercent(portion.allocation_weight)}</dd></dl>`);
  }
  if (unit && state.layer === 'precinct') {
    const demographics = unit.demographics;
    if (demographics) {
      notes.push(`<h3>Whole-precinct population context</h3><dl class="context-list">
        <dt>Black citizen adults</dt><dd>${formatPercent(demographics.black_share)}</dd>
        <dt>White citizen adults</dt><dd>${formatPercent(demographics.white_share)}</dd>
        <dt>BA+ among white adults 25+</dt><dd>${formatPercent(demographics.white_college_share)}</dd></dl>
        <p>Resident population proxies, not measured voter composition.</p>`);
    }
    if (unit.history) {
      notes.push(`<h3>Whole-precinct historical comparisons</h3><dl class="context-list">
        <dt>Jones, 2020 Senate</dt><dd>${formatPercent(unit.history.jones2020_share)}</dd>
        <dt>Harris, 2024 president</dt><dd>${formatPercent(unit.history.harris2024_share)}</dd>
        <dt>Jones, May nominee vote</dt><dd>${formatPercent(unit.history.may_jones_share)}</dd></dl>
        <p>Two-candidate shares on the current precinct geography. The May comparison combines votes cast in separate party primaries.</p>`);
    }
    if (unit.membership) {
      for (const layer of ['house', 'senate']) {
        const memberships = unit.membership[layer] ?? [];
        if (memberships.length) notes.push(`<h3>${GEOGRAPHIES[layer].plural}</h3><p>${memberships.map(entry =>
          `<button class="text-button" type="button" data-select-layer="${layer}" data-select-id="${escapeHTML(entry.id)}">${layer === 'house' ? 'HD' : 'SD'}-${escapeHTML(entry.id)}</button>${memberships.length > 1 ? ` (${formatPercent(entry.weight)} of allocated population)` : ''}`
        ).join(' ')}</p>`);
      }
    }
  }
  $('#selection-context').innerHTML = notes.join('');
  $('#drill-down').hidden = !unit || state.layer === 'precinct';
  $('#clear-selection').hidden = !unit;
}

function summary() {
  const totals = model.scenarios[state.scenario];
  $('#statewide-jones').textContent = formatPercent(totals.jones_share);
  $('#statewide-tuberville').textContent = formatPercent(totals.tuberville_share);
  $('#house-counts').innerHTML = `<strong class="jones-text">Jones ${totals.house.Jones}</strong> · <strong class="tuberville-text">Tuberville ${totals.house.Tuberville}</strong>`;
  $('#senate-counts').innerHTML = `<strong class="jones-text">Jones ${totals.senate.Jones}</strong> · <strong class="tuberville-text">Tuberville ${totals.senate.Tuberville}</strong>`;
  for (const button of document.querySelectorAll('[data-scenario]')) {
    button.setAttribute('aria-pressed', String(button.dataset.scenario === state.scenario));
  }
  $('#geography').value = state.layer;
  $('#view-title').textContent = state.parent ? `Precincts in ${unitLabel(state.parent.layer, parentUnit())}` : `${GEOGRAPHIES[state.layer].singular} estimates`;
  $('#view-description').textContent = state.layer === 'precinct'
    ? clippedContext() ? 'Precinct portions clipped to the district; modeled vote weights are allocated by voting-age population.' : 'Select a precinct for modeled support, historical voting, and demographic context.'
    : 'Select an area to inspect its estimate, then explore its precincts.';
  breadcrumb();
  inspection();
}

function legend() {
  const rows = ['Jones', 'Tuberville'].map(candidate => `<div class="legend-row"><span>${candidate}</span><div class="legend-bins">${model.palette[candidate].map((color, i) =>
    `<span class="legend-bin"><i class="legend-swatch" style="background:${color}"></i><small>${i === 6 ? '60+' : `${i * 10}–<${i * 10 + 10}`}</small></span>`).join('')}</div></div>`);
  $('#legend').innerHTML = `<p class="legend-heading">Estimated winner’s lead · percentage points</p>${rows.join('')}<p class="legend-other"><i style="background:${model.palette.missing}"></i> No modeled weight <i style="background:${model.palette.tie}"></i> Tied</p>`;
}

async function render(fit = 'preserve') {
  const version = ++renderVersion;
  mapElement.dataset.ready = 'false';
  statusElement.hidden = false;
  statusElement.textContent = 'Loading map…';
  summary();
  const layer = state.layer;
  const geometryLayer = clippedContext() ? `${state.parent.layer}-precincts` : layer;
  let data, contextData;
  try {
    [data, contextData] = await Promise.all([geometry(geometryLayer), state.parent ? geometry(state.parent.layer) : null]);
  } catch (error) {
    // A failed request for a view the reader has left cannot invalidate the
    // newer, successfully loaded layer.
    if (version !== renderVersion) return;
    throw error;
  }
  if (version !== renderVersion) return;
  if (featureGroup) map.removeLayer(featureGroup);
  if (parentOutline) map.removeLayer(parentOutline);
  const visible = data.features.filter(feature => layer !== 'precinct'
    || (clippedContext() ? feature.properties.district_id === state.parent.id
      && matchesParent(model.units.precinct[feature.properties.id], state.parent, model)
      : matchesParent(model.units.precinct[feature.properties.id], state.parent, model)));
  featureGroup = L.geoJSON({type: 'FeatureCollection', features: visible}, {
    smoothFactor: 0,
    style(feature) {
      const unit = model.units[layer][feature.properties.id];
      const selected = state.unit === unit.id;
      return {
        fillColor: marginColor(model.palette, currentResult(unit)?.margin), fillOpacity: 1,
        color: selected ? '#202020' : '#777777', weight: selected ? 2 : layer === 'precinct' ? .32 : .6,
        opacity: selected ? 1 : .7,
      };
    },
    onEachFeature(feature, featureLayer) {
      const unit = model.units[layer][feature.properties.id];
      const result = currentResult(unit);
      const portionLabel = clippedContext() ? '<br>Clipped precinct portion' : '';
      const weights = clippedContext() && result ? `<br>Jones ${formatWeight(result.jones_vote_weight)} / Tuberville ${formatWeight(result.tuberville_vote_weight)} modeled weight units` : '';
      featureLayer.bindTooltip(`<strong>${escapeHTML(unitLabel(layer, unit))}</strong>${portionLabel}<br>${marginLabel(result?.margin)}${weights}`, {sticky: true, opacity: 1});
      featureLayer.on('click', event => {
        L.DomEvent.stopPropagation(event);
        selectUnit(layer, unit.id);
      });
    },
  }).addTo(map);
  featureGroup.eachLayer(featureLayer => {
    const unit = model.units[layer][featureLayer.feature.properties.id];
    const element = featureLayer.getElement();
    element.dataset.unitId = unit.id;
    if (clippedContext()) {
      element.dataset.pieceId = featureLayer.feature.properties.piece_id;
      element.dataset.districtId = featureLayer.feature.properties.district_id;
    }
    element.setAttribute('aria-label', `${unitLabel(layer, unit)}${clippedContext() ? ', clipped precinct portion' : ''}: ${marginLabel(currentResult(unit)?.margin)}`);
    element.setAttribute('tabindex', '-1');
    element.setAttribute('role', 'button');
    if (state.unit === unit.id) featureLayer.bringToFront();
  });
  if (state.parent) {
    const parentFeature = contextData.features.find(feature => feature.properties.id === state.parent.id);
    parentOutline = L.geoJSON(parentFeature, {interactive: false, pane: 'boundary', style: {color: '#202020', weight: 1.8, fill: false, opacity: .85}}).addTo(map);
  }
  let bounds;
  if (fit === 'unit' && state.unit) {
    featureGroup.eachLayer(featureLayer => { if (featureLayer.feature.properties.id === state.unit) bounds = featureLayer.getBounds(); });
  } else if (fit === 'context' || fit === 'state') {
    bounds = parentOutline?.getBounds() ?? featureGroup.getBounds();
  }
  if (bounds?.isValid()) map.fitBounds(bounds, {padding: [22, 22], maxZoom: layer === 'county' ? 11 : 14, animate: false});
  statusElement.textContent = '';
  statusElement.hidden = true;
  mapElement.dataset.layer = layer;
  mapElement.dataset.geometry = geometryLayer;
  mapElement.dataset.count = String(visible.length);
  mapElement.dataset.ready = 'true';
  mapElement.setAttribute('aria-label', `${GEOGRAPHIES[layer].plural} map, ${visible.length} areas. Use search for keyboard selection.`);
}

function hideSearch() {
  matches = [];
  activeSearch = -1;
  $('#search-results').innerHTML = '';
  $('#search').setAttribute('aria-expanded', 'false');
  $('#search').removeAttribute('aria-activedescendant');
}

function search() {
  matches = findMatches(index, $('#search').value, state.layer);
  activeSearch = -1;
  const query = $('#search').value.trim();
  $('#search-results').innerHTML = matches.map((entry, i) => `<button type="button" role="option" id="search-option-${i}" data-geography="${entry.geography}" data-unit-id="${escapeHTML(entry.unit.id)}"><span>${escapeHTML(entry.label)}</span><small>${GEOGRAPHIES[entry.geography].singular}</small></button>`).join('');
  $('#search').setAttribute('aria-expanded', String(matches.length > 0));
  $('#search').removeAttribute('aria-activedescendant');
  $('#search-status').textContent = !query ? '' : matches.length ? `${matches.length} matches shown. Use arrow keys and Enter to select.` : 'No matching area. Try a county, precinct, HD number, or SD number.';
}

function wireControls() {
  for (const button of document.querySelectorAll('[data-scenario]')) button.addEventListener('click', () => transition({scenario: button.dataset.scenario}));
  $('#geography').addEventListener('change', event => transition({layer: event.target.value, unit: null, parent: null}, 'state'));
  $('#drill-down').addEventListener('click', drillDown);
  $('#reset-map').addEventListener('click', goStatewide);
  $('#clear-selection').addEventListener('click', () => transition({unit: null}));
  $('#breadcrumb').addEventListener('click', event => {
    const action = event.target.closest('[data-nav]')?.dataset.nav;
    if (action === 'state') goStatewide();
    if (action === 'parent') transition({layer: state.parent.layer, unit: state.parent.id, parent: null}, 'unit');
  });
  $('#selection-context').addEventListener('click', event => {
    const button = event.target.closest('[data-select-layer]');
    if (button) selectUnit(button.dataset.selectLayer, button.dataset.selectId);
  });
  $('#search').setAttribute('role', 'combobox');
  $('#search').setAttribute('aria-autocomplete', 'list');
  $('#search').setAttribute('aria-expanded', 'false');
  $('#search-results').setAttribute('role', 'listbox');
  $('#search').addEventListener('input', search);
  $('#search').addEventListener('focus', search);
  $('#search').addEventListener('keydown', event => {
    if (event.key === 'Escape') return hideSearch();
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && matches.length) {
      event.preventDefault();
      activeSearch = (activeSearch + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      for (const [i, button] of [...$('#search-results').children].entries()) {
        button.classList.toggle('is-active', i === activeSearch);
        button.setAttribute('aria-selected', String(i === activeSearch));
      }
      const option = $(`#search-option-${activeSearch}`);
      $('#search').setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({block: 'nearest'});
    }
    if (event.key === 'Enter' && matches.length) {
      event.preventDefault();
      const entry = matches[Math.max(0, activeSearch)];
      selectUnit(entry.geography, entry.unit.id);
    }
  });
  $('#search-results').addEventListener('click', event => {
    const button = event.target.closest('[data-geography]');
    if (button) selectUnit(button.dataset.geography, button.dataset.unitId);
  });
  document.addEventListener('click', event => { if (!event.target.closest('.search-control')) hideSearch(); });
  const restore = () => {
    state = parseState(model, location.hash);
    render(state.unit ? 'unit' : state.parent ? 'context' : 'state').catch(showError);
  };
  window.addEventListener('popstate', restore);
  window.addEventListener('hashchange', restore);
}

async function initialize() {
  model = await getJSON('data/model.json');
  if (!model.units?.precinct || !model.scenarios?.proportional || !model.palette?.Jones
    || !model.district_precincts?.house || !model.district_precincts?.senate) throw new Error('The model data is incomplete.');
  state = parseState(model, location.hash);
  publishState(true);
  index = searchIndex(model);
  map = L.map('map', {preferCanvas: false, zoomSnap: .25, minZoom: 5, maxZoom: 16, zoomAnimation: false, fadeAnimation: false}).setView([32.7, -86.7], 6);
  map.createPane('boundary');
  map.getPane('boundary').style.zIndex = 450;
  map.getPane('boundary').style.pointerEvents = 'none';
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  map.attributionControl.addAttribution('Data: <a href="https://redistrictingdatahub.org/">Redistricting Data Hub</a>');
  L.control.scale({imperial: true, metric: false, maxWidth: 90}).addTo(map);
  legend();
  wireControls();
  await render(state.unit ? 'unit' : state.parent ? 'context' : 'state');
}

initialize().catch(showError);
