import type { ReactNode } from 'react';

export function Layout({ children }: { children: ReactNode }) {
  return <main>
    <header><h1>Missions multi-drones</h1><p>Hackathon — prototype de simulation</p></header>
    {children}
  </main>;
}
