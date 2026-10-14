import type { ReactNode } from 'react';

export interface MapTool { id: string; label: string; icon: string; disabled?: boolean }

export function MapWorkspace({ children, tools, panel, onPanel, title, panelContent, locked = false, fleet, onFleet, fleetOpen = false, floating, status, rightPanel, rightPanelTitle, onRightPanelClose }: {
  children: ReactNode; tools: MapTool[]; panel: string | null; onPanel: (panel: string | null) => void;
  title: string; panelContent: ReactNode; locked?: boolean; fleet?: ReactNode; fleetOpen?: boolean;
  onFleet?: () => void; floating?: ReactNode; status?: ReactNode; rightPanel?: ReactNode; rightPanelTitle?: string; onRightPanelClose?: () => void;
}) {
  return <section className="map-workspace">
    <div className="workspace-map">{children}</div>
    <div className="workspace-tools" aria-label="Panneaux cartographiques">
      {tools.map(tool => <button key={tool.id} className={`square-tool ${panel === tool.id ? 'active' : ''}`} title={tool.label}
        aria-label={tool.label} aria-expanded={panel === tool.id} disabled={locked || tool.disabled}
        onClick={() => {
          if (fleetOpen && window.matchMedia('(max-width: 1100px)').matches) onFleet?.();
          onPanel(panel === tool.id ? null : tool.id);
        }}><span className="tool-icon" aria-hidden="true">{tool.icon}</span><span>{tool.label}</span><span className="tool-arrow" aria-hidden="true">{panel === tool.id ? '‹' : '›'}</span></button>)}
    </div>
    {panel && <aside className="slide-panel" aria-label={title} inert={locked}>
      <div className="slide-panel-heading"><h2>{title}</h2><button aria-label="Fermer le panneau" onClick={() => onPanel(null)}>‹</button></div>
      <div className="slide-panel-body">{panelContent}</div>
    </aside>}
    {onFleet && <button className={`fleet-toggle square-tool ${fleetOpen && !rightPanel ? 'active' : ''}`} disabled={locked} aria-label="Afficher la flotte" aria-expanded={fleetOpen && !rightPanel} onClick={() => {
      if (!fleetOpen && window.matchMedia('(max-width: 1100px)').matches) onPanel(null);
      onFleet();
    }}><span className="fleet-tool-icon" aria-hidden="true"><img src="/image/drone_icone.png" alt="" /></span><span>Flotte</span><span className="tool-arrow" aria-hidden="true">{fleetOpen && !rightPanel ? '›' : '‹'}</span></button>}
    {fleet && fleetOpen && !rightPanel && <aside className="fleet-panel" aria-label="Flotte de drones" inert={locked}>{fleet}</aside>}
    {rightPanel && <aside className="right-panel" aria-label={rightPanelTitle ?? 'Résultat de l’estimation'} inert={locked}>
      {onRightPanelClose && <div className="slide-panel-heading"><h2>{rightPanelTitle ?? 'Estimation du dispositif'}</h2><button aria-label="Fermer le résultat" onClick={onRightPanelClose}>›</button></div>}
      <div className="right-panel-content">{rightPanel}</div>
    </aside>}
    <div className="workspace-status">{status}</div>
    {floating}
  </section>;
}
