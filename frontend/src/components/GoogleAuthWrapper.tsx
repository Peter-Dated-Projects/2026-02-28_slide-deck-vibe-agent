import React from 'react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

const GoogleAuthWrapper: React.FC = () => {
  const { loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  return (
    <GoogleOAuthProvider clientId={clientId}>
      <GoogleLogin
        onSuccess={async (credentialResponse) => {
          if (credentialResponse.credential) {
            await loginWithGoogle(credentialResponse.credential);
            navigate('/chat');
          }
        }}
        onError={() => {
          console.log('Login Failed');
        }}
        useOneTap
        shape="rectangular"
        theme="filled_black"
        size="large"
      />
    </GoogleOAuthProvider>
  );
};

export default GoogleAuthWrapper;
