import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutGrid, FileText, Settings, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const navigation = [
  { name: 'Projects', href: '/dashboard/projects', icon: LayoutGrid },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
];

export const Sidebar: React.FC = () => {
  const { user } = useAuth();

  return (
    <aside className="w-[300px] h-screen fixed top-0 left-0 bg-card/50 backdrop-blur-3xl border-r border-border flex flex-col p-4 shadow-card z-50">
      <div className="flex items-center gap-3 px-2 py-4 mb-6">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 text-primary-foreground font-bold shadow-sm">
          V
        </div>
        <span className="font-semibold text-lg text-foreground tracking-wide">
          Vibe Agent
        </span>
      </div>

      <nav className="flex-1 space-y-2">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.name}
              to={item.href}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group ${
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground text-sm'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={`w-4 h-4 transition-colors ${
                      isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                    }`}
                  />
                  <span className="font-medium text-sm">{item.name}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-auto pt-4 border-t border-border">
        <NavLink
          to="/dashboard/profile"
          className={({ isActive }) =>
            `flex items-center gap-3 p-3 rounded-lg transition-colors group ${
              isActive
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-muted hover:text-foreground'
            }`
          }
        >
          <div className="w-10 h-10 rounded-full bg-secondary overflow-hidden flex-shrink-0 border border-border">
            {user?.profile_picture ? (
              <img src={user.profile_picture} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-primary flex items-center justify-center text-lg text-primary-foreground font-bold shadow-sm">
                <User className="h-5 w-5" />
              </div>
            )}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[15px] font-medium truncate text-foreground">
              {user?.name || 'User Profile'}
            </span>
            <span className="text-[13px] text-muted-foreground truncate">
              {user?.email || 'Set up your profile'}
            </span>
          </div>
        </NavLink>
      </div>
    </aside>
  );
};
