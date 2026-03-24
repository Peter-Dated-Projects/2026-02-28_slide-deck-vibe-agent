/**
 * ---------------------------------------------------------------------------
 * (c) 2026 Freedom, LLC.
 * This file is part of the SlideDeckVibeAgent System.
 *
 * All Rights Reserved. This code is the confidential and proprietary 
 * information of Freedom, LLC ("Confidential Information"). You shall not 
 * disclose such Confidential Information and shall use it only in accordance 
 * with the terms of the license agreement you entered into with Freedom, LLC.
 * ---------------------------------------------------------------------------
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api';
const SetupProfilePage: React.FC = () => {
  const { user, loginWithGoogle, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [field, setField] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(120); // 2 minutes
  const fields = [
    'Business',
    'Finance',
    'Engineering',
    'Design',
    'Management',
    'Marketing',
    'Other'
  ];
  // Timer Effect
  React.useEffect(() => {
    if (timeLeft <= 0) {
      // Force logout when timer expires
      api.post('/auth/logout').then(() => {
        window.location.href = '/login?expired=true';
      }).catch(() => {
        window.location.href = '/login?expired=true';
      });
      return;
    }
    const timer = setInterval(() => {
      setTimeLeft(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);
  // Before Unload Effect
  React.useEffect(() => {
      const handleBeforeUnload = () => {
          // Fire and forget logout if they close the tab
          // Navigator.sendBeacon is better for synchronous exit requests
          // Fallback relies on the backend completely
          navigator.sendBeacon(`${api.defaults.baseURL}/auth/logout`);
      };
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !field) {
      setError('First name, last name, and field are required.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      // Need a way to update auth context user - we'll navigate and let App route handle, 
      // or we can force a page reload to grab fresh context if context lacks a setter.
      // Better yet, our API call will succeed, and we'll reload window or depend on router
      await api.patch('/user/profile', {
        first_name: firstName,
        last_name: lastName,
        phone,
        field
      });
      // We can securely navigate and refresh context without risking a race condition 
      // or reloading the entire generic app context unnecessarily
      await refreshUser();
      navigate('/dashboard/projects', { replace: true });
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to update profile. Please try again.');
      setIsLoading(false);
    }
  };
  if (!user) {
      return null;
  }
  // Format time for display
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Dynamic Background Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[100px] animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/20 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '2s' }}></div>
      <div className="w-full max-w-md bg-card/50 backdrop-blur-xl p-8 rounded-2xl shadow-2xl border border-white/5 relative z-10 transition-all duration-300 hover:shadow-primary/10">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent mb-2">Complete Your Profile</h1>
          <p className="text-muted-foreground">Just a few more details to get you started.</p>
          <div className={`mt-4 inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${timeLeft < 30 ? 'bg-destructive/20 text-destructive animate-pulse' : 'bg-primary/10 text-primary'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
            Session expires in {timeString}
          </div>
        </div>
        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="group">
            <label className="block text-sm font-medium text-foreground mb-1.5 transition-colors group-focus-within:text-primary">Email</label>
            <input
              type="email"
              value={user.email}
              disabled
              className="w-full px-4 py-3 rounded-xl bg-background/50 border border-white/10 text-muted-foreground cursor-not-allowed focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="group">
              <label className="block text-sm font-medium text-foreground mb-1.5 transition-colors group-focus-within:text-primary">First Name <span className="text-destructive">*</span></label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoFocus
                className="w-full px-4 py-3 rounded-xl bg-background border border-white/10 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                placeholder="Jane"
              />
            </div>
            <div className="group">
              <label className="block text-sm font-medium text-foreground mb-1.5 transition-colors group-focus-within:text-primary">Last Name <span className="text-destructive">*</span></label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-background border border-white/10 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                placeholder="Doe"
              />
            </div>
          </div>
          <div className="group">
            <label className="block text-sm font-medium text-foreground mb-1.5 transition-colors group-focus-within:text-primary">Phone (Optional)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-background border border-white/10 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
              placeholder="+1 (555) 000-0000"
            />
          </div>
          <div className="group">
            <label className="block text-sm font-medium text-foreground mb-1.5 transition-colors group-focus-within:text-primary">Professional Field <span className="text-destructive">*</span></label>
            <div className="relative">
              <select
                value={field}
                onChange={(e) => setField(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-background border border-white/10 text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all cursor-pointer"
              >
                <option value="" disabled className="text-muted-foreground">Select your field...</option>
                {fields.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-muted-foreground">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          </div>
          <button
            type="submit"
            disabled={isLoading || !firstName || !lastName || !field}
            className="w-full mt-8 py-3.5 px-4 rounded-xl font-medium text-primary-foreground bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] flex items-center justify-center space-x-2 shadow-lg shadow-primary/20"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Saving...</span>
              </>
            ) : (
              <span>Complete Setup</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
export default SetupProfilePage;
