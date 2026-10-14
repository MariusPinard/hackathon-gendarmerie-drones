import { useEffect, useState } from 'react';
import { AppProvider, useMission } from './AppContext';
import { Layout } from '../components/Layout/Layout';
import { HomePage } from '../pages/HomePage';
import { PlanningPage } from '../pages/PlanningPage';
import { ResourcesPage } from '../pages/ResourcesPage';
import { OperationsPage } from '../pages/OperationsPage';
import { ImportPage } from '../pages/ImportPage';

type Page = 'home' | 'planning' | 'import' | 'resources' | 'operations';
function Application() {
  const [page, setPage] = useState<Page>('home');
  const { setMission, navigationLocked } = useMission();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [page]);
  const mapMode = ['planning', 'resources', 'operations'].includes(page);
  return <Layout mapMode={mapMode} locked={navigationLocked} mode={page === 'operations' ? 'CONDUITE DE L’OPÉRATION' : page === 'planning' ? 'PLANIFICATION' : page === 'resources' ? 'RESSOURCES' : page === 'import' ? 'IMPORT MISSION' : 'ACCUEIL'} onHome={() => setPage('home')}>
    {page === 'import' && <div className="workflow"><span>Importer une mission</span><button className="text-button" onClick={() => setPage('home')}>Retour à l’accueil</button></div>}
    {page === 'home' && <HomePage onPlan={() => { setMission(null); setPage('planning'); }} onLaunch={() => { setMission(null); setPage('import'); }} />}
    {page === 'import' && <ImportPage onImported={() => setPage('resources')} />}
    {page === 'planning' && <PlanningPage onPrepare={() => setPage('resources')} />}
    {page === 'resources' && <ResourcesPage onBack={() => setPage('planning')} onLaunch={() => setPage('operations')} />}
    {page === 'operations' && <OperationsPage onResources={() => setPage('resources')} />}
  </Layout>;
}
export function App() { return <AppProvider><Application /></AppProvider>; }
