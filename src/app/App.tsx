import { useState } from 'react';
import { AppProvider } from './AppContext';
import { Layout } from '../components/Layout/Layout';
import { HomePage } from '../pages/HomePage';
import { PlanningPage } from '../pages/PlanningPage';
import { ResourcesPage } from '../pages/ResourcesPage';
import { OperationsPage } from '../pages/OperationsPage';

type Page = 'home' | 'planning' | 'resources' | 'operations';

export function App() {
  const [page, setPage] = useState<Page>('home');
  return <AppProvider><Layout>
    <nav aria-label="Navigation principale">
      <button onClick={() => setPage('home')}>Accueil</button>
      <button onClick={() => setPage('planning')}>Planification</button>
      <button onClick={() => setPage('resources')}>Ressources</button>
      <button onClick={() => setPage('operations')}>Opérations</button>
    </nav>
    {page === 'home' && <HomePage onPlan={() => setPage('planning')} onLaunch={() => setPage('operations')} />}
    {page === 'planning' && <PlanningPage />}
    {page === 'resources' && <ResourcesPage />}
    {page === 'operations' && <OperationsPage />}
  </Layout></AppProvider>;
}
