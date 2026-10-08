import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '../styles/portal.css';
import { installMagnet } from '../shared/magnet';
import { App } from './App';
import { AuthProvider } from './auth';
import { UiProvider } from './ui/UiProvider';

installMagnet();

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <AuthProvider>
      <UiProvider>
        <App />
      </UiProvider>
    </AuthProvider>
  </BrowserRouter>
);
