import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import GoogleAuthWrapper from '../components/GoogleAuthWrapper';
import { Sparkles } from 'lucide-react';

const LoginPage: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="h-screen w-screen flex items-center justify-center bg-zinc-950 text-white">Loading...</div>;
  }

  if (isAuthenticated) {
    return <Navigate to="/chat" replace />;
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-indigo-500/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[400px] bg-purple-500/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center mb-6">
            <div className="bg-indigo-500/10 p-4 rounded-2xl border border-indigo-500/20">
               <Sparkles className="w-12 h-12 text-indigo-400" />
            </div>
        </div>
        <h2 className="mt-2 text-center text-4xl font-extrabold text-white tracking-tight">
          Vibe Slide
        </h2>
        <p className="mt-4 text-center text-zinc-400 max-w-sm mx-auto">
          Generate stunning, web-native presentations instantly using Claude 3.7.
        </p>
      </div>

      <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-zinc-900/50 backdrop-blur-xl py-12 px-4 shadow-2xl rounded-2xl sm:px-10 border border-white/5 mx-4 sm:mx-0">
            <div className="flex flex-col items-center justify-center space-y-8">
                 <div className="text-center space-y-2">
                     <h3 className="text-xl font-semibold text-white">Welcome Back</h3>
                     <p className="text-sm text-zinc-400">Sign in to sync your presentations</p>
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
