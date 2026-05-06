/**
 * QueVendi · utilidades globales
 *
 * Helpers de fecha/hora con zona horaria fija "America/Lima".
 * Soporta timestamps ISO con o sin sufijo de zona — si el string no trae
 * "Z" / "+HH" / "-HH" se asume UTC y se le agrega "Z" antes de parsear.
 */
function formatFechaPeru(timestamp) {
  if (!timestamp) return '';
  const ts = timestamp.match(/[Z+\-]\d|Z$/)
    ? timestamp
    : timestamp + 'Z';
  return new Date(ts).toLocaleDateString('es-PE', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function formatHoraPeru(timestamp) {
  if (!timestamp) return '';
  const ts = timestamp.match(/[Z+\-]\d|Z$/)
    ? timestamp
    : timestamp + 'Z';
  return new Date(ts).toLocaleTimeString('es-PE', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatFechaHoraPeru(timestamp) {
  if (!timestamp) return '';
  return formatFechaPeru(timestamp) + ' ' + formatHoraPeru(timestamp);
}
