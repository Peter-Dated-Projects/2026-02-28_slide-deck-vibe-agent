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

import React from 'react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
const getClientId = () => {
  const jsonStr = import.meta.env.GOOGLE_OAUTH_CLIENT_JSON;
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      return parsed.web?.client_id || '';
    } catch (e) {
      console.error('Failed to parse GOOGLE_OAUTH_CLIENT_JSON', e);
    }
  }
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
};
const clientId = getClientId();
const GoogleAuthWrapper: React.FC = () => {
  const { loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  return (
    <GoogleOAuthProvider clientId={clientId}>
      <GoogleLogin
        onSuccess={async (credentialResponse) => {
          if (credentialResponse.credential) {
            await loginWithGoogle(credentialResponse.credential);
            navigate('/dashboard/projects');
          }
        }}
        onError={() => {
          console.log('Login Failed');
        }}
        useOneTap
        shape="rectangular"
        theme="outline"
        size="large"
      />
    </GoogleOAuthProvider>
  );
};
export default GoogleAuthWrapper;
