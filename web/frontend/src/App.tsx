import { useEffect, useState } from 'react';
import { applyHash, fetchPage, state, useV } from './store';
import { TopBar } from './components/TopBar';
import { HomeView } from './components/HomeView';
import { CatsView } from './components/CatsView';
import { RankView } from './components/RankView';
import { ModalView } from './components/ModalView';
import { Toasts } from './components/Toasts';

export default function App() {
  useV();
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  useEffect(() => { applyHash(hash || '#/home'); }, [hash]);
  useEffect(() => {
    if (state.view === 'home' && !state.cache.pool.length && !state.loading) void fetchPage();
  }, []);

  return (
    <>
      <TopBar />
      <main>
        {state.view === 'home' && <HomeView />}
        {state.view === 'cats' && <CatsView />}
        {state.view === 'rank' && <RankView />}
      </main>
      <ModalView />
      <Toasts />
    </>
  );
}
