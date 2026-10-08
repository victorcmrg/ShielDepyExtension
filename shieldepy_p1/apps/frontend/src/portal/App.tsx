// Rotas do portal. Cada página é um chunk separado (lazy): quem abre só o login não baixa o painel
// admin nem a ferramenta. Endereços .html antigos são redirecionados pelo servidor (server/legacyRoutes.ts).
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './layout/Shell';

const Login = lazy(() => import('./pages/Login'));
const DeviceConfirm = lazy(() => import('./pages/DeviceConfirm'));
const Projects = lazy(() => import('./pages/Projects'));
const Project = lazy(() => import('./pages/Project'));
const Run = lazy(() => import('./pages/Run'));
const Team = lazy(() => import('./pages/Team'));
const Account = lazy(() => import('./pages/Account'));
const Admin = lazy(() => import('./pages/Admin'));
const Tool = lazy(() => import('./pages/Tool'));

export function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/device-confirm" element={<DeviceConfirm />} />
        <Route
          path="/projects"
          element={
            <Shell page="projects" title="Projetos">
              <Projects />
            </Shell>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <Shell page="project" title="Projeto">
              <Project />
            </Shell>
          }
        />
        <Route
          path="/projects/:id/runs/:runId"
          element={
            <Shell page="project" title="Execução do caos">
              <Run />
            </Shell>
          }
        />
        <Route
          path="/team"
          element={
            <Shell page="team" title="Equipe" requireOwner>
              <Team />
            </Shell>
          }
        />
        <Route
          path="/account"
          element={
            <Shell page="account" title="Minha conta">
              <Account />
            </Shell>
          }
        />
        <Route
          path="/admin"
          element={
            <Shell page="platform" title="Plataforma" docTitle="Painel admin — ShielDepy" requireAdmin>
              <Admin />
            </Shell>
          }
        />
        <Route
          path="/tool"
          element={
            <Shell page="tool" title="Analisar no navegador" docTitle="ShielDepy — Guardião de Arquitetura" mainClassName="" requireAccess>
              <Tool />
            </Shell>
          }
        />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </Suspense>
  );
}
