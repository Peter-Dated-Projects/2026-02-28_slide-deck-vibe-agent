import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import api, { setAccessToken } from '../api';

interface User {
  id: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initial check to see if we have a valid session via the HTTPOnly refresh token
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const response = await axios.post(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/refresh`,
          {},
          { withCredentials: true }
        );
        
        setAccessToken(response.data.accessToken);
        // Note: For a real app, you might want the refresh endpoint to also return basic user info
        // Here we just consider them authenticated to hit further protected routes that fetch me()
        setUser({ id: 'restored-session', email: 'user@vibeslide.com' }); 
      } catch (error) {
        setAccessToken(null);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuthStatus();

    // Listen to our custom unauthorized event from the Axios interceptor
    const handleUnauthorized = () => {
      setUser(null);
      setAccessToken(null);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const loginWithGoogle = async (credential: string) => {
    setIsLoading(true);
    try {
      const response = await api.post('/auth/google', { token: credential });
      setAccessToken(response.data.accessToken);
      setUser(response.data.user);
    } catch (error) {
      console.error('Login failed', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout failed', error);
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
