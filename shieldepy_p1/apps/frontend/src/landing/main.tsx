import { createRoot, hydrateRoot } from 'react-dom/client';
import '../styles/landing.css';
import { installMagnet } from '../shared/magnet';
import { Landing } from './Landing';

installMagnet();

const root = document.getElementById('root')!;
// build: o HTML já veio pronto (scripts/prerender.mjs) e o React só hidrata; dev: renderiza do zero
if (root.firstElementChild) hydrateRoot(root, <Landing />);
else createRoot(root).render(<Landing />);
