// Del log (data/log.json → entries) a lo que usa el motor: dosis aplicadas, slots planeados por los
// esquemas, pendientes (futuras) y vencidas (pasadas sin confirmar ni saltear). Spec §3.
import { dayFromIso, mondayOf, hourToDayFraction, weekdayOfDay } from './time.js';

const APPLIED = new Set(['confirmada', 'reconstruida']);
const byDay = (a, b) => a.day - b.day;

export function appliedTDoses(entries) {
  return entries
    .filter(e => e.tipo === 'dosis_t' && APPLIED.has(e.estado))
    .map(e => ({ day: dayFromIso(e.at), mg: e.mg, ester: e.ester, id: e.id, estado: e.estado }))
    .sort(byDay);
}

export function appliedAIDoses(entries) {
  return entries
    .filter(e => e.tipo === 'farmaco' && e.modo === 'toma' && e.farmaco === 'anastrozol' && APPLIED.has(e.estado))
    .map(e => ({ day: dayFromIso(e.at), mg: e.mg, id: e.id }))
    .sort(byDay);
}

// Slots de los esquemas con generaPendientes, hasta toDay (excluido).
export function schemeSlots(entries, toDay) {
  const esqs = entries
    .filter(e => e.tipo === 'esquema' && e.generaPendientes)
    .map(e => ({ e, start: dayFromIso(e.desde) }))
    .sort((a, b) => a.start - b.start);
  const slots = [];
  esqs.forEach((s, i) => {
    const end = i + 1 < esqs.length ? esqs[i + 1].start : toDay;
    // Días de aplicación: "cada N días" desde `desde` (ej. día por medio) o días de la semana a una hora fija.
    // `desde` = desde cuándo rige (corta al esquema anterior); `primeraAplicacion` (opcional) = desde cuándo aplica
    // (ej. el optimizador saltea aplicaciones: rige ya, pero la 1ra dosis es días después).
    const first = s.e.primeraAplicacion ? Math.max(dayFromIso(s.e.primeraAplicacion), s.start) : s.start;
    const days = [];
    if (s.e.intervaloDias > 0) {
      for (let d = first; d < end - 1e-9; d += s.e.intervaloDias) days.push(d);
    } else {
      const frac = hourToDayFraction(s.e.hora);
      for (let mon = mondayOf(first); mon < end; mon += 7) {
        for (const wd of [...s.e.dias].sort((x, y) => x - y)) {
          const day = mon + wd + frac;
          if (day >= first - 1e-9 && day < end) days.push(day);
        }
      }
    }
    days.forEach((day, n) => {
      const wd = weekdayOfDay(day);
      slots.push({ day, kind: 'dosis_t', esquemaId: s.e.id, ester: s.e.ester, mg: s.e.mg, concMgMl: s.e.concMgMl,
        sitio: s.e.sitio, profundidad: s.e.profundidad });
      for (const a of s.e.acompanantes || []) {
        // cadaN = 1 de cada N aplicaciones (contando desde la primera del esquema); si no, por día de la semana.
        const toca = a.cadaN > 0 ? n % a.cadaN === 0 : (a.dias || []).includes(wd);
        if (toca) slots.push({ day, kind: 'farmaco', esquemaId: s.e.id, farmaco: a.farmaco, mg: a.mg });
      }
    });
  });
  return slots.sort(byDay);
}

function isResolved(slot, entries) {
  return entries.some(e => e.slot && Math.abs(dayFromIso(e.slot) - slot.day) < 1e-6 &&
    (slot.kind === 'dosis_t' ? e.tipo === 'dosis_t' : (e.tipo === 'farmaco' && e.farmaco === slot.farmaco)));
}

// now y horizonDay en días del motor. allT/allAI = aplicadas + pendientes futuras (proyección).
export function buildTimeline(entries, now, horizonDay) {
  const tDoses = appliedTDoses(entries);
  const aiDoses = appliedAIDoses(entries);
  const pendientes = [], vencidas = [];
  for (const s of schemeSlots(entries, horizonDay)) {
    if (isResolved(s, entries)) continue;
    (s.day > now ? pendientes : vencidas).push(s);
  }
  const projT = pendientes.filter(s => s.kind === 'dosis_t')
    .map(s => ({ day: s.day, mg: s.mg, ester: s.ester, projected: true }));
  const projAI = pendientes.filter(s => s.kind === 'farmaco' && s.farmaco === 'anastrozol')
    .map(s => ({ day: s.day, mg: s.mg, projected: true }));
  return {
    tDoses, aiDoses, pendientes, vencidas,
    allT: tDoses.concat(projT).sort(byDay),
    allAI: aiDoses.concat(projAI).sort(byDay),
  };
}
