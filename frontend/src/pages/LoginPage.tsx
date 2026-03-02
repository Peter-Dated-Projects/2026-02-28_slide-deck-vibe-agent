import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import GoogleAuthWrapper from '../components/GoogleAuthWrapper';
import { Sparkles } from 'lucide-react';

const LoginPage: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">Loading...</div>;
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard/projects" replace />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
        {/* Background Gradients Removed per user request */}

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center mb-6">
            <div className="bg-primary/10 p-4 rounded-2xl border border-primary/20">
               <Sparkles className="w-12 h-12 text-primary fill-primary" />
            </div>
        </div>
        <h2 className="mt-2 text-center text-4xl font-extrabold text-foreground tracking-tight">
          Vibe Slide
        </h2>
        <p className="mt-4 text-center text-muted-foreground max-w-sm mx-auto">
          Generate stunning, web-native <br /> presentations hands-free, instantly.
        </p>
      </div>

  <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-card/50 backdrop-blur-xl py-12 px-4 shadow-card rounded-2xl sm:px-10 border border-border mx-4 sm:mx-0">
            <div className="flex flex-col items-center justify-center space-y-8">
                 <div className="text-center space-y-2">
                     <p className="text-sm text-muted-foreground">Sign in to sync your presentations</p>
                 </div>
                 
                 <div className="w-full flex justify-center scale-110">
                    <GoogleAuthWrapper />
                 </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
