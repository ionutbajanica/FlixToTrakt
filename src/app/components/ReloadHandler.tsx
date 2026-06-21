"use client";

import { useEffect } from 'react';

export default function ReloadHandler() {
  useEffect(() => {
    if (typeof window !== 'undefined' && window.performance) {
      const navEntries = performance.getEntriesByType("navigation");
      if (navEntries.length > 0) {
        const navTiming = navEntries[0] as PerformanceNavigationTiming;
        
        if (navTiming.type === "reload") {
          const skip = sessionStorage.getItem('skip_reload_clear');
          if (skip) {
            sessionStorage.removeItem('skip_reload_clear');
            return;
          }

          const reloadHandled = sessionStorage.getItem('reload_handled');
          if (!reloadHandled) {
            // We are handling a fresh user-initiated reload
            sessionStorage.setItem('reload_handled', 'true');
            fetch('/api/settings/clear', { method: 'POST' }).then(() => {
              window.location.reload();
            });
          } else {
            // We are in the loop caused by our own redirect to '/' while already on '/'
            sessionStorage.removeItem('reload_handled');
          }
        } else {
          // Normal navigation, ensure the flag is cleared
          sessionStorage.removeItem('reload_handled');
        }
      }
    }
  }, []);

  return null;
}
