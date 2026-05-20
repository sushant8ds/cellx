import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { getToken, parseToken } from './lib/auth';
import NavBar from './components/NavBar';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import GridPage from './pages/GridPage';
import ConfiguratorPage from './pages/ConfiguratorPage';
import SystemAdminPage from './pages/SystemAdminPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <NavBar />
      <div style={{ padding: 0 }}>{children}</div>
    </div>
  );
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  const payload = parseToken(token);
  if (!payload || payload.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <NavBar />
      <div>{children}</div>
    </div>
  );
}

function SuperadminRoute({ children }: { children: React.ReactNode }) {
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  const payload = parseToken(token);
  if (!payload || !payload.isSuperadmin) return <Navigate to="/dashboard" replace />;
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
      <Route path="/" element={<ProtectedRoute><Navigate to="/dashboard" replace /></ProtectedRoute>} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/grid" element={<ProtectedRoute><GridPage /></ProtectedRoute>} />
      <Route path="/configurator" element={<AdminRoute><ConfiguratorPage /></AdminRoute>} />
      <Route path="/system-admin" element={<SuperadminRoute><SystemAdminPage /></SuperadminRoute>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
