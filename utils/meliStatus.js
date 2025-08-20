function mapMeliToInterno(status, substatus) {
  const s = (status || '').toLowerCase();
  const sub = (substatus || '').toLowerCase();

  if (s === 'delivered') return 'entregado';
  if (s === 'cancelled') return 'cancelado';
  if (s === 'shipped')   return 'en_camino';
  if (s === 'ready_to_ship' || s === 'handling' || s === 'pending')
    return 'pendiente';

  if (s === 'not_delivered') {
    if (sub.includes('delay') || sub === 'delayed') return 'demorado';
    if (sub.includes('reschedul') || sub === 'rescheduled') return 'reprogramado';
    return 'no_entregado';
  }
  // default
  return 'pendiente';
}
const TERMINALES = new Set(['delivered','cancelled']); // terminales en MeLi

module.exports = { mapMeliToInterno, TERMINALES };
