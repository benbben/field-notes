// Per-substance dose calculation.
// Returns { total, totalUnit, display }
// Dose row shape (loose): { substance, subtype, form, prep, amount, unit, claimed_potency, claimed_potency_unit, ... }

export function calcDose(d) {
  const sub = (d.substance || '').toLowerCase();
  switch (sub) {
    case 'psilocybin': {
      const g = Number(d.amount) || 0;
      return { total: g, totalUnit: 'g', display: `${fmt(g, 1)} g` };
    }
    case 'mdma': {
      if (d.form === 'crystal') {
        const mg = Number(d.amount) || 0;
        return { total: mg, totalUnit: 'mg', display: `${fmt(mg, 0)} mg` };
      }
      // pressed pill / capsule: units * claimed mg/unit
      const u = Number(d.amount) || 0;
      const per = Number(d.claimed_potency) || 0;
      const total = u * per;
      return { total, totalUnit: 'mg', display: `${fmt(u,1)} × ${fmt(per,0)} mg = ${fmt(total,0)} mg` };
    }
    case 'lsd': {
      const u = Number(d.amount) || 0;
      const per = Number(d.claimed_potency) || 100;
      const total = u * per;
      return { total, totalUnit: 'µg', display: `${fmt(u,2)} × ${fmt(per,0)} µg = ${fmt(total,0)} µg` };
    }
    case '2cb': {
      if (d.form === 'pill') {
        // pressed pill: units * claimed mg per pill
        const u = Number(d.amount) || 0;
        const per = Number(d.claimed_potency) || 0;
        const total = u * per;
        return { total, totalUnit: 'mg', display: `${fmt(u,1)} × ${fmt(per,1)} mg = ${fmt(total,1)} mg` };
      }
      if (d.form === 'volumetric') {
        // volumetric liquid: mL * mg/mL
        const ml = Number(d.amount) || 0;
        const conc = Number(d.claimed_potency) || 0;
        const total = ml * conc;
        return { total, totalUnit: 'mg', display: `${fmt(ml,1)} mL × ${fmt(conc,1)} mg/mL = ${fmt(total,1)} mg` };
      }
      // hcl / hbr powder (or form not chosen yet): plain mg
      const mg = Number(d.amount) || 0;
      return { total: mg, totalUnit: 'mg', display: `${fmt(mg, 1)} mg` };
    }
    case 'cannabis': {
      const a = Number(d.amount) || 0;
      const unit = d.unit || (d.form === 'edible' ? 'mg' : 'g');
      return { total: a, totalUnit: unit, display: `${fmt(a, unit==='mg'?0:2)} ${unit}` };
    }
    case 'dmt': {
      const mg = Number(d.amount) || 0;
      return { total: mg, totalUnit: 'mg', display: `${fmt(mg, 1)} mg` };
    }
    case 'adderall': {
      const mg = Number(d.amount) || 0;
      return { total: mg, totalUnit: 'mg', display: `${fmt(mg, 0)} mg` };
    }
    default: {
      const a = Number(d.amount) || 0;
      const u = d.unit || '';
      return { total: a, totalUnit: u, display: `${fmt(a, 2)} ${u}`.trim() };
    }
  }
}

function fmt(n, p) {
  if (Number.isNaN(n)) return '0';
  return Number(n.toFixed(p)).toString();
}

// Single source of truth for display names. Use this everywhere a substance id is shown.
const LABELS = {
  psilocybin: 'Psilocybin',
  mdma: 'MDMA',
  lsd: 'LSD',
  '2cb': '2C-B',
  cannabis: 'Cannabis',
  dmt: 'DMT',
  adderall: 'Adderall',
  custom: 'Custom',
};

export function labelFor(id) {
  const key = (id || '').toLowerCase();
  if (LABELS[key]) return LABELS[key];
  if (!key) return '';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export const SUBSTANCES = [
  { id: 'psilocybin', label: labelFor('psilocybin') },
  { id: 'mdma', label: labelFor('mdma') },
  { id: 'lsd', label: labelFor('lsd') },
  { id: '2cb', label: labelFor('2cb') },
  { id: 'cannabis', label: labelFor('cannabis') },
  { id: 'dmt', label: labelFor('dmt') },
  { id: 'adderall', label: labelFor('adderall') },
  { id: 'custom', label: labelFor('custom') }
];

// Form options per substance for the picker
export const FORMS = {
  psilocybin: [{ id: 'dried', label: 'Dried' }],
  mdma: [
    { id: 'crystal', label: 'Crystal' },
    { id: 'pressed', label: 'Pressed pill' },
    { id: 'capsule', label: 'Capsule' }
  ],
  lsd: [
    { id: 'tab', label: 'Tab' },
    { id: 'liquid', label: 'Liquid drop' },
    { id: 'gel', label: 'Gel tab' }
  ],
  '2cb': [
    { id: 'hcl', label: 'HCl powder' },
    { id: 'hbr', label: 'HBr powder' },
    { id: 'pill', label: 'Pressed pill' },
    { id: 'volumetric', label: 'Volumetric liquid' }
  ],
  cannabis: [
    { id: 'flower', label: 'Flower' },
    { id: 'edible', label: 'Edible' },
    { id: 'vape', label: 'Vape' },
    { id: 'concentrate', label: 'Concentrate' }
  ],
  dmt: [
    { id: 'vaped', label: 'Vaporized' },
    { id: 'changa', label: 'Changa (smoked)' }
  ],
  adderall: [
    { id: 'IR', label: 'IR' },
    { id: 'XR', label: 'XR' }
  ]
};

// Defaults applied when a 2C-B form is chosen (prefilled, editable).
export const TWO_CB_DEFAULTS = {
  hcl: { amount: 10, unit: 'mg', claimed_potency: '', claimed_potency_unit: '' },
  hbr: { amount: 10, unit: 'mg', claimed_potency: '', claimed_potency_unit: '' },
  pill: { amount: '', unit: 'units', claimed_potency: 10, claimed_potency_unit: 'mg' },
  volumetric: { amount: '', unit: 'mL', claimed_potency: '', claimed_potency_unit: 'mg/mL' },
};

export const PREPS_PSILO = [
  { id: 'raw', label: 'Raw' },
  { id: 'lemon-tek', label: 'Lemon tek' },
  { id: 'tea', label: 'Tea' },
  { id: 'capsule', label: 'Capsule' }
];
