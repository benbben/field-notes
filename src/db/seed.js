import { db } from './db.js';

// Strain seed library
const PSILO_STRAINS = [
  'Penis Envy','Golden Teacher','Melmak','B+','Albino A+','Natal Super Strain','Tidal Wave'
];

export async function ensureSeed() {
  const have = await db.strains.where({ substance: 'psilocybin' }).count();
  if (have === 0) {
    const rows = PSILO_STRAINS.map(name => ({
      id: cryptoId(), substance: 'psilocybin', name
    }));
    await db.strains.bulkAdd(rows);
  }
}

export function cryptoId() {
  // 16 random bytes hex
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('');
}
