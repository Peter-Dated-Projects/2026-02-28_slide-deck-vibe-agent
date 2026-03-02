import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { LogOut, Moon, Sun, Monitor, CreditCard, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function SettingsPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');

  // Simply mock the theme setting for now
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="max-w-4xl pb-12">
      <div className="mb-10">
        <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account preferences and application settings.</p>
      </div>

      <div className="space-y-8">
        {/* Appearance Section */}
        <section className="bg-card/50 backdrop-blur-xl border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-border/50 bg-muted/20">
            <h2 className="text-base font-semibold text-foreground">Appearance</h2>
            <p className="text-xs text-muted-foreground mt-1">Customize how the application looks.</p>
          </div>
          <div className="p-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setTheme('light')}
                className={`flex-1 flex flex-col items-center justify-center gap-3 p-4 rounded-xl border-2 transition-all ${
                  theme === 'light' ? 'border-primary bg-primary/5' : 'border-border hover:border-border/80 bg-background'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center">
                  <Sun className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium text-foreground">Light</span>
              </button>
              
              <button
                onClick={() => setTheme('dark')}
                className={`flex-1 flex flex-col items-center justify-center gap-3 p-4 rounded-xl border-2 transition-all ${
                  theme === 'dark' ? 'border-primary bg-primary/5' : 'border-border hover:border-border/80 bg-background'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center">
                  <Moon className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium text-foreground">Dark</span>
              </button>
              
              <button
                onClick={() => setTheme('system')}
                className={`flex-1 flex flex-col items-center justify-center gap-3 p-4 rounded-xl border-2 transition-all ${
                  theme === 'system' ? 'border-primary bg-primary/5' : 'border-border hover:border-border/80 bg-background'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center border border-border">
                  <Monitor className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium text-foreground">System</span>
              </button>
            </div>
          </div>
        </section>

        {/* Billing Section (Placeholder) */}
        <section className="bg-card/50 backdrop-blur-xl border border-border rounded-xl shadow-sm overflow-hidden" id="billing">
          <div className="px-6 py-5 border-b border-border/50 bg-muted/20">
            <h2 className="text-base font-semibold text-foreground">Billing & Subscription</h2>
            <p className="text-xs text-muted-foreground mt-1">Manage your payment methods and current plan.</p>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border border-border/50">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-background rounded-full border border-border">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-medium text-sm text-foreground">Current Plan: Starter</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">$0.00 / month</p>
                </div>
              </div>
              <button className="border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-muted rounded-md transition-colors text-foreground">
                Upgrade Plan
              </button>
            </div>
          </div>
        </section>

        {/* Domains Section (Placeholder) */}
        <section className="bg-card/50 backdrop-blur-xl border border-border rounded-xl shadow-sm overflow-hidden" id="domains">
          <div className="px-6 py-5 border-b border-border/50 bg-muted/20">
            <h2 className="text-base font-semibold text-foreground">Registered Domains</h2>
            <p className="text-xs text-muted-foreground mt-1">Manage custom domains attached to your projects.</p>
          </div>
          <div className="p-6 flex flex-col items-center justify-center space-y-3 pb-8 pt-8">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center border border-border/50 mb-2">
              <Globe className="h-6 w-6 text-muted-foreground opacity-50" />
            </div>
            <p className="text-sm text-foreground font-medium">No domains connected yet</p>
            <p className="text-xs text-muted-foreground text-center max-w-sm">
              Connect your custom domain to publish your slide decks directly to your audience.
            </p>
            <button className="mt-4 bg-[#2E3330] px-4 py-2 text-sm font-medium text-white hover:bg-[#3a3f3c] inline-flex items-center justify-center rounded-md transition-colors">
              Add Domain
            </button>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="bg-card/50 backdrop-blur-xl border border-destructive/20 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-destructive/10 bg-destructive/5 text-destructive">
            <h2 className="text-base font-semibold">Danger Zone</h2>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-sm text-foreground">Log out from your account</h3>
                <p className="text-xs text-muted-foreground mt-1 text-balance">
                  You will be safely logged out of this device. You will need to re-authenticate to access your projects.
                </p>
              </div>
              <button 
                onClick={handleLogout}
                className="bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 inline-flex items-center justify-center gap-2 rounded-md transition-colors whitespace-nowrap"
              >
                <LogOut className="h-4 w-4" />
                <span>Log Out</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
