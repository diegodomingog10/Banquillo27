/** Compatibilidad: pantallas de datos (generar, importar, explorar) con el nuevo diseño. */
import type { ReactNode } from 'react';
import { Button as KButton, Card, attrClass } from './kit';

export { money } from './kit';

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return <Card title={title} actions={actions} className="mb-5">{children}</Card>;
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-display text-lg font-bold">{value}</div>
    </div>
  );
}

export function Button({ children, onClick, disabled, variant = 'primary', type = 'button' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: 'primary' | 'secondary'; type?: 'button' | 'submit';
}) {
  return <KButton type={type} onClick={onClick} disabled={disabled} variant={variant}>{children}</KButton>;
}

export const attrColor = attrClass;
