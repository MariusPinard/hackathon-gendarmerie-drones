import type { ReactNode } from 'react';

export interface MapTool { id: string; label: string; icon: string; disabled?: boolean }

export function MapWorkspace({ children, tools, panel, onPanel, title, panelContent, locked = false, fleet, onFleet, fleetOpen = false, floating, status }: {
  children: ReactNode; tools: MapTool[]; panel: string | null; onPanel: (panel: string | null) => void;
  title: string; panelContent: ReactNode; locked?: boolean; fleet?: ReactNode; fleetOpen?: boolean;
  onFleet?: () => void; floating?: ReactNode; status?: ReactNode;
}) {
  return <section className="map-workspace">
    <div className="workspace-map">{children}</div>
    <div className="workspace-tools" aria-label="Panneaux cartographiques">
      {tools.map(tool => <button key={tool.id} className={`square-tool ${panel === tool.id ? 'active' : ''}`} title={tool.label}
        aria-label={tool.label} aria-expanded={panel === tool.id} disabled={locked || tool.disabled}
        onClick={() => {
          if (fleetOpen && window.matchMedia('(max-width: 900px)').matches) onFleet?.();
          onPanel(panel === tool.id ? null : tool.id);
        }}><span className="tool-icon" aria-hidden="true">{tool.icon}</span><span>{tool.label}</span><span className="tool-arrow" aria-hidden="true">{panel === tool.id ? '‹' : '›'}</span></button>)}
    </div>
    {panel && <aside className="slide-panel" aria-label={title} inert={locked}>
      <div className="slide-panel-heading"><h2>{title}</h2><button aria-label="Fermer le panneau" onClick={() => onPanel(null)}>‹</button></div>
      <div className="slide-panel-body">{panelContent}</div>
    </aside>}
    {onFleet && <button className={`fleet-toggle square-tool ${fleetOpen ? 'active' : ''}`} disabled={locked} aria-label="Afficher la flotte" aria-expanded={fleetOpen} onClick={() => {
      if (!fleetOpen && window.matchMedia('(max-width: 900px)').matches) onPanel(null);
      onFleet();
    }}><span aria-hidden="true">▤</span><span>Flotte</span><span aria-hidden="true">{fleetOpen ? '›' : '‹'}</span></button>}
    {fleet && fleetOpen && <aside className="fleet-panel" aria-label="Flotte de drones" inert={locked}>{fleet}</aside>}
    <div className="workspace-status">{status}</div>
    {floating}
  </section>;
}
