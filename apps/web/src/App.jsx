import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ROLE } from '@securecred/shared';
import { AppAuthProvider } from './auth/AppAuthProvider.jsx';
import { useAuth } from './auth/useAuth.js';
import { RequireRole } from './auth/RequireRole.jsx';
import { setAuthTokenProvider } from './api/client.js';

import { LandingPage } from './pages/public/LandingPage.jsx';
import { VerifyEntryPage } from './pages/public/VerifyEntryPage.jsx';
import { VerifyOutcomePage } from './pages/public/VerifyOutcomePage.jsx';
import { AboutPage } from './pages/public/AboutPage.jsx';
import { SignInPage } from './pages/public/SignInPage.jsx';
import { SignUpPage } from './pages/public/SignUpPage.jsx';
import { RoleSelectionPage } from './pages/public/RoleSelectionPage.jsx';
import { DevLoginPage } from './pages/public/DevLoginPage.jsx';

import { InstitutionLayout } from './pages/institution/InstitutionLayout.jsx';
import { RegistryPage } from './pages/institution/RegistryPage.jsx';
import { IssuePage } from './pages/institution/IssuePage.jsx';
import { CertificateDetailPage } from './pages/institution/CertificateDetailPage.jsx';
import { ActivityPage } from './pages/institution/ActivityPage.jsx';
import { SettingsPage } from './pages/institution/SettingsPage.jsx';

import { GalleryPage } from './pages/student/GalleryPage.jsx';
import { SharePanelPage } from './pages/student/SharePanelPage.jsx';

/** Wires whichever auth mode is active into the single shared API client. */
function AuthTokenBridge() {
  const auth = useAuth();
  useEffect(() => {
    setAuthTokenProvider(auth.getToken);
  }, [auth.getToken]);
  return null;
}

function AppRoutes() {
  return (
    <>
      <AuthTokenBridge />
      <Routes>
        <Route path="/" element={<LandingPage />} />

        {/* Public Verifier Portal */}
        <Route path="/verify" element={<VerifyEntryPage />} />
        <Route path="/verify/:certificateNumber" element={<VerifyOutcomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        <Route path="/choose-role" element={<RoleSelectionPage />} />
        <Route path="/dev-login" element={<DevLoginPage />} />

        {/* Institution Dashboard */}
        <Route
          path="/app"
          element={
            <RequireRole role={ROLE.INSTITUTION}>
              <InstitutionLayout />
            </RequireRole>
          }
        >
          <Route index element={<Navigate to="registry" replace />} />
          <Route path="registry" element={<RegistryPage />} />
          <Route path="issue" element={<IssuePage />} />
          <Route path="certificate/:id" element={<CertificateDetailPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* Student Dashboard */}
        <Route
          path="/me"
          element={
            <RequireRole role={ROLE.STUDENT}>
              <GalleryPage />
            </RequireRole>
          }
        />
        <Route
          path="/me/credential/:id"
          element={
            <RequireRole role={ROLE.STUDENT}>
              <SharePanelPage />
            </RequireRole>
          }
        />

        <Route path="*" element={<Navigate to="/verify" replace />} />
      </Routes>
    </>
  );
}

export function App() {
  return (
    <AppAuthProvider>
      <AppRoutes />
    </AppAuthProvider>
  );
}
