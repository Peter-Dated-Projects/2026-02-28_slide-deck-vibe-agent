import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import ChatPage from './pages/ChatPage';
import SetupProfilePage from './pages/SetupProfilePage';

const ProtectedRoute = ({ children, requireProfile = true }: { children: React.ReactNode, requireProfile?: boolean }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  
  if (isLoading) {
    return <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">Loading...</div>;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // If the route requires a complete profile, but the user hasn't finished it
  if (requireProfile && user && !user.is_profile_complete) {
    return <Navigate to="/setup-profile" replace />;
  }
  
  return <>{children}</>;
};

// Component for the SetupProfile route to redirect back to dashboard if completed
const ProfileSetupRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  
  if (isLoading) {
    return <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">Loading...</div>;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  if (user && user.is_profile_complete) {
    return <Navigate to="/chat" replace />;
  }
  
  return <>{children}</>;
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route 
            path="/setup-profile" 
            element={
              <ProfileSetupRoute>
                <SetupProfilePage />
              </ProfileSetupRoute>
            } 
          />
          <Route 
            path="/chat/:conversationId?" 
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            } 
          />
          <Route path="/" element={<Navigate to="/chat" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
