// Pure display/state helpers. Estimates are read from the published model;
// the browser never fits, recalibrates, or allocates modeled votes.
export const GEOGRAPHIES = {
  county: {singular: 'County', plural: 'Counties'},
  precinct: {singular: 'Precinct', plural: 'Precincts'},
  house: {singular: 'State House district', plural: 'State House districts'},
  senate: {singular: 'State Senate district', plural: 'State Senate districts'},
};

export const formatPercent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'Unavailable';
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

export function marginLabel(margin) {
  if (!Number.isFinite(margin)) return 'No modeled vote weight';
  if (margin === 0) return 'Modeled tie';
  return `${margin > 0 ? 'Jones' : 'Tuberville'} +${Math.abs(margin).toFixed(1)} points`;
}

export function marginColor(palette, margin) {
  if (!Number.isFinite(margin)) return palette.missing;
  if (margin === 0) return palette.tie;
  const bin = Math.min(6, Math.floor(Math.abs(margin) / 10));
  return palette[margin > 0 ? 'Jones' : 'Tuberville'][bin];
}

export function unitLabel(geography, unit) {
  if (geography === 'county') return `${unit.name} County`;
  if (geography === 'house') return `State House District ${unit.id}`;
  if (geography === 'senate') return `State Senate District ${unit.id}`;
  return unit.name;
}

export function matchesParent(unit, parent) {
  if (!parent) return true;
  if (parent.layer === 'county') return unit.county_fips === parent.id;
  return (unit.membership?.[parent.layer] ?? []).some(entry => entry.id === parent.id && entry.weight > 0);
}

export function parseState(model, fragment) {
  const parameters = new URLSearchParams(fragment.replace(/^#/, ''));
  const scenario = parameters.get('scenario') === 'equal' ? 'equal' : 'proportional';
  const requested = parameters.get('layer');
  const layer = Object.hasOwn(GEOGRAPHIES, requested) ? requested : 'county';
  const parentParts = (parameters.get('parent') ?? '').split(':');
  const parent = layer === 'precinct' && ['county', 'house', 'senate'].includes(parentParts[0])
    && Object.hasOwn(model.units[parentParts[0]] ?? {}, parentParts[1])
    ? {layer: parentParts[0], id: parentParts[1]} : null;
  const id = parameters.get('unit');
  const record = Object.hasOwn(model.units[layer] ?? {}, id) ? model.units[layer][id] : null;
  const unit = record && (layer !== 'precinct' || matchesParent(record, parent)) ? id : null;
  return {scenario, layer, parent, unit};
}

export function stateFragment(state) {
  const parameters = new URLSearchParams({scenario: state.scenario, layer: state.layer});
  if (state.parent) parameters.set('parent', `${state.parent.layer}:${state.parent.id}`);
  if (state.unit) parameters.set('unit', state.unit);
  return `#${parameters}`;
}

const normalize = text => String(text).normalize('NFKD').toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim();

export function searchIndex(model) {
  return Object.entries(GEOGRAPHIES).flatMap(([geography, labels]) =>
    Object.values(model.units[geography]).map(unit => {
      const alias = geography === 'house' ? `hd${unit.id} hd ${unit.id}` : geography === 'senate' ? `sd${unit.id} sd ${unit.id}` : '';
      return {geography, unit, label: unitLabel(geography, unit),
        text: normalize(`${unitLabel(geography, unit)} ${labels.singular} ${unit.county_name ?? ''} ${unit.id} ${alias}`)};
    }));
}

export function findMatches(index, query, preferredLayer, limit = 12) {
  const normalized = normalize(query);
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/);
  return index.filter(entry => tokens.every(token => entry.text.includes(token)))
    .map(entry => ({...entry, score: (normalize(entry.label) === normalized ? 100 : 0)
      + (normalize(entry.unit.name) === normalized ? 80 : 0)
      + (entry.geography === preferredLayer ? 20 : 0)
      + (entry.geography === 'county' ? 10 : 0)}))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, undefined, {numeric: true}))
    .slice(0, limit);
}
