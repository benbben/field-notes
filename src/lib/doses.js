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

export const SUBSTANCES = [
  { id: 'psilocybin', label: 'Psilocybin' },
  { id: 'mdma', label: 'MDMA' },
  { id: 'lsd', label: 'LSD' },
  { id: 'cannabis', label: 'Cannabis' },
  { id: 'dmt', label: 'DMT' },
  { id: 'adderall', label: 'Adderall' },
  { id: 'custom', label: 'Custom' }
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

export const PREPS_PSILO = [
  { id: 'raw', label: 'Raw' },
  { id: 'lemon-tek', label: 'Lemon tek' },
  { id: 'tea', label: 'Tea' },
  { id: 'capsule', label: 'Capsule' }
];
