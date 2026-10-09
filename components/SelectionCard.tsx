import { Fragment, type ReactNode, type Ref } from 'react';

export type CardRow = [label: string, value: ReactNode];
export interface CardAction {
  label: string;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}
interface SelectionCardProps {
  cardRef: Ref<HTMLElement>;
  hidden: boolean;
  page: string;
  kind?: string;
  title?: string;
  status?: string;
  rows: CardRow[];
  actions: CardAction[];
  follow?: { pressed: boolean; onClick: () => void };
  bar?: { label: string; value: number; maximum: number };
  onClose: () => void;
}

/** 原作 YardFigure 的六块对象卡，业务只提供字段与动作。 */
export default function SelectionCard({ cardRef, hidden, page, kind, title, status, rows, actions, follow, bar, onClose }: SelectionCardProps) {
  const progress = bar ? Math.max(0, Math.min(1, bar.value / Math.max(1, bar.maximum))) * 100 : 0;
  return <aside className="card" id="card" ref={cardRef} data-page={page} role="region" aria-label="所选对象详情" hidden={hidden}>
    <div className="head"><span id="cardKind">{kind}</span><button id="cardClose" aria-label="关闭详情" title="关闭 (Esc)" onClick={onClose}>×</button></div>
    <div className="title" id="cardTitle">{title}</div>
    <div className="status" id="cardStatus">{status}</div>
    <div className="bar" id="cardBar" hidden={!bar}><span>{bar?.label}</span><div><i style={{ width: `${progress}%` }} /></div></div>
    <dl id="cardRows">{rows.map(([label, value], index) => <Fragment key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></Fragment>)}</dl>
    <div className="foot" id="cardFoot" hidden={!follow && actions.length === 0}>
      <button id="cardFollow" aria-pressed={follow?.pressed ?? false} title="跟随 (F)" hidden={!follow} onClick={follow?.onClick}>跟随</button>
      {actions.map(action => <button className="act" key={action.label} title={action.title} disabled={action.disabled} onClick={action.onClick}>{action.label}</button>)}
    </div>
  </aside>;
}
