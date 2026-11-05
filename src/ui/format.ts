const dateFmt = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const longFmt = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthYear = new Intl.DateTimeFormat('es', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export const fmtDate = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));
export const fmtDateLong = (iso: string) => longFmt.format(new Date(`${iso}T00:00:00Z`));
export const fmtShort = (iso: string) => shortFmt.format(new Date(`${iso}T00:00:00Z`));
export const fmtMonthYear = (iso: string) => monthYear.format(new Date(`${iso}T00:00:00Z`));
export const fmtRating = (r: number | null | undefined) => (r ? r.toFixed(2).replace('.', ',') : '—');
