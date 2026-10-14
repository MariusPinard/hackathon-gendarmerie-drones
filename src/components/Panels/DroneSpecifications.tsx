import type { DroneModel } from '../../types/drone';

export function DroneSpecifications({ model }: { model: DroneModel }) {
  return <details className="drone-specifications"><summary>Caractéristiques & compatibilité</summary>
    <dl><div><dt>Pluie · simulation</dt><dd>{model.incompatibleWithRain ? 'Non' : 'Oui'}</dd></div><div><dt>Nuit · simulation</dt><dd>{model.nightCapable ? 'Oui' : 'Non'}</dd></div>
    <div><dt>Tenue au vent</dt><dd>{model.windResistanceMetersPerSecond === undefined ? 'Non renseignée' : `${model.windResistanceMetersPerSecond.toLocaleString('fr-FR')} m/s`}</dd></div><div><dt>Zoom</dt><dd>{model.zoom ?? 'Non renseigné'}</dd></div></dl>
    {model.manufacturerRainProtection && <p className="muted">Constructeur : {model.manufacturerRainProtection}</p>}
    {model.specificationSource && <a href={model.specificationSource} target="_blank" rel="noreferrer">Fiche constructeur ↗</a>}
  </details>;
}
