import { useEffect, useId, useRef, useState } from 'react';

type DateParts = { day: string; month: string; year: string; time: string };
const emptyParts = (): DateParts => ({ day: '', month: '', year: '', time: '' });
function splitValue(value: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(value);
  return match ? { year: match[1]!, month: match[2]!, day: match[3]!, time: match[4]! } : emptyParts();
}

export function FrenchDateTime({ value, onChange, disabled = false, label = 'Date et heure de la mission' }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; label?: string;
}) {
  const [parts, setParts] = useState(() => splitValue(value));
  const [error, setError] = useState('');
  const lastEmitted = useRef(value);
  const hintId = useId();
  useEffect(() => {
    if (value !== lastEmitted.current) { setParts(splitValue(value)); setError(''); lastEmitted.current = value; }
  }, [value]);
  function update(field: keyof DateParts, next: string) {
    const draft = { ...parts, [field]: next };
    setParts(draft);
    let result = '';
    let message = '';
    if (draft.day && draft.month && draft.year && draft.time) {
      const year = Number(draft.year), month = Number(draft.month), day = Number(draft.day);
      const date = new Date(0); date.setUTCHours(0, 0, 0, 0); date.setUTCFullYear(year, month - 1, day);
      const valid = /^\d{4}$/.test(draft.year) && year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= 31
        && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
        && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.time);
      if (valid) result = `${draft.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${draft.time}`;
      else message = 'Vérifiez la date et l’heure (jour / mois / année, de 00:00 à 23:59).';
    }
    setError(message); lastEmitted.current = result; onChange(result);
  }
  return <fieldset className="french-datetime" disabled={disabled} aria-describedby={hintId}>
    <legend>{label}</legend>
    <div className="french-date-fields">
      <label>Jour<input inputMode="numeric" placeholder="JJ" maxLength={2} value={parts.day} aria-invalid={!!error} onChange={event => update('day', event.target.value.replace(/\D/g, ''))} /></label>
      <span aria-hidden="true">/</span><label>Mois<input inputMode="numeric" placeholder="MM" maxLength={2} value={parts.month} aria-invalid={!!error} onChange={event => update('month', event.target.value.replace(/\D/g, ''))} /></label>
      <span aria-hidden="true">/</span><label>Année<input inputMode="numeric" placeholder="AAAA" maxLength={4} value={parts.year} aria-invalid={!!error} onChange={event => update('year', event.target.value.replace(/\D/g, ''))} /></label>
      <label>Heure<input inputMode="numeric" placeholder="HH:mm" maxLength={5} value={parts.time} aria-invalid={!!error} onChange={event => update('time', event.target.value)} /></label>
    </div>
    <small id={hintId}>Jour / mois / année · heure locale, format 24 h</small>
    {error && <p className="notice error" role="alert">{error}</p>}
  </fieldset>;
}
