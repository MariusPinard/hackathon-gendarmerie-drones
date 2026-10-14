import { useState } from 'react';
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
  const { setMission } = useMission();
  return <Layout mode={page === 'operations' ? 'CONDUITE DE L’OPÉRATION' : page === 'planning' ? 'PLANIFICATION' : page === 'resources' ? 'RESSOURCES' : 'ACCUEIL'} onHome={() => setPage('home')}>
    {page !== 'home' && <div className="workflow"><span className={page === 'planning' ? 'current' : ''}>01 Planification</span><span className={page === 'resources' ? 'current' : ''}>02 Ressources</span><span className={page === 'operations' ? 'current' : ''}>03 Conduite</span><button className="text-button" onClick={() => setPage('home')}>Retour à l’accueil</button></div>}
    {page === 'home' && <HomePage onPlan={() => { setMission(null); setPage('planning'); }} onLaunch={() => { setMission(null); setPage('import'); }} />}
    {page === 'import' && <ImportPage onImported={() => setPage('resources')} />}
    {page === 'planning' && <PlanningPage onPrepare={() => setPage('resources')} />}
    {page === 'resources' && <ResourcesPage onBack={() => setPage('planning')} onLaunch={() => setPage('operations')} />}
    {page === 'operations' && <OperationsPage />}
  </Layout>;
}
export function App() { return <AppProvider><Application /></AppProvider>; }
