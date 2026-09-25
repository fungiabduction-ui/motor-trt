// Objetivos acordados en el brainstorming del 24/09/2026 (spec 2026-09-24-historia-optimizador-lipidos-design.md).
// Viven en data/model.json → objetivos; esto es solo el valor por defecto / de respaldo.
export const DEFAULT_OBJETIVOS = {
  t: { objetivo: [650, 800], techo: 827, pisoDuro: 500, ref: [241, 827] },
  e2: { objetivo: [22, 30], tolerableMax: 35, pisoDuro: 20, refMax: 40, natural: 21.8 },
  pesos: { tFuera: 1, tBajo: 3, oscilacion: 1, e2Fuera: 1, e2Bajo: 4, e2Alto: 1.5, anastrozolMgSem: 1, anastrozolConEstatina: 0.5, aplicacion: 0.01 },
  lipidos: {
    laboratorio: { ldl: 116, no_hdl: 130, apob: 100 },
    escMuyAlto: { ldl: 55, apob: 65, nota: 'ESC 2019 riesgo muy alto (placa documentada en imagen)' },
  },
};

// Nombres (paciente, cardiólogo) viven en data/model.json → perfil (privado); el código público no tiene ninguno.
export function perfilOf(model) {
  return { nombre: model?.perfil?.nombre || '', cardiologo: model?.perfil?.cardiologo || 'tu cardiólogo' };
}

export function objetivosOf(model) {
  return model && model.objetivos ? model.objetivos : DEFAULT_OBJETIVOS;
}
