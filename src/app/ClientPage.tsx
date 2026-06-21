'use client';

import { useState, useEffect } from 'react';
import SetupForm from './components/SetupForm';
import LoginForm from './components/LoginForm';
import Dashboard from './components/Dashboard';

interface ClientPageProps {
  hasClientId: boolean;
  hasAccessToken: boolean;
}

export default function ClientPage({ hasClientId, hasAccessToken }: ClientPageProps) {


  if (!hasClientId) {
    return <SetupForm />;
  }

  if (!hasAccessToken) {
    return <LoginForm />;
  }

  return <Dashboard />;
}
