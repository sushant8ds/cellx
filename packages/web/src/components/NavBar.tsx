import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const navItems = [
  { path: '/dashboard', label: '📊 Dashboard' },
  { path: '/grid', label: '📋 Records' },
  { path: '/solver', label: '🗓️ Exam Allocation' },
  { path: '/configurator', label: '⚙️ Configurator' },
];

export default function NavBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  return (
    <nav style={{
      background: '#1e293b',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      padding: '0 24px',
      height: 56,
      gap: 4,
      position: 'sticky',
      top: 0,
      zIndex: 50,
      boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
    }}>
      {/* Logo */}
      <div style={{ fontWeight: 700, fontSize: 16, marginRight: 24, color: '#60a5fa', whiteSpace: 'nowrap' }}>
        ⚙️ UDCP
      </div>

      {/* Nav links */}
      <div style={{ display: 'flex', gap: 4, flex: 1 }}>
        {navItems.map(item => {
          const active = location.pathname === item.path;
          return (
            <button key={item.path} onClick={() => navigate(item.path)}
              style={{
                padding: '6px 14px',
                background: active ? '#2563eb' : 'transparent',
                color: active ? '#fff' : '#94a3b8',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!active) (e.target as HTMLButtonElement).style.color = '#fff'; }}
              onMouseLeave={e => { if (!active) (e.target as HTMLButtonElement).style.color = '#94a3b8'; }}
            >
              {item.label}
            </button>
          );
        })}

        {/* Superadmin link */}
        {user?.isSuperadmin && (
          <button onClick={() => navigate('/system-admin')}
            style={{
              padding: '6px 14px',
              background: location.pathname === '/system-admin' ? '#7c3aed' : 'transparent',
              color: location.pathname === '/system-admin' ? '#fff' : '#94a3b8',
              border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
            }}>
            🔧 System Admin
          </button>
        )}
      </div>

      {/* User info + logout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {user?.role} · {user?.tenantId?.slice(0, 8)}…
        </span>
        <button onClick={logout}
          style={{
            padding: '5px 12px', background: 'transparent', color: '#94a3b8',
            border: '1px solid #334155', borderRadius: 6, cursor: 'pointer', fontSize: 12,
          }}>
          Sign Out
        </button>
      </div>
    </nav>
  );
}
