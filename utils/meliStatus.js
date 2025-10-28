function mapMeliToInterno(status, substatus) {
  const s   = (status    || '').toLowerCase();
  const sub = (substatus || '').toLowerCase();

  // Substatus mandan si existen:
  if (sub.includes('resched')) return 'reprogramado'; // buyer_rescheduled / rescheduled / delivery_rescheduled
  if (sub.includes('delay'))   return 'demorado';     // delayed / with_delay / etc.

  // Status “puros”:
  if (s === 'delivered')      return 'entregado';
  if (s === 'cancelled')      return 'cancelado';
  if (s === 'shipped')        return 'en_camino';
  if (s === 'ready_to_ship' ||
      s === 'handling'   ||
      s === 'pending')        return 'pendiente';
  if (s === 'not_delivered')  return 'no_entregado';

  return 'pendiente';
}

const TERMINALES = new Set(['delivered','cancelled']);
module.exports = { mapMeliToInterno, TERMINALES };
