import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import NavBar from './components/NavBar';
import LoginPage from './pages/LoginPage';
import UniversalSheetPage from './pages/UniversalSheetPage';
import DashboardPage from './pages/DashboardPage';
import GridPage from './pages/GridPage';
import ConfiguratorPage from './pages/ConfiguratorPage';
import SystemAdminPage from './pages/SystemAdminPage';
import SolverPage from './pages/SolverPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <NavBar />
      <div style={{ padding: 0 }}>{children}</div>
    </div>
  );
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!user || user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <NavBar />
      <div>{children}</div>
    </div>
  );
}

function SuperadminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!user || !user.isSuperadmin) return <Navigate to="/dashboard" replace />;
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <NavBar />
      <div>{children}</div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><UniversalSheetPage /></ProtectedRoute>} />
      <Route path="/sheet" element={<ProtectedRoute><UniversalSheetPage /></ProtectedRoute>} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/grid" element={<ProtectedRoute><GridPage /></ProtectedRoute>} />
      <Route path="/solver" element={<ProtectedRoute><SolverPage /></ProtectedRoute>} />
      <Route path="/configurator" element={<AdminRoute><ConfiguratorPage /></AdminRoute>} />
      <Route path="/system-admin" element={<SuperadminRoute><SystemAdminPage /></SuperadminRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
